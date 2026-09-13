import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import { createDataStreamResponse, type JSONValue } from "ai";

import { runSamAgent } from "@/lib/agents/sam";

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

export async function POST(req: Request) {
  const { messages = [] } = (await req.json()) as { messages?: ChatMessage[] };

  return createDataStreamResponse({
    async execute(writer) {
      const result = await runSamAgent({
        messages: toLangChainMessages(messages),
      });

      writer.write(`0:${JSON.stringify(result.text)}\n` as `0:${string}\n`);

      if (result.toolCalls.length > 0) {
        writer.writeData({ toolCalls: result.toolCalls } as unknown as JSONValue);
      }
    },
  });
}
