import { streamText } from "ai";
import { model } from "@/lib/ai/provider";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model,
    system:
      "You are a helpful CFO/Operations assistant for startup founders. Help them delegate and manage financial and operational tasks.",
    messages,
  });

  return (await result).toDataStreamResponse();
}
