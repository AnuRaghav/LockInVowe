import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { createDataStreamResponse, type JSONValue } from "ai";

import { streamSamAgent, type SamRunEvent, type SamRunOutcome } from "@/lib/agents/sam";
import { resolveCompanyContext, UnauthenticatedError } from "@/lib/company/context";
import { ConversationError, createConversationStore, type Message, type Run } from "@/lib/conversations/store";

export const runtime = "nodejs";

type ChatMessage = { role?: string; content?: unknown; parts?: Array<{ type?: string; text?: string }> };

const extractText = (message: ChatMessage): string => {
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) return message.content.map((part) =>
    typeof part === "string" ? part : typeof part?.text === "string" ? part.text : ""
  ).filter(Boolean).join("\n");
  if (Array.isArray(message.parts)) return message.parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text).join("\n");
  return "";
};

const latestUserText = (body: { content?: unknown; messages?: ChatMessage[] }): string => {
  if (typeof body.content === "string") return body.content.trim();
  const message = [...(body.messages ?? [])].reverse().find(({ role }) => role === "user");
  return message ? extractText(message).trim() : "";
};

/** Only database-loaded rows become model history; browser history is never trusted. */
const toLangChainMessages = (messages: Message[]): BaseMessage[] => messages.map((message) =>
  message.role === "user" ? new HumanMessage(message.content) : new AIMessage(message.content)
);

const toClientEvent = (event: SamRunEvent): Record<string, unknown> | null => {
  switch (event.type) {
    case "run_started": return { type: event.type, runId: event.runId, seq: event.seq };
    case "tool_started":
    case "tool_awaiting_approval": return { type: event.type, seq: event.seq, callId: event.callId, name: event.name, kind: event.kind, label: event.label };
    case "tool_completed": return { type: event.type, seq: event.seq, callId: event.callId, name: event.name, durationMs: event.durationMs, summary: event.summary };
    case "tool_failed": return { type: event.type, seq: event.seq, callId: event.callId, name: event.name, durationMs: event.durationMs, critical: event.critical };
    case "run_completed": return { type: event.type, seq: event.seq, outcome: event.outcome, degraded: event.degraded, durationMs: event.run.durationMs };
    case "run_terminated": return { type: event.type, seq: event.seq, outcome: event.outcome };
    default: return null;
  }
};

const unfinishedMessage = (outcome: SamRunOutcome): string => {
  switch (outcome) {
    case "max_model_calls": case "max_tool_calls": case "no_progress": return "I ran out of room working through that one before I had an answer. Try asking for one piece of it at a time.";
    case "timeout": return "That took longer than I'm allowed to spend on one question. Try narrowing it and I'll have another go.";
    case "cancelled": return "Stopped.";
    default: return "Something broke while I was working on that, so I don't have an answer I trust. Try again in a moment.";
  }
};

const errorResponse = (error: unknown): Response => {
  if (error instanceof UnauthenticatedError) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (error instanceof ConversationError) return Response.json({ error: error.message }, { status: error.status });
  console.error("conversation request failed", error);
  return Response.json({ error: "Conversation unavailable" }, { status: 500 });
};

export async function POST(req: Request) {
  let body: { content?: unknown; messages?: ChatMessage[]; threadId?: unknown };
  try { body = await req.json(); }
  catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }

  const content = latestUserText(body);
  if (!content) return Response.json({ error: "A user message is required" }, { status: 400 });
  const suppliedThreadId = typeof body.threadId === "string" && body.threadId.trim() ? body.threadId.trim() : undefined;

  let company: { companyId: string };
  try {
    // Auth/onboarding owns company identity; conversation input never supplies it.
    company = await resolveCompanyContext(req);
  } catch (error) {
    return errorResponse(error);
  }

  const store = createConversationStore();
  let run: Run | undefined;

  try {
    // The user message and running run are committed before any model work.
    const activeRun = await store.begin(company.companyId, content, suppliedThreadId);
    run = activeRun;
    const conversation = await store.load(company.companyId, activeRun.threadId);
    if (!conversation) throw new Error("Newly-created conversation could not be loaded");

    const response = await createDataStreamResponse({
      async execute(writer) {
        writer.writeData({ type: "thread", threadId: activeRun.threadId } as unknown as JSONValue);
        let finalized = false;
        try {
          for await (const event of streamSamAgent({
            messages: toLangChainMessages(conversation.messages),
            context: { ...company, threadId: activeRun.threadId },
            runId: activeRun.id,
            signal: req.signal,
          })) {
            if (event.type === "message_delta") writer.write(`0:${JSON.stringify(event.text)}\n` as `0:${string}\n`);
            if (event.type === "run_completed") {
              await store.finish(company.companyId, activeRun.id, "completed", event.text);
              finalized = true;
            } else if (event.type === "run_terminated") {
              await store.finish(company.companyId, activeRun.id, event.outcome === "cancelled" ? "cancelled" : "failed");
              finalized = true;
              writer.write(`0:${JSON.stringify(unfinishedMessage(event.outcome))}\n` as `0:${string}\n`);
            }
            const clientEvent = toClientEvent(event);
            if (clientEvent) writer.writeData(clientEvent as unknown as JSONValue);
          }
        } finally {
          // Covers malformed execution and a stream consumer disconnecting before a terminal event.
          if (!finalized) await store.finish(company.companyId, activeRun.id, req.signal.aborted ? "cancelled" : "failed");
        }
      },
    });
    response.headers.set("x-thread-id", activeRun.threadId);
    return response;
  } catch (error) {
    // A failure between begin and handing off the stream must not strand a running turn.
    if (run) await store.finish(company.companyId, run.id, req.signal.aborted ? "cancelled" : "failed").catch(() => undefined);
    return errorResponse(error);
  }
}
