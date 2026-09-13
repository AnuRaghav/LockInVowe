import type { EmailOtpType } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

/**
 * Where Supabase's confirmation/magic-link emails point (see
 * emailRedirectTo in app/login/page.tsx). Verifies the token from the link
 * and turns it into a real session before sending the founder on.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = url.searchParams.get("next") || "/";

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

    if (!error) {
      return Response.redirect(new URL(next, url.origin));
    }
  }

  const loginUrl = new URL("/login", url.origin);
  loginUrl.searchParams.set("error", "That confirmation link is invalid or expired.");
  return Response.redirect(loginUrl);
}
