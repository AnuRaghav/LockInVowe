import { tool, type ToolRuntime } from "@langchain/core/tools";
import { z } from "zod";

import {
  memoryScope,
  requireSamContext,
  type samRuntimeContextSchema,
} from "@/lib/agents/sam/context";
import { runTool } from "@/lib/agents/sam/tools/result";
import { getPersistentMemory } from "@/lib/memory";
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

/** What the model sees. Storage details stay inside the memory implementation. */
const toModelShape = (record: MemoryRecord) => ({
  id: record.id,
  kind: record.kind,
  content: record.content,
  recordedAt: record.recordedAt,
});

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

      return { memories: records.map(toModelShape) };
    }),
  {
    name: SEARCH_TOOL_NAME,
    description:
      "Search what the company has told us over time: standing constraints, plans, goals, assumptions, decisions, and commitments. Call this whenever a question depends on a company fact you were not given this turn - before saying you do not know. The company is set by the server; never ask for or guess a company id.",
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

      if (!record) throw new Error(`No memory "${input.id}" for this company.`);

      return toModelShape(record);
    }),
  {
    name: GET_TOOL_NAME,
    description:
      "Retrieve one specific memory by its id, when you have seen the id and need its exact wording. The company is set by the server.",
    schema: getMemoryInputSchema,
  }
);
