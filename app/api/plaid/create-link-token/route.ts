import { CountryCode, Products } from "plaid";

import { resolveCompanyContext } from "@/lib/company/context";
import { getPlaidClient } from "@/lib/plaid/client";

/** Starts a Plaid Link flow for the current company. */
export async function POST(req: Request) {
  const { companyId } = resolveCompanyContext(req);

  try {
    const plaid = getPlaidClient();
    const response = await plaid.linkTokenCreate({
      user: { client_user_id: companyId },
      client_name: "LockInVowe",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: "en",
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
