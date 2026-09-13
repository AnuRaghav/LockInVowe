import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import { createDataStreamResponse, type JSONValue } from "ai";

import { runSamAgent, type SamRunOutcome } from "@/lib/agents/sam";
import { resolveCompanyContext } from "@/lib/company/context";

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
        langChainMessages.push(new SystemMessage(text));
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
  // conversation and never from a tool argument. TEMPORARY: with no auth yet
  // this returns a fixed development company. See `lib/company/context.ts`.
  //
  // `threadId` scopes working memory to this conversation. Long-lived company
  // knowledge is *not* scoped by it: it is reached through the memory module,
  // which is why a fact learned in one thread is available in the next.
  const context = {
    ...resolveCompanyContext(req),
    threadId: typeof threadId === "string" && threadId.trim() ? threadId.trim() : undefined,
  };

  return createDataStreamResponse({
    async execute(writer) {
      const result = await runSamAgent({
        messages: toLangChainMessages(messages),
        context,
        // A founder who closes the tab should not keep paying for the run.
        signal: req.signal,
      });

      // A run that stopped against a budget, a deadline, or a provider failure
      // has no answer to show. Say so rather than streaming a blank turn that
      // reads like Sam had nothing to say.
      const text = result.ok ? result.text : unfinishedMessage(result.outcome);
      writer.write(`0:${JSON.stringify(text)}\n` as `0:${string}\n`);

      writer.writeData({
        runId: result.run.runId,
        outcome: result.outcome,
        degraded: result.degraded,
        ...(result.toolCalls.length > 0 ? { toolCalls: result.toolCalls } : {}),
      } as unknown as JSONValue);
    },
  });
}
