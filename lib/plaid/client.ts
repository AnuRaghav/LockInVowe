import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

/**
 * Shared Plaid client. Sandbox by default - set PLAID_ENV to move to
 * `development` or `production` once real institutions are needed.
 */
const getPlaidConfig = () => {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;

  if (!clientId || !secret) {
    throw new Error(
      "Missing Plaid credentials. Set PLAID_CLIENT_ID and PLAID_SECRET in .env.local."
    );
  }

  const env = process.env.PLAID_ENV ?? "sandbox";
  const basePath =
    PlaidEnvironments[env as keyof typeof PlaidEnvironments] ??
    PlaidEnvironments.sandbox;

  return new Configuration({
    basePath,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": clientId,
        "PLAID-SECRET": secret,
      },
    },
  });
};

let cachedClient: PlaidApi | null = null;

export const getPlaidClient = (): PlaidApi => {
  if (!cachedClient) {
    cachedClient = new PlaidApi(getPlaidConfig());
  }
  return cachedClient;
};
