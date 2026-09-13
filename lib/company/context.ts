import { createClient } from "@/lib/supabase/server";
import type { SamContext } from "@/lib/agents/sam/context";

/**
 * Company resolution, backed by real Supabase Auth.
 *
 * Every founder is their own company for now - {@link SamContext.companyId}
 * *is* the authenticated user's id, so there is no separate membership table
 * to keep in sync yet. Add one (and a lookup here) the day a company needs
 * more than one member; nothing outside this file needs to change - callers
 * already receive a {@link SamContext} they can treat as trusted.
 */

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
export const resolveCompanyContext = async (req?: Request): Promise<SamContext> => {
  const headerOverride = isProduction()
    ? null
    : req?.headers.get(DEV_COMPANY_HEADER)?.trim() || null;

  if (headerOverride) {
    return { companyId: headerOverride };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new UnauthenticatedError();
  }

  return { companyId: user.id };
};
