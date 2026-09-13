import { resolveCompanyContext, UnauthenticatedError } from "@/lib/company/context";
import { attachChartsToMessages, createConversationChartStore } from "@/lib/conversations/charts";
import { ConversationError, createConversationStore, normalizeThreadName } from "@/lib/conversations/store";

export const runtime = "nodejs";

type Params = { params: Promise<{ threadId: string }> };

const failure = (error: unknown): Response => {
  if (error instanceof UnauthenticatedError) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }
  if (error instanceof ConversationError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error("thread request failed", error);
  return Response.json({ error: "Thread unavailable" }, { status: 500 });
};

/** Open one conversation. Execution runs remain internal lifecycle state. */
export async function GET(req: Request, { params }: Params) {
  const { threadId } = await params;
  try {
    const { companyId } = await resolveCompanyContext(req);
    const conversation = await createConversationStore().load(companyId, threadId);
    if (!conversation) return Response.json({ error: "Thread not found" }, { status: 404 });
    // Charts decorate answers; failing to read them must not hide the conversation.
    const charts = await createConversationChartStore().listForThread(companyId, threadId).catch((error) => {
      console.error("thread charts unavailable", error);
      return [];
    });
    return Response.json({
      thread: conversation.thread,
      messages: attachChartsToMessages(conversation.messages, conversation.runs, charts),
    });
  } catch (error) {
    return failure(error);
  }
}

/** Rename a conversation. */
export async function PATCH(req: Request, { params }: Params) {
  const { threadId } = await params;
  let body: { name?: unknown };
  try { body = await req.json(); }
  catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }

  const name = normalizeThreadName(body?.name);
  if (!name) return Response.json({ error: "name must be a non-empty string" }, { status: 400 });

  try {
    const { companyId } = await resolveCompanyContext(req);
    const thread = await createConversationStore().renameThread(companyId, threadId, name);
    return Response.json({ thread });
  } catch (error) {
    return failure(error);
  }
}

/** Delete a conversation and everything in it. Refused while Sam is answering. */
export async function DELETE(req: Request, { params }: Params) {
  const { threadId } = await params;
  try {
    const { companyId } = await resolveCompanyContext(req);
    await createConversationStore().deleteThread(companyId, threadId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return failure(error);
  }
}
