import { resolveCompanyContext } from "@/lib/company/context";
import { deriveConnectionId, readEnvironment } from "@/lib/source/rho/adapter";
import { createRhoClient, isRhoEnvironment } from "@/lib/source/rho/client";
import { createStripeClient, readSecretKey } from "@/lib/source/stripe/client";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

/** Lists this company's source connections. Credentials are never returned. */
export async function GET(req: Request) {
  const { companyId } = resolveCompanyContext(req);
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("source_connections")
    .select(
      "id, provider, provider_connection_id, display_name, status, last_synced_at, last_sync_error, created_at"
    )
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to list source connections", error);
    return Response.json({ error: "Failed to list connections." }, { status: 500 });
  }

  return Response.json({ connections: data ?? [] });
}

/**
 * Links a Rho business by API token.
 *
 * Rho has no Link-style handshake: an Account Owner mints a long-lived token in
 * Rho's settings and pastes it in, so unlike Plaid there is no public-token
 * exchange step. That asymmetry is exactly why connection creation is
 * per-provider while everything downstream of it is not.
 */
export async function POST(req: Request) {
  const { companyId } = resolveCompanyContext(req);
  const body = await req.json().catch(() => null);

  if (body?.provider === "stripe") {
    return createStripeConnection(companyId, body);
  }

  if (body?.provider !== "rho") {
    return Response.json(
      {
        error:
          "Only `rho` and `stripe` connections are created here. Plaid uses /api/plaid/exchange-public-token.",
      },
      { status: 400 }
    );
  }

  const apiToken = body?.apiToken;
  if (typeof apiToken !== "string" || !apiToken.trim()) {
    return Response.json({ error: "apiToken is required." }, { status: 400 });
  }

  const environment = isRhoEnvironment(body?.environment)
    ? body.environment
    : readEnvironment({ environment: process.env.RHO_ENV });

  // Verify the credential before storing it, so a typo fails here rather than
  // leaving a permanently broken connection behind.
  try {
    await createRhoClient({ apiToken, environment }).listAccounts({ pageSize: 1 });
  } catch (error) {
    console.error("Rho credential check failed", error);
    return Response.json(
      { error: "Could not reach Rho with that API token." },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("source_connections")
    .upsert(
      {
        company_id: companyId,
        provider: "rho",
        provider_connection_id: deriveConnectionId(apiToken),
        display_name: typeof body?.displayName === "string" ? body.displayName : "Rho",
        credentials: { api_token: apiToken, environment },
        status: "active",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_id,provider,provider_connection_id" }
    )
    .select("id, provider, display_name, status")
    .single();

  if (error) {
    console.error("Failed to store Rho connection", error);
    return Response.json({ error: "Failed to link Rho." }, { status: 500 });
  }

  return Response.json({ connection: data });
}

/**
 * Links the platform Stripe (sandbox) account.
 *
 * Stripe has no Link-style handshake for a first-party integration either,
 * but unlike Rho there is no per-company token to paste: the MVP runs one
 * Stripe sandbox account (provisioned via the Vercel Marketplace) shared by
 * the single development company, keyed by `STRIPE_SECRET_KEY`. A future
 * multi-tenant setup would replace this with Stripe Connect and a real
 * per-company `secret_key` credential; nothing downstream of the connection
 * row would need to change.
 */
async function createStripeConnection(
  companyId: string,
  body: { displayName?: unknown }
) {
  let accountId: string;

  try {
    const secretKey = readSecretKey({});
    const stripe = createStripeClient(secretKey);
    const account = await stripe.accounts.retrieve(null);
    accountId = account.id;
  } catch (error) {
    console.error("Stripe credential check failed", error);
    return Response.json(
      { error: "Could not reach Stripe with the configured secret key." },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("source_connections")
    .upsert(
      {
        company_id: companyId,
        provider: "stripe",
        provider_connection_id: accountId,
        display_name:
          typeof body?.displayName === "string" ? body.displayName : "Stripe (Sandbox)",
        // The secret key itself stays in STRIPE_SECRET_KEY, not here - see
        // lib/source/stripe/client.ts. Recorded only for traceability.
        credentials: { account_id: accountId },
        status: "active",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_id,provider,provider_connection_id" }
    )
    .select("id, provider, display_name, status")
    .single();

  if (error) {
    console.error("Failed to store Stripe connection", error);
    return Response.json({ error: "Failed to link Stripe." }, { status: 500 });
  }

  return Response.json({ connection: data });
}
