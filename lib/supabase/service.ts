import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. Bypasses RLS - server-only, never import
 * from client components or expose the key to the browser.
 *
 * Needed for tables like `bank_connections` that hold no RLS policies yet
 * (see supabase/migrations/20260913025944_bank_connectors.sql): until real
 * auth exists, this is the only client allowed to touch them.
 *
 * Left untyped against `Database` on purpose: that file is still the
 * pre-migration placeholder (see lib/supabase/types.ts). Re-parametrize with
 * `Database` once `npm run db:types` has been run against a migrated DB.
 */
export const createServiceClient = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing Supabase service credentials. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local."
    );
  }

  return createSupabaseClient(url, key, {
    auth: { persistSession: false },
  });
};
