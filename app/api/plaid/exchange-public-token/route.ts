import { resolveCompanyContext } from "@/lib/company/context";
import { getPlaidClient } from "@/lib/plaid/client";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

/**
 * Exchanges a Plaid Link `public_token` for a permanent `access_token` and
 * stores it as a source connection. Call this from the client right after
 * Plaid Link's `onSuccess` fires.
 *
 * Plaid-specific by nature - the Link handshake has no analogue in Rho, which
 * is linked with a pasted API token via /api/source/connections. Everything
 * after this point is provider-neutral: sync runs through /api/source/sync.
 */
export async function POST(req: Request) {
  const { companyId } = resolveCompanyContext(req);
  const body = await req.json().catch(() => null);
  const publicToken = body?.publicToken;
  const institutionName = body?.institutionName ?? null;

  if (typeof publicToken !== "string" || !publicToken) {
    return Response.json({ error: "publicToken is required." }, { status: 400 });
  }

  try {
    const plaid = getPlaidClient();
    const exchange = await plaid.itemPublicTokenExchange({
      public_token: publicToken,
    });

    const supabase = createServiceClient();
    // Upsert, not insert: re-linking an Item that already exists should point
    // the existing connection at the new access token rather than failing on
    // the uniqueness constraint, which is what the previous version did.
    const { data, error } = await supabase
      .from("source_connections")
      .upsert(
        {
          company_id: companyId,
          provider: "plaid",
          provider_connection_id: exchange.data.item_id,
          display_name: institutionName,
          credentials: { access_token: exchange.data.access_token },
          status: "active",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "company_id,provider,provider_connection_id" }
      )
      .select("id")
      .single();

    if (error) throw error;

    return Response.json({ connectionId: data.id });
  } catch (error) {
    console.error("Failed to exchange Plaid public token", error);
    return Response.json(
      { error: "Failed to link bank account." },
      { status: 500 }
    );
  }
}
