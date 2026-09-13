import type { SamInitialContext } from "@/lib/agents/sam/context-builder";
import type { MemoryRecord } from "@/lib/memory/types";

/**
 * Sam's system prompt.
 *
 * Deliberately minimal: it describes who Sam is and how to behave, never *how
 * to do finance*. Every number Sam reports must come from a tool result, so
 * formulas, thresholds, and domain rules live in `lib/finance/`, not here.
 */
export const SAM_SYSTEM_PROMPT = `You are Sam, a CFO/operations partner for startup founders.

Your job is to take financial and operational work off the founder's plate: answering questions about the company's numbers, flagging what needs attention, and explaining what the numbers mean for the business.

How you work:
- You decide what information or calculation a question needs, then call the tool that provides it. You never do arithmetic yourself.
- Every figure you state must come from a tool result. If no tool can produce it, say so plainly and say what input you'd need.
- If a tool's inputs are missing or ambiguous, ask one short clarifying question instead of guessing.
- Tool results are authoritative. Do not adjust, round differently, or re-derive them.

How you talk:
- Lead with the answer, then the one or two things that make it actionable.
- Plain language, no jargon padding. Short paragraphs; this may be read aloud.
- Be direct about bad news. A founder who hears the problem late is worse off than one who hears it bluntly.
- Never invent a number, a date, or a company fact.

What you are given:
- Each turn opens with a brief on the company and a selected slice of what it currently understands about itself - not everything, and not raw financial data.
- That context is the company's own understanding: its plans, assumptions, decisions, and operating posture as most recently stated. Treat it as what the company currently believes, which is not the same as verified fact. Where a figure matters, get it from a tool.
- It is current by construction. If something was decided and later changed, you are shown the change, not the original. Do not treat anything in your context as out of date, and do not speculate about what it used to say - look it up instead.
- When the answer needs something you were not given, search the company's understanding before saying you do not know. When a question is about how or why something changed, retrieve that topic's history rather than inferring it.`;

/**
 * How one piece of current understanding is rendered.
 *
 * The key is shown because it is how Sam refers to the topic again - in a
 * follow-up retrieval, or when asking for its history. The status and date are
 * shown only when they change how the line should be read: a `dormant` topic is
 * still true but not live, and a stale date on a plan is worth Sam noticing.
 */
const formatMemory = (memory: MemoryRecord): string => {
  const attributes = (memory.attributes ?? {}) as {
    status?: string;
    asOf?: string;
    revision?: number;
  };

  const qualifiers = [
    attributes.status && attributes.status !== "active" ? attributes.status : null,
    memory.recordedAt ? `as of ${memory.recordedAt.slice(0, 10)}` : null,
  ].filter((value): value is string => value !== null);

  const suffix = qualifiers.length > 0 ? ` (${qualifiers.join("; ")})` : "";

  // Non-semantic records still carry a kind worth showing; semantic blocks do
  // not, because "semantic_block" tells the model nothing it can act on.
  const kind = memory.kind && memory.kind !== "semantic_block" ? ` (${memory.kind})` : "";

  return `- [${memory.id}]${kind}${suffix} ${memory.content}`;
};

/**
 * Renders {@link SamInitialContext} for the model.
 *
 * This is the only place structured context becomes text. Everything upstream
 * stays data, so what Sam is told can be asserted on directly and a change of
 * wording is a change in one function.
 *
 * The sections are labelled to keep three things apart that would otherwise
 * blur into one undifferentiated pile of "facts":
 *
 *   the brief             compact, standing, always present
 *   current understanding deeper, selected for this question
 *   the thread            what this conversation has established
 *
 * And all of it is framed as *the company's understanding* rather than as
 * external fact. The difference matters when a founder's stated plan and their
 * bank balance disagree - Sam should notice, not average them.
 */
export const formatSamContext = (context: SamInitialContext): string => {
  const sections: string[] = [];

  if (context.brief) {
    sections.push(
      [
        "Company brief - the current operating context, as the company understands it:",
        context.brief.body,
      ].join("\n")
    );
  }

  if (context.memories.length > 0) {
    sections.push(
      [
        "Relevant to this question - the company's current understanding of these topics. This is what it believes and intends now; earlier versions are not shown and should not be assumed:",
        ...context.memories.map(formatMemory),
      ].join("\n")
    );
  }

  if (context.thread?.summary) {
    sections.push(`Where this conversation stands:\n${context.thread.summary}`);
  }

  if (context.thread?.notes.length) {
    sections.push(
      ["Working notes for the current task:", ...context.thread.notes.map((note) => `- ${note}`)].join(
        "\n"
      )
    );
  }

  return sections.join("\n\n");
};

/** The full system prompt for one invocation: who Sam is, plus what it knows now. */
export const buildSamSystemPrompt = (context: SamInitialContext): string => {
  const formatted = formatSamContext(context);
  return formatted ? `${SAM_SYSTEM_PROMPT}\n\n---\n\n${formatted}` : SAM_SYSTEM_PROMPT;
};
