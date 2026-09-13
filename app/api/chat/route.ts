import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { createDataStreamResponse, type JSONValue } from "ai";

import { streamSamAgent, type SamRunEvent, type SamRunOutcome } from "@/lib/agents/sam";
import { resolveCompanyContext, UnauthenticatedError } from "@/lib/company/context";

export const runtime = "nodejs";

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool" | "data";
  content?: unknown;
  parts?: Array<{ type?: string; text?: string }>;
};

const extractText = (message: ChatMessage): string => {
  if (typeof message.content === "string") return message.content;

  if (Array.isArray(message.content)) {
    return message.content
      .map((part) =>
        typeof part === "string"
          ? part
          : typeof part?.text === "string"
            ? part.text
            : ""
      )
      .filter(Boolean)
      .join("\n");
  }

  if (Array.isArray(message.parts)) {
    return message.parts
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n");
  }

  return "";
};

const toLangChainMessages = (messages: ChatMessage[]): BaseMessage[] => {
  const langChainMessages: BaseMessage[] = [];

  for (const message of messages) {
    const text = extractText(message).trim();
    if (!text) continue;

    switch (message.role) {
      case "system":
        // Only the server Context Builder may supply system-level company/financial state.
        // Client history is conversation, never a replacement Numerical Model snapshot.
        break;
      case "assistant":
        langChainMessages.push(new AIMessage(text));
        break;
      case "user":
        langChainMessages.push(new HumanMessage(text));
        break;
    }
  }

  return langChainMessages;
};

/**
 * Projects a Sam run event onto the wire.
 *
 * A whitelist per event type, not a passthrough: the events are already free of
 * reasoning and raw payloads, and the client has no use for the full execution
 * record, so it gets exactly what a UI can render.
 */
const toClientEvent = (event: SamRunEvent): Record<string, unknown> | null => {
  switch (event.type) {
    case "run_started":
      return { type: event.type, runId: event.runId, seq: event.seq };
    case "tool_started":
    case "tool_awaiting_approval":
      return {
        type: event.type,
        seq: event.seq,
        callId: event.callId,
        name: event.name,
        kind: event.kind,
        // "Calculating runway" - what a founder sees while they wait.
        label: event.label,
      };
    case "tool_completed":
      return {
        type: event.type,
        seq: event.seq,
        callId: event.callId,
        name: event.name,
        durationMs: event.durationMs,
        summary: event.summary,
      };
    case "tool_failed":
      return {
        type: event.type,
        seq: event.seq,
        callId: event.callId,
        name: event.name,
        durationMs: event.durationMs,
        critical: event.critical,
      };
    case "run_completed":
      return {
        type: event.type,
        seq: event.seq,
        outcome: event.outcome,
        degraded: event.degraded,
        durationMs: event.run.durationMs,
      };
    case "run_terminated":
      return { type: event.type, seq: event.seq, outcome: event.outcome };
    default:
      // Model-call and context events are execution detail; they stay in the
      // run record and the logs rather than going to the browser.
      return null;
  }
};

/** What the founder sees when a run stops without producing an answer. */
const unfinishedMessage = (outcome: SamRunOutcome): string => {
  switch (outcome) {
    case "max_model_calls":
    case "max_tool_calls":
    case "no_progress":
      return "I ran out of room working through that one before I had an answer. Try asking for one piece of it at a time.";
    case "timeout":
      return "That took longer than I'm allowed to spend on one question. Try narrowing it and I'll have another go.";
    case "cancelled":
      return "Stopped.";
    default:
      return "Something broke while I was working on that, so I don't have an answer I trust. Try again in a moment.";
  }
};

export async function POST(req: Request) {
  const { messages = [], threadId } = (await req.json()) as {
    messages?: ChatMessage[];
    threadId?: string;
  };

  // Company context is resolved once, here, from the request - never from the
  // conversation and never from a tool argument. See `lib/company/context.ts`.
  //
  // `threadId` scopes working memory to this conversation. Long-lived company
  // knowledge is *not* scoped by it: it is reached through the memory module,
  // which is why a fact learned in one thread is available in the next.
  let context: { companyId: string; threadId?: string };
  try {
    context = {
      ...(await resolveCompanyContext(req)),
      threadId: typeof threadId === "string" && threadId.trim() ? threadId.trim() : undefined,
    };
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return Response.json({ error: "Sign in required." }, { status: 401 });
    }
    throw error;
  }

  return createDataStreamResponse({
    async execute(writer) {
      // Abandoning the iterator cancels the run, so a founder who closes the
      // tab stops the spend - `req.signal` covers the abort, and the loop
      // ending covers everything else.
      for await (const event of streamSamAgent({
        messages: toLangChainMessages(messages),
        context,
        signal: req.signal,
      })) {
        if (event.type === "message_delta") {
          writer.write(`0:${JSON.stringify(event.text)}\n` as `0:${string}\n`);
          continue;
        }

        // A run that stopped against a budget, a deadline, or a provider
        // failure has no answer to show. Say so rather than leaving the turn
        // hanging as if Sam had nothing to say.
        if (event.type === "run_terminated") {
          writer.write(
            `0:${JSON.stringify(unfinishedMessage(event.outcome))}\n` as `0:${string}\n`
          );
        }

        const clientEvent = toClientEvent(event);
        if (clientEvent) writer.writeData(clientEvent as unknown as JSONValue);
      }
    },
  });
}
