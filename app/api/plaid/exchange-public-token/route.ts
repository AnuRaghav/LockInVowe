import { resolveCompanyContext } from "@/lib/company/context";
import { getPlaidClient } from "@/lib/plaid/client";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Exchanges a Plaid Link `public_token` for a permanent `access_token` and
 * stores the resulting connection. Call this from the client right after
 * Plaid Link's `onSuccess` fires.
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
    const { data, error } = await supabase
      .from("bank_connections")
      .insert({
        company_id: companyId,
        provider: "plaid",
        provider_item_id: exchange.data.item_id,
        access_token: exchange.data.access_token,
        institution_name: institutionName,
      })
      .select("id")
      .single();

    if (error) throw error;

    return Response.json({ bankConnectionId: data.id });
  } catch (error) {
    console.error("Failed to exchange Plaid public token", error);
    return Response.json(
      { error: "Failed to link bank account." },
      { status: 500 }
    );
  }
}
