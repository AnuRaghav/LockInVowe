import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/types";

/**
 * Service-role Supabase client. Bypasses RLS - server-only, never import
 * from client components or expose the key to the browser.
 *
 * Needed for the `source_*` tables, which hold no RLS policies yet (see
 * supabase/migrations/20260913071500_source_layer.sql): until real auth
 * exists, this is the only client allowed to touch them.
 */
export const createServiceClient = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing Supabase service credentials. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local."
    );
  }

  return createSupabaseClient<Database>(url, key, {
    auth: { persistSession: false },
  });
};
