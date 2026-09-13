import { DEV_SESSION_COOKIE } from "@/lib/company/context";
import { updateSession } from "@/lib/supabase/middleware";
import { type NextRequest } from "next/server";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Gives each browser its own dev-mode company (see lib/company/context.ts) by
 * minting a random session id on first visit. Runs in every environment,
 * including a shared preview/production deployment - the value is generated
 * here, server-side, never accepted from the client, so it carries none of
 * the risk a client-suppliable identifier would.
 *
 * Mutating `request.cookies` (rather than only `response.cookies`) makes the
 * new cookie visible to this same request once it reaches a route handler,
 * not just to the browser on the *next* one.
 */
const ensureDevSessionCookie = (request: NextRequest): string | null => {
  if (request.cookies.get(DEV_SESSION_COOKIE)?.value) return null;

  const id = crypto.randomUUID();
  request.cookies.set(DEV_SESSION_COOKIE, id);
  return id;
};

export async function proxy(request: NextRequest) {
  const newSessionId = ensureDevSessionCookie(request);
  const response = await updateSession(request);

  if (newSessionId) {
    response.cookies.set(DEV_SESSION_COOKIE, newSessionId, {
      path: "/",
      sameSite: "lax",
      maxAge: ONE_YEAR_SECONDS,
    });
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public (public files)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\.svg).*)",
  ],
};
