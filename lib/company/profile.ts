import { createServiceClient } from "@/lib/supabase/service";

/**
 * What the company is called and what it does, in the founder's words.
 *
 * Display-level only. The fuller account lives in the `company-overview`
 * semantic block; this is what a header or a greeting shows.
 */
export interface CompanyProfile {
  name?: string;
  description?: string;
}

export interface StoredCompanyProfile {
  name: string | null;
  description: string | null;
}

export const readCompanyProfile = async (companyId: string): Promise<StoredCompanyProfile> => {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("companies")
    .select("name, description")
    .eq("id", companyId)
    .maybeSingle();

  if (error) throw error;
  return { name: data?.name ?? null, description: data?.description ?? null };
};

/** Sets whichever fields are given; fields left out keep their stored value. */
export const saveCompanyProfile = async (companyId: string, profile: CompanyProfile): Promise<void> => {
  const supabase = createServiceClient();
  const { error } = await supabase.from("companies").upsert(
    {
      id: companyId,
      ...(profile.name !== undefined && { name: profile.name }),
      ...(profile.description !== undefined && { description: profile.description }),
    },
    { onConflict: "id" }
  );

  if (error) throw error;
};
