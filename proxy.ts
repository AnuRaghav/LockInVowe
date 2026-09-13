import { updateSession } from "@/lib/supabase/middleware";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabaseConfig } from "@/lib/supabase/env";

/** Reachable without a signed-in founder. Everything else redirects to /login. */
const PUBLIC_PATHS = ["/", "/login", "/signup", "/auth"];

const isPublicPath = (pathname: string) =>
  PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));

export async function proxy(request: NextRequest) {
  const response = await updateSession(request);
  const { pathname } = request.nextUrl;

  // API routes enforce auth themselves (resolveCompanyContext throws
  // UnauthenticatedError, routes turn that into a 401) - a redirect here
  // would hand a fetch() caller an HTML login page instead of JSON.
  if (pathname.startsWith("/api/") || isPublicPath(pathname)) {
    return response;
  }

  const { url, key } = getSupabaseConfig();
  const supabase = createServerClient(url, key, {
    cookies: { getAll: () => request.cookies.getAll() },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
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
