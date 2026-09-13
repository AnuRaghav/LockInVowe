const getSupabaseKey = (): string => {
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!key) {
    throw new Error(
      "Missing Supabase key. Set NEXT_PUBLIC_SUPABASE_ANON_KEY in .env or .env.local."
    );
  }

  return key;
};

export const getSupabaseConfig = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!url) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL. Set it in .env or .env.local."
    );
  }

  return {
    url,
    key: getSupabaseKey(),
  };
};
