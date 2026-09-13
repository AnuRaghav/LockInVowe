import type { Message, Run } from "@/lib/conversations/store";
import { updateSemanticState } from "@/lib/semantic/update";
import type { SemanticInteraction, SemanticUpdateResult } from "@/lib/semantic/update/types";

/**
 * The narrow slice of a completed Sam turn that semantic consolidation sees.
 *
 * The current founder turn is always included, the final Sam answer is included
 * so the updater can distinguish an established answer from an unanswered
 * question, and the immediately preceding exchange is included for short
 * follow-ups like "yes, do that". Older history remains available through the
 * existing semantic blocks; this path is not a thread summarizer.
 */
export const buildSemanticInteractionForCompletedTurn = ({
  messages,
  assistantText,
  run,
}: {
  messages: Pick<Message, "role" | "content">[];
  assistantText: string;
  run: Pick<Run, "id" | "threadId" | "startedAt">;
}): SemanticInteraction => {
  const currentUserIndex = messages.map((message) => message.role).lastIndexOf("user");
  const contextStart = currentUserIndex === -1 ? Math.max(0, messages.length - 1) : Math.max(0, currentUserIndex - 2);
  const context = messages.slice(contextStart, currentUserIndex === -1 ? undefined : currentUserIndex + 1);

  return {
    externalKey: `conversation-run:${run.id}`,
    source: "conversation",
    threadId: run.threadId,
    runId: run.id,
    occurredAt: run.startedAt,
    messages: [
      ...context.map((message) => ({
        role: message.role === "user" ? "founder" : "sam",
        text: message.content,
      })),
      { role: "sam", text: assistantText },
    ],
  };
};

/**
 * Best-effort post-run semantic consolidation. The chat turn has already
 * completed by the time this is called, so any failure is logged and returned,
 * never thrown into the response path.
 */
export const updateSemanticMemoryAfterCompletedTurn = async ({
  companyId,
  messages,
  assistantText,
  run,
}: {
  companyId: string;
  messages: Pick<Message, "role" | "content">[];
  assistantText: string;
  run: Pick<Run, "id" | "threadId" | "startedAt">;
}): Promise<SemanticUpdateResult | null> => {
  try {
    const result = await updateSemanticState({
      scope: { companyId },
      interaction: buildSemanticInteractionForCompletedTurn({ messages, assistantText, run }),
    });

    if (result.status === "failed") {
      console.error("semantic memory update failed", {
        companyId,
        threadId: run.threadId,
        runId: run.id,
        interactionId: result.interactionId,
        error: result.error,
      });
    }

    return result;
  } catch (error) {
    console.error("semantic memory update failed", {
      companyId,
      threadId: run.threadId,
      runId: run.id,
      error,
    });
    return null;
  }
};
