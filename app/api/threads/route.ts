import { resolveCompanyContext, UnauthenticatedError } from "@/lib/company/context";
import { ConversationError, createConversationStore } from "@/lib/conversations/store";

export const runtime = "nodejs";

const failure = (error: unknown): Response => {
  if (error instanceof UnauthenticatedError) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (error instanceof ConversationError) return Response.json({ error: error.message }, { status: error.status });
  console.error("thread request failed", error);
  return Response.json({ error: "Threads unavailable" }, { status: 500 });
};

/** List conversations belonging to the request's trusted company scope. */
export async function GET(req: Request) {
  try {
    const { companyId } = await resolveCompanyContext(req);
    return Response.json({ threads: await createConversationStore().listThreads(companyId) });
  } catch (error) {
    return failure(error);
  }
}

/** Create an empty conversation with an optional human-supplied display name. */
export async function POST(req: Request) {
  let body: { name?: unknown } = {};
  try {
    const raw = await req.text();
    if (raw.trim()) {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return Response.json({ error: "Body must be an object" }, { status: 400 });
      }
      body = parsed as { name?: unknown };
    }
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.name !== undefined && typeof body.name !== "string") {
    return Response.json({ error: "name must be a string" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : undefined;
  if (body.name !== undefined && !name) {
    return Response.json({ error: "name cannot be empty" }, { status: 400 });
  }

  try {
    const { companyId } = await resolveCompanyContext(req);
    const thread = await createConversationStore().createThread(companyId, name);
    return Response.json({ thread }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
