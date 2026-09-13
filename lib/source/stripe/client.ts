import Stripe from "stripe";

/**
 * Shared Stripe client factory.
 *
 * Unlike Rho (hand-rolled REST client) and like Plaid, Stripe publishes an
 * official Node SDK, so the adapter talks to that directly rather than
 * reinventing pagination and error handling.
 *
 * One MVP business runs one Stripe account, so the secret key is a platform
 * setting (`STRIPE_SECRET_KEY`, provisioned via the Vercel Stripe sandbox
 * integration) rather than a per-connection credential pasted through the UI
 * the way Rho's API token is. `readSecretKey` still reads it from the
 * connection's `credentials` bag first, so a future multi-tenant Stripe
 * Connect setup only has to change how a connection is created, not the
 * adapter.
 */
export const readSecretKey = (credentials: Record<string, unknown>): string => {
  const fromCredentials = credentials.secret_key;
  if (typeof fromCredentials === "string" && fromCredentials) return fromCredentials;

  const fromEnv = process.env.STRIPE_SECRET_KEY;
  if (fromEnv) return fromEnv;

  throw new Error(
    "Missing Stripe credentials. Set STRIPE_SECRET_KEY in .env.local or store a secret_key on the connection."
  );
};

export const createStripeClient = (secretKey: string): Stripe =>
  new Stripe(secretKey, {
    // Pinned so a Stripe-side API upgrade cannot silently change field shapes
    // the mapper below relies on.
    apiVersion: "2026-08-26.dahlia",
  });
