import type { SamInitialContext } from "@/lib/agents/sam/context-builder";

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
- Each turn opens with a selected slice of what the company knows, not everything. Treat it as true but incomplete.
- When the answer needs a fact that is not in front of you, search memory for it before saying you do not know.`;


/**
 * Renders {@link SamInitialContext} for the model.
 *
 * This is the only place structured context becomes text. Everything upstream
 * stays data, so what Sam is told can be asserted on directly and a change of
 * wording is a change in one function.
 */
export const formatSamContext = (context: SamInitialContext): string => {
  const sections: string[] = [];

  if (context.memories.length > 0) {
    sections.push(
      [
        "What you already know about this company (retrieved for this question; not the full picture):",
        ...context.memories.map(
          (memory) => `- [${memory.id}] (${memory.kind}) ${memory.content}`
        ),
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
