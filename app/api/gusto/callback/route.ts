import {
  decodeGustoOAuthState,
  exchangeGustoCode,
  getGustoAuthorizedCompanies,
  type GustoReturnPath,
} from "@/lib/gusto/client";
import { syncGustoConnection } from "@/lib/gusto/sync";
import { createServiceClient } from "@/lib/supabase/service";

const redirectBack = (
  origin: string,
  returnTo: GustoReturnPath,
  params: Record<string, string>
) => {
  const target = new URL(returnTo, origin);
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
  return Response.redirect(target);
};

/**
 * Gusto OAuth redirect target. Exchanges the authorization code, looks up the
 * Gusto company the founder authorized, stores the connection, runs the first
 * sync, then sends the founder back to the page that started the flow.
 *
 * The first sync runs here rather than client-side on return so onboarding
 * lands back with payroll already in the model. A failed sync still keeps the
 * connection - the founder can retry from "Sync payroll".
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const state = decodeGustoOAuthState(url.searchParams.get("state"));
  const returnTo = state?.returnTo ?? "/connect";
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return redirectBack(url.origin, returnTo, { gustoError: oauthError });
  }

  if (!code || !state) {
    return redirectBack(url.origin, returnTo, { gustoError: "Missing code or state." });
  }

  let payrollConnectionId: string;

  try {
    const token = await exchangeGustoCode(code);
    const [gustoCompany] = await getGustoAuthorizedCompanies(token.access_token);

    if (!gustoCompany) {
      throw new Error("Gusto token has no authorized company.");
    }

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("payroll_connections")
      .upsert(
        {
          company_id: state.companyId,
          provider: "gusto",
          provider_company_id: gustoCompany.uuid,
          access_token: token.access_token,
          refresh_token: token.refresh_token,
          access_token_expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
          status: "active",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "provider,provider_company_id" }
      )
      .select("id")
      .single();

    if (error) throw error;
    payrollConnectionId = data.id;
  } catch (error) {
    console.error("Failed to complete Gusto OAuth", error);
    // Surfaced in the URL rather than only logged, so a failure is debuggable
    // without a terminal attached to the dev server.
    const message = error instanceof Error ? error.message : "Couldn't connect Gusto.";
    return redirectBack(url.origin, returnTo, { gustoError: message });
  }

  try {
    const result = await syncGustoConnection({ companyId: state.companyId, payrollConnectionId });
    return redirectBack(url.origin, returnTo, {
      gustoLinked: "1",
      gustoEmployees: String(result.employeesSynced),
      gustoPayrolls: String(result.payrollRunsSynced),
    });
  } catch (error) {
    console.error("Gusto connected but the first sync failed", error);
    const message = error instanceof Error ? error.message : "Sync failed.";
    return redirectBack(url.origin, returnTo, { gustoLinked: "1", gustoSyncError: message });
  }
}
