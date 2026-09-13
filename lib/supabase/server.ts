import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getSupabaseConfig } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/types";

type CookieToSet = {
  name: string;
  value: string;
  options: CookieOptions;
};

export const createClient = async () => {
  const cookieStore = await cookies();
  const { url, key } = getSupabaseConfig();

  return createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Server Components cannot set cookies directly. Middleware/proxy handles refreshes.
        }
      },
    },
  });
};
