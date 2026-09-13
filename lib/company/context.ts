import type { SamContext } from "@/lib/agents/sam/context";

/**
 * TEMPORARY - development-only company resolution.
 *
 * The MVP has no authentication, so there is no real session to resolve a
 * workspace from. Until there is, each *browser* gets its own company via an
 * unguessable, server-issued cookie (see DEV_SESSION_COOKIE and proxy.ts,
 * which mints it) - otherwise every visitor to a shared deployment would
 * collide on one fixed company and see each other's Plaid connections,
 * onboarding answers, and chat history.
 *
 * Replace this whole module when auth lands: `resolveCompanyContext()` should
 * read the authenticated user's session and look up the company (workspace)
 * they are a member of, and it must stop trusting anything client-supplied.
 * Nothing outside this file needs to change - callers already receive a
 * {@link SamContext} they can treat as trusted.
 */

/** Fallback when no session cookie is present yet (e.g. non-browser callers). */
export const DEV_COMPANY_ID = "00000000-0000-4000-8000-000000000001";

/** Dev-only override header, so contributors can exercise multi-company paths locally. */
const DEV_COMPANY_HEADER = "x-dev-company-id";

/**
 * Per-browser dev session cookie name. Minted by proxy.ts on first visit -
 * safe in every environment because the *server* generates the value; a
 * client can only replay a cookie back, never choose one, unlike
 * {@link DEV_COMPANY_HEADER}.
 */
export const DEV_SESSION_COOKIE = "lv_dev_session";

const isProduction = () => process.env.NODE_ENV === "production";

/** Reads one cookie's value out of a raw `Cookie` request header. */
const readCookie = (req: Request | undefined, name: string): string | null => {
  const header = req?.headers.get("cookie");
  if (!header) return null;

  for (const part of header.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = part.slice(0, separatorIndex).trim();
    if (key !== name) continue;

    try {
      return decodeURIComponent(part.slice(separatorIndex + 1).trim());
    } catch {
      return null;
    }
  }

  return null;
};

/**
 * Resolves the company a request operates on.
 *
 * Order: dev-only request header (never honoured in production, and only for
 * contributors deliberately overriding it), then the per-browser session
 * cookie, then `DEV_COMPANY_ID`.
 */
export const resolveCompanyContext = (req?: Request): SamContext => {
  const headerOverride = isProduction()
    ? null
    : req?.headers.get(DEV_COMPANY_HEADER)?.trim() || null;

  const sessionCompanyId = readCookie(req, DEV_SESSION_COOKIE);

  return {
    companyId:
      headerOverride ?? sessionCompanyId ?? process.env.DEV_COMPANY_ID ?? DEV_COMPANY_ID,
  };
};
