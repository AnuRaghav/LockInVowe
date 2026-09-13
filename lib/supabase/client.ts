import { createBrowserClient } from "@supabase/ssr";

import { getSupabaseConfig } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/types";

export const createClient = () => {
  const { url, key } = getSupabaseConfig();

  return createBrowserClient<Database>(url, key);
};
