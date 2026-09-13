import { createServiceClient } from "@/lib/supabase/service";
import type { Database, Json } from "@/lib/supabase/types";
import type { BriefSection, CompanyBrief } from "@/lib/semantic/brief/types";
import type { SemanticScope } from "@/lib/semantic/types";

/**
 * Persistence for the company brief.
 *
 * Versioned rather than overwritten, for one reason: when a founder asks why
 * Sam said something last Tuesday, the answer includes what Sam was told, and a
 * brief that was overwritten cannot be recovered from the blocks alone once
 * those blocks have moved on.
 *
 * The current brief is simply the highest version. There is no `is_current`
 * flag to get out of step with reality.
 */

type ServiceClient = ReturnType<typeof createServiceClient>;
type BriefRow = Database["public"]["Tables"]["company_briefs"]["Row"];

const asJson = (value: unknown): Json => value as Json;

const toBrief = (row: BriefRow): CompanyBrief => ({
  id: row.id,
  version: row.version,
  body: row.body,
  sections: (row.sections ?? []) as BriefSection[],
  fingerprint: row.fingerprint,
  sourceBlockIds: row.source_block_ids ?? [],
  generator: (row.generator ?? {}) as Record<string, unknown>,
  generatedAt: row.generated_at,
});

export interface SaveCompanyBriefInput {
  body: string;
  sections: BriefSection[];
  fingerprint: string;
  sourceBlockIds: string[];
  generator: Record<string, unknown>;
}

export interface CompanyBriefStore {
  /** The current brief, or `null` before one has ever been generated. */
  getCurrent(scope: SemanticScope): Promise<CompanyBrief | null>;
  save(scope: SemanticScope, input: SaveCompanyBriefInput): Promise<CompanyBrief>;
}

const COLUMNS =
  "id, company_id, version, body, sections, fingerprint, source_block_ids, generator, generated_at";

export const createCompanyBriefStore = (client?: ServiceClient): CompanyBriefStore => {
  const supabase = client ?? createServiceClient();

  const getCurrent = async (scope: SemanticScope): Promise<CompanyBrief | null> => {
    const { data, error } = await supabase
      .from("company_briefs")
      .select(COLUMNS)
      .eq("company_id", scope.companyId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data ? toBrief(data) : null;
  };

  return {
    getCurrent,

    async save(scope, input) {
      const current = await getCurrent(scope);
      const version = (current?.version ?? 0) + 1;

      const { data, error } = await supabase
        .from("company_briefs")
        .insert({
          company_id: scope.companyId,
          version,
          body: input.body,
          sections: asJson(input.sections),
          fingerprint: input.fingerprint,
          source_block_ids: input.sourceBlockIds,
          generator: asJson(input.generator),
        })
        .select(COLUMNS)
        .single();

      if (error) {
        // Two generators raced for the same version number. The loser does not
        // retry: a brief is a projection, and the winner's is built from the
        // same state, so returning it is correct rather than merely convenient.
        if (error.code === "23505") {
          const winner = await getCurrent(scope);
          if (winner) return winner;
        }
        throw error;
      }

      return toBrief(data);
    },
  };
};
