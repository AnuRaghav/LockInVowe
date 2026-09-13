import { createClient } from "@/lib/supabase/server";

/** Signs the current founder out and sends them back to /login. */
export async function POST(req: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return Response.redirect(new URL("/login", req.url));
}
