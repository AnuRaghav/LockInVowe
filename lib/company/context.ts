import { createClient } from "@/lib/supabase/server";

/**
 * Company and founder resolution, backed by real Supabase Auth.
 *
 * Every founder is their own company for now - `companyId` *is* the
 * authenticated user's id, so there is no separate membership table to keep in
 * sync yet. Add one (and a lookup here) the day a company needs more than one
 * member; nothing outside this file needs to change.
 *
 * `founderId` is the person, and is always the user id. It equals `companyId`
 * today, but the two are separate fields on purpose: founder state (profile,
 * communication preferences, personal answers) is scoped by the person, and a
 * co-founder must never read it through the company they share.
 */

/** Who a request is for. Trusted: resolved from Auth, never from input. */
export interface RequestIdentity {
  companyId: string;
  founderId: string;
}

/** Thrown when a route requires a signed-in founder and there isn't one. */
export class UnauthenticatedError extends Error {
  constructor() {
    super("Not signed in.");
    this.name = "UnauthenticatedError";
  }
}

/** Dev-only override header, so contributors can exercise multi-company paths locally. */
const DEV_COMPANY_HEADER = "x-dev-company-id";

const isProduction = () => process.env.NODE_ENV === "production";

/**
 * Resolves the company the current request operates on from the Supabase
 * Auth session cookie.
 *
 * `req` is only consulted for the dev-only override header (never honoured
 * in production) - the session itself is read from cookies via
 * `lib/supabase/server.ts`, which works from any Route Handler without the
 * request object.
 *
 * @throws {UnauthenticatedError} when there is no signed-in founder.
 */
export const resolveCompanyContext = async (req?: Request): Promise<RequestIdentity> => {
  const headerOverride = isProduction()
    ? null
    : req?.headers.get(DEV_COMPANY_HEADER)?.trim() || null;

  if (headerOverride) {
    // A dev company stands in for its founder too, as a real account does.
    return { companyId: headerOverride, founderId: headerOverride };
  }

  return resolveAuthenticatedCompanyContext();
};

/** Always verifies Auth, including local development. No request/header identity override. */
export const resolveAuthenticatedCompanyContext = async (): Promise<RequestIdentity> => {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new UnauthenticatedError();
  }

  return { companyId: user.id, founderId: user.id };
};
