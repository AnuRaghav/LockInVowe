import { tool, type ToolRuntime } from "@langchain/core/tools";
import { z } from "zod";

import {
  memoryScope,
  requireSamContext,
  type samRuntimeContextSchema,
} from "@/lib/agents/sam/context";
import { runTool } from "@/lib/agents/sam/tools/result";
import { getPersistentMemory, supportsMemoryHistory } from "@/lib/memory";
import type { MemoryRecord, PersistentMemory } from "@/lib/memory/types";

/**
 * Just-in-time retrieval.
 *
 * The context builder gives Sam a small, deliberate slice of company knowledge
 * up front. These tools are how Sam reaches the rest *during* the ReAct loop,
 * when it discovers the opening context was not enough.
 *
 * The company is never an argument. Claude chooses what to look for; the
 * server decides whose knowledge is searched, exactly as with every other Sam
 * tool.
 */

const resolveMemory = (
  runtime: ToolRuntime<unknown, typeof samRuntimeContextSchema>,
  toolName: string
): { memory: PersistentMemory; scope: { companyId: string } } => {
  const context = requireSamContext(runtime, toolName);

  return {
    memory: context.persistentMemory ?? getPersistentMemory(),
    scope: memoryScope(context),
  };
};

/**
 * What the model sees.
 *
 * Storage details stay inside the memory implementation, and so do revision
 * internals: no revision number, no supersession pointer, no block uuid. A
 * record returned here is the *current* understanding of a topic, and `id` is
 * the name the model uses to ask about it again - including asking for its
 * history. `status` is included only because a dormant or resolved topic should
 * be read differently from a live one.
 */
const toModelShape = (record: MemoryRecord) => {
  const attributes = (record.attributes ?? {}) as { status?: string };

  return {
    id: record.id,
    content: record.content,
    asOf: record.recordedAt,
    status: attributes.status,
  };
};

const SEARCH_TOOL_NAME = "search_memory";

export const searchMemoryInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      "What you are trying to find out, in plain language, e.g. 'runway policy' or 'fundraising plans'."
    ),
  kinds: z
    .array(z.string())
    .optional()
    .describe(
      "Optional filter, e.g. 'constraint', 'plan', 'goal', 'decision', 'assumption', 'fact'."
    ),
  limit: z
    .number()
    .int()
    .positive()
    .max(20)
    .optional()
    .describe("Maximum results. Defaults to a small number; ask for more only if needed."),
});

export const searchMemoryTool = tool(
  async (
    input: z.infer<typeof searchMemoryInputSchema>,
    runtime: ToolRuntime<unknown, typeof samRuntimeContextSchema>
  ) =>
    runTool(async () => {
      const { memory, scope } = resolveMemory(runtime, SEARCH_TOOL_NAME);
      const records = await memory.search(scope, {
        text: input.query,
        kinds: input.kinds,
        limit: input.limit,
      });

      return { topics: records.map(toModelShape) };
    }),
  {
    name: SEARCH_TOOL_NAME,
    description:
      "Search the company's current understanding of itself: its plans, assumptions, constraints, decisions, priorities, risks, and operating context. Returns what the company believes now - superseded versions are never returned. Call this whenever a question depends on something about the company you were not given this turn, before saying you do not know. The company is set by the server; never ask for or guess a company id.",
    schema: searchMemoryInputSchema,
  }
);

const GET_TOOL_NAME = "get_memory";

export const getMemoryInputSchema = z.object({
  id: z
    .string()
    .min(1)
    .describe("The id of a memory, as returned by search_memory or shown in your context."),
});

export const getMemoryTool = tool(
  async (
    input: z.infer<typeof getMemoryInputSchema>,
    runtime: ToolRuntime<unknown, typeof samRuntimeContextSchema>
  ) =>
    runTool(async () => {
      const { memory, scope } = resolveMemory(runtime, GET_TOOL_NAME);
      const record = await memory.get(scope, input.id);

      if (!record) throw new Error(`No topic "${input.id}" for this company.`);

      return toModelShape(record);
    }),
  {
    name: GET_TOOL_NAME,
    description:
      "Retrieve one topic by the id shown in your context or returned by search_memory, when you need its exact current wording. The company is set by the server.",
    schema: getMemoryInputSchema,
  }
);


const HISTORY_TOOL_NAME = "get_memory_history";

export const getMemoryHistoryInputSchema = z.object({
  id: z
    .string()
    .min(1)
    .describe("The id of the topic whose history you need, e.g. 'hiring'."),
  limit: z
    .number()
    .int()
    .positive()
    .max(20)
    .optional()
    .describe("How many versions back to go. Defaults to a small number."),
});

/**
 * The one tool that reaches backwards.
 *
 * Every other retrieval path returns current understanding only, which is what
 * keeps superseded plans out of Sam's head. This is the deliberate exception,
 * for the questions that are actually about change: "how did the hiring plan
 * get here?", "when did we decide that?", "what were we planning before?".
 *
 * It is a separate tool rather than a flag on search for exactly that reason -
 * retrieving history has to be a choice Sam makes, not something that can
 * happen to it.
 */
export const getMemoryHistoryTool = tool(
  async (
    input: z.infer<typeof getMemoryHistoryInputSchema>,
    runtime: ToolRuntime<unknown, typeof samRuntimeContextSchema>
  ) =>
    runTool(async () => {
      const { memory, scope } = resolveMemory(runtime, HISTORY_TOOL_NAME);

      if (!supportsMemoryHistory(memory)) {
        throw new Error(
          "This company's understanding is not versioned, so there is no history to show."
        );
      }

      const revisions = await memory.history(scope, input.id, { limit: input.limit });

      if (revisions.length === 0) {
        throw new Error(`No topic "${input.id}" for this company, so it has no history.`);
      }

      return {
        topic: input.id,
        // Newest first, and the current one is marked rather than left to be
        // inferred from position - a model that misreads the order would
        // otherwise present a superseded plan as the live one.
        versions: revisions.map((revision, index) => ({
          content: revision.content,
          changed: revision.changeNote,
          recordedAt: revision.recordedAt,
          current: index === 0 && revision.supersededAt === undefined,
          replacedOn: revision.supersededAt,
        })),
      };
    }),
  {
    name: HISTORY_TOOL_NAME,
    description:
      "Show how the company's understanding of one topic has changed over time, newest first. Use this only when the question is about change itself - how a plan evolved, when something was decided, what it used to be. For what is true now, use search_memory or get_memory; the versions returned here are mostly superseded and must never be presented as current.",
    schema: getMemoryHistoryInputSchema,
  }
);
