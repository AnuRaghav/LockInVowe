import { resolveCompanyContext, UnauthenticatedError } from "@/lib/company/context";
import { ConversationError, createConversationStore } from "@/lib/conversations/store";

export const runtime = "nodejs";

/** Open one conversation. Execution runs remain internal lifecycle state. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const { threadId } = await params;
  try {
    const { companyId } = await resolveCompanyContext(req);
    const conversation = await createConversationStore().load(companyId, threadId);
    if (!conversation) return Response.json({ error: "Thread not found" }, { status: 404 });
    return Response.json({ thread: conversation.thread, messages: conversation.messages });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return Response.json({ error: "Sign in required." }, { status: 401 });
    }
    if (error instanceof ConversationError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("thread request failed", error);
    return Response.json({ error: "Thread unavailable" }, { status: 500 });
  }
}
