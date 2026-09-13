import { CountryCode, Products } from "plaid";

import { resolveCompanyContext } from "@/lib/company/context";
import { getPlaidClient } from "@/lib/plaid/client";

export const runtime = "nodejs";

/**
 * Starts a Plaid Link flow for the current company.
 *
 * `redirect_uri` is only sent when PLAID_REDIRECT_URI is configured - most
 * US institutions now require Plaid's OAuth flow, which redirects the
 * browser away to the bank and back. That return trip must land on a page
 * that is registered in the Plaid Dashboard's allowed redirect URIs *and*
 * matches this exact value, or Plaid rejects the request outright. See
 * app/plaid-oauth/page.tsx, which is what that page resumes into.
 */
export async function POST(req: Request) {
  const { companyId } = resolveCompanyContext(req);

  try {
    const plaid = getPlaidClient();
    const redirectUri = process.env.PLAID_REDIRECT_URI?.trim() || undefined;

    const response = await plaid.linkTokenCreate({
      user: { client_user_id: companyId },
      client_name: "LockInVowe",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: "en",
      ...(redirectUri ? { redirect_uri: redirectUri } : {}),
    });

    return Response.json({ linkToken: response.data.link_token });
  } catch (error) {
    console.error("Failed to create Plaid link token", error);
    return Response.json(
      { error: "Failed to create Plaid link token." },
      { status: 500 }
    );
  }
}
