import type { SamInitialContext } from "@/lib/agents/sam/context-builder";
import { formatSamContext } from "@/lib/agents/sam/prompt";
import type { SamContextBudget } from "@/lib/agents/sam/harness/observability";

/**
 * Makes the size of Sam's model context a measured fact rather than a hope.
 *
 * The shape we are defending is deliberate:
 *
 *     small relevant initial context
 *   + just-in-time retrieval (the memory tools)
 *   + bounded tool results (the tool-governance middleware)
 *
 * and *not* "put everything the company knows in the prompt". Numerical state
 * and source-derived facts will join the initial context later; when they do,
 * this is the number that shows whether the budget still holds.
 *
 * There is no token allocator here on purpose. A character count with a stated
 * 4-chars-per-token estimate is enough to see the trend and to decide, with
 * evidence, when compaction is actually needed.
 */

/** Crude but provider-independent. Good enough to spot a context that grew. */
const CHARS_PER_TOKEN = 4;

export interface MeasureSamContextOptions {
  systemPrompt: string;
  initialContext: SamInitialContext;
  maxChars: number;
}

export const measureSamContext = ({
  systemPrompt,
  initialContext,
  maxChars,
}: MeasureSamContextOptions): SamContextBudget => {
  const systemPromptChars = systemPrompt.length;
  const initialContextChars = formatSamContext(initialContext).length;

  return {
    maxChars,
    systemPromptChars,
    initialContextChars,
    memoryCount: initialContext.memories.length,
    threadNoteCount: initialContext.thread?.notes.length ?? 0,
    estimatedTokens: Math.ceil(systemPromptChars / CHARS_PER_TOKEN),
    withinBudget: systemPromptChars <= maxChars,
  };
};
