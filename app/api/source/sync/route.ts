import { resolveCompanyContext } from "@/lib/company/context";
import { SourceConnectionNotFoundError, syncSourceConnection } from "@/lib/source";

export const runtime = "nodejs";

/**
 * Pulls the latest data for one source connection.
 *
 * Provider-neutral by construction: the body names a connection, and the
 * connection knows its own provider. This replaces the old
 * `/api/plaid/sync` route, which had Plaid's cursor model and sign conventions
 * written into the handler.
 */
export async function POST(req: Request) {
  let companyId: string;
  try {
    companyId = (await resolveCompanyContext(req)).companyId;
  } catch {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const connectionId = body?.connectionId;

  if (typeof connectionId !== "string" || !connectionId) {
    return Response.json({ error: "connectionId is required." }, { status: 400 });
  }

  try {
    const result = await syncSourceConnection({
      companyId,
      connectionId,
      signal: req.signal,
    });

    return Response.json({
      connectionId: result.connectionId,
      provider: result.provider,
      syncId: result.syncId,
      counts: result.counts,
    });
  } catch (error) {
    if (error instanceof SourceConnectionNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }

    console.error("Source sync failed", error);
    return Response.json({ error: "Failed to sync source connection." }, { status: 500 });
  }
}
