import type { BaseMessage } from "@langchain/core/messages";

import type { SamInitialContext } from "@/lib/agents/sam/context-builder";
import { formatSamContext } from "@/lib/agents/sam/prompt";
import type { SamContextBudget } from "@/lib/agents/sam/harness/observability";

/**
 * Makes the size of Sam's model context a measured fact rather than a hope.
 *
 * The shape we are defending is deliberate:
 *
 *     orienting initial context (snapshot, brief, directory, plan)
 *   + just-in-time retrieval (the memory, plan, and financial tools)
 *   + bounded tool results (the tool-governance middleware)
 *
 * and *not* "put everything the company knows in the prompt".
 *
 * The transcript is measured alongside the system prompt because it is the one
 * component that grows without bound - the conversation store replays every
 * message in a thread - and a budget that ignored it would report a healthy
 * number for a run that is mostly history. It is counted separately rather than
 * merged, so an orientation that grew can be told from a conversation that got
 * long; they have different fixes.
 *
 * There is no token allocator here on purpose. A character count with a stated
 * 4-chars-per-token estimate is enough to see the trend and to decide, with
 * evidence, when compaction is actually needed.
 */

/** Crude but provider-independent. Good enough to spot a context that grew. */
const CHARS_PER_TOKEN = 4;

const messageChars = (message: BaseMessage): number => {
  const { content } = message;
  if (typeof content === "string") return content.length;
  // Multi-part content (text blocks, tool-use blocks) is measured by its
  // serialized size: an approximation, and the only provider-neutral one.
  try {
    return JSON.stringify(content).length;
  } catch {
    return 0;
  }
};

export interface MeasureSamContextOptions {
  systemPrompt: string;
  initialContext: SamInitialContext;
  maxChars: number;
  /** The conversation replayed into model call 1. Empty for a one-off run. */
  messages?: BaseMessage[];
}

export const measureSamContext = ({
  systemPrompt,
  initialContext,
  maxChars,
  messages = [],
}: MeasureSamContextOptions): SamContextBudget => {
  const systemPromptChars = systemPrompt.length;
  const initialContextChars = formatSamContext(initialContext).length;
  const transcriptChars = messages.reduce((total, message) => total + messageChars(message), 0);
  const directory = initialContext.directory;

  return {
    maxChars,
    systemPromptChars,
    initialContextChars,
    briefChars: initialContext.brief?.body.length ?? 0,
    directoryEntryCount: directory?.entries.length ?? 0,
    directoryTruncated: directory?.truncated ?? false,
    companyPlanStatus: initialContext.operating?.status ?? "unavailable",
    transcriptMessageCount: messages.length,
    transcriptChars,
    threadNoteCount: initialContext.thread?.notes.length ?? 0,
    estimatedTokens: Math.ceil((systemPromptChars + transcriptChars) / CHARS_PER_TOKEN),
    // The budget covers everything sent to model call 1, which is the number
    // that actually has to fit.
    withinBudget: systemPromptChars + transcriptChars <= maxChars,
  };
};
