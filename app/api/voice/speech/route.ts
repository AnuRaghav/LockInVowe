import { speak } from "@/lib/agents/sam/voice";
import { resolveAuthenticatedCompanyContext, UnauthenticatedError } from "@/lib/company/context";
import { createConversationStore } from "@/lib/conversations/store";

export const runtime = "nodejs";

/** Native browser audio can consume this stream directly. Only saved answers are spoken. */
export async function GET(req: Request) {
  if (req.headers.get("sec-fetch-site") === "cross-site") return new Response(null, { status: 403 });
  try {
    const { companyId } = await resolveAuthenticatedCompanyContext();
    const params = new URL(req.url).searchParams;
    const threadId = params.get("threadId");
    const messageId = params.get("messageId");
    if (!threadId || !messageId) return Response.json({ error: "Message required." }, { status: 400 });
    const conversation = await createConversationStore().load(companyId, threadId);
    const message = conversation?.messages.find(item => item.id === messageId && item.role === "assistant");
    if (!message) return Response.json({ error: "Answer not found." }, { status: 404 });
    if (!message.content.trim() || message.content.length > 20000) {
      return Response.json({ error: "This answer cannot be played." }, { status: 400 });
    }
    const audio = await speak(message.content, req.signal);
    if (!audio) return Response.json({ error: "Voice is not configured." }, { status: 503 });
    return new Response(audio, { headers: {
      "Content-Type": "audio/mpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    return Response.json({ error: error instanceof UnauthenticatedError ? "Sign in required." : "Speech unavailable. Try again." },
      { status: error instanceof UnauthenticatedError ? 401 : 502 });
  }
}
