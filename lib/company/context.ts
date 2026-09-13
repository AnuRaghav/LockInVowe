import type { SamContext } from "@/lib/agents/sam/context";

/**
 * TEMPORARY - development-only company resolution.
 *
 * The MVP has no authentication, so there is no session to resolve a workspace
 * from. Until there is, every request runs as one fixed development company.
 *
 * Replace this whole module when auth lands: `resolveCompanyContext()` should
 * read the authenticated user's session and look up the company (workspace)
 * they are a member of, and it must stop trusting anything client-supplied.
 * Nothing outside this file needs to change - callers already receive a
 * {@link SamContext} they can treat as trusted.
 */

/** Fixed company used by every request until auth exists. Override with `DEV_COMPANY_ID`. */
export const DEV_COMPANY_ID = "00000000-0000-4000-8000-000000000001";

/** Dev-only override header, so contributors can exercise multi-company paths locally. */
const DEV_COMPANY_HEADER = "x-dev-company-id";

const isProduction = () => process.env.NODE_ENV === "production";

/**
 * Resolves the company a request operates on.
 *
 * Order: dev-only request header (never honoured in production), then
 * `DEV_COMPANY_ID`, then the built-in development company.
 */
export const resolveCompanyContext = (req?: Request): SamContext => {
  const headerOverride = isProduction()
    ? null
    : req?.headers.get(DEV_COMPANY_HEADER)?.trim() || null;

  return {
    companyId: headerOverride ?? process.env.DEV_COMPANY_ID ?? DEV_COMPANY_ID,
  };
};
