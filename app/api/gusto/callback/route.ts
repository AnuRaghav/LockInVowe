import {
  exchangeGustoCode,
  getGustoAuthorizedCompanies,
} from "@/lib/gusto/client";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Gusto OAuth redirect target. Exchanges the authorization code, looks up
 * which Gusto company the founder authorized (the sandbox demo company, for
 * the MVP), and stores the connection.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const companyId = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return Response.redirect(
      new URL(`/connect?gustoError=${encodeURIComponent(oauthError)}`, url.origin)
    );
  }

  if (!code || !companyId) {
    return Response.json({ error: "Missing code or state." }, { status: 400 });
  }

  try {
    const token = await exchangeGustoCode(code);
    const companies = await getGustoAuthorizedCompanies(token.access_token);
    const gustoCompany = companies[0];

    if (!gustoCompany) {
      throw new Error("Gusto token has no authorized companies.");
    }

    const supabase = createServiceClient();
    const { error } = await supabase.from("payroll_connections").upsert(
      {
        company_id: companyId,
        provider: "gusto",
        provider_company_id: gustoCompany.uuid,
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        access_token_expires_at: new Date(
          Date.now() + token.expires_in * 1000
        ).toISOString(),
        status: "active",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "provider,provider_company_id" }
    );

    if (error) throw error;

    return Response.redirect(new URL("/connect?gustoLinked=1", url.origin));
  } catch (error) {
    console.error("Failed to complete Gusto OAuth", error);
    return Response.redirect(
      new URL("/connect?gustoError=exchange_failed", url.origin)
    );
  }
}
