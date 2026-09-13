import { createServiceClient } from "@/lib/supabase/service";
import type { Database, Json } from "@/lib/supabase/types";
import { CURRENT_STATUSES, type SemanticProvenance } from "@/lib/semantic/types";
import {
  FounderSensitivityDowngradeError,
  UnknownFounderBlockError,
  type FounderBlock,
  type FounderBlockRef,
  type FounderBlockStore,
  type FounderReadOptions,
  type FounderRevision,
  type FounderScope,
  type RevisedFounderBlock,
} from "@/lib/founder/types";
import {
  applyContractPatch,
  contractPatchSchema,
  type CommunicationContract,
  type CommunicationContractPatch,
  type CommunicationContractStore,
  type FounderAlert,
} from "@/lib/founder/contract";

/**
 * Persistence for the Founder Model.
 *
 * The only module that knows founder state is Postgres. Like `lib/semantic/store.ts`,
 * atomic writes live in database functions (`founder_block_revise`,
 * `founder_contract_revise`) because supabase-js has no transactions, and
 * ranking lives in `founder_block_search`.
 *
 * Personal blocks are filtered on every read path here, not just in search, so
 * `includePersonal` means the same thing whichever method a caller reaches for.
 */

type ServiceClient = ReturnType<typeof createServiceClient>;
type BlockRow = Omit<Database["public"]["Tables"]["founder_blocks"]["Row"], "search">;
type RevisionRow = Database["public"]["Tables"]["founder_block_revisions"]["Row"];
type ContractRow = Database["public"]["Tables"]["founder_communication_contract_revisions"]["Row"];

const asJson = (value: unknown): Json => (value ?? {}) as Json;
const optional = <T>(value: T | null): T | undefined => value ?? undefined;

const BLOCK_COLUMNS =
  "id, founder_id, key, title, summary, body, labels, status, sensitivity, salience, confidence, as_of, provenance, attributes, revision, current_revision_id, created_at, updated_at";

const REVISION_COLUMNS =
  "id, founder_id, block_id, revision, title, summary, body, labels, status, sensitivity, salience, confidence, as_of, provenance, attributes, change_kind, change_note, supersedes_revision_id, recorded_at, superseded_at";

const toBlock = (row: BlockRow): FounderBlock => ({
  id: row.id,
  key: row.key,
  title: row.title,
  summary: optional(row.summary),
  body: row.body,
  labels: row.labels ?? [],
  status: row.status,
  sensitivity: row.sensitivity,
  salience: Number(row.salience),
  confidence: row.confidence === null ? undefined : Number(row.confidence),
  asOf: optional(row.as_of),
  provenance: (row.provenance ?? {}) as SemanticProvenance,
  attributes: (row.attributes ?? {}) as Record<string, unknown>,
  revision: row.revision,
  currentRevisionId: optional(row.current_revision_id),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toRevision = (row: RevisionRow, blockKey: string): FounderRevision => ({
  id: row.id,
  blockId: row.block_id,
  blockKey,
  revision: row.revision,
  title: row.title,
  summary: optional(row.summary),
  body: row.body,
  labels: row.labels ?? [],
  status: row.status,
  sensitivity: row.sensitivity,
  salience: Number(row.salience),
  confidence: row.confidence === null ? undefined : Number(row.confidence),
  asOf: optional(row.as_of),
  provenance: (row.provenance ?? {}) as SemanticProvenance,
  attributes: (row.attributes ?? {}) as Record<string, unknown>,
  changeKind: row.change_kind,
  changeNote: optional(row.change_note),
  supersedesRevisionId: optional(row.supersedes_revision_id),
  recordedAt: row.recorded_at,
  supersededAt: optional(row.superseded_at),
});

const DEFAULT_SEARCH_LIMIT = 5;
const DEFAULT_LIST_LIMIT = 50;
const DEFAULT_HISTORY_LIMIT = 20;

const SENSITIVITY_DOWNGRADE = /sensitivity only increases/;

export const createFounderBlockStore = (client?: ServiceClient): FounderBlockStore => {
  const supabase = client ?? createServiceClient();

  /** Resolves a ref within one founder, honouring the personal filter. */
  const resolve = async (
    scope: FounderScope,
    ref: FounderBlockRef,
    options: FounderReadOptions = {}
  ): Promise<{ id: string; key: string } | null> => {
    let query = supabase.from("founder_blocks").select("id, key").eq("founder_id", scope.founderId);
    if (!options.includePersonal) query = query.eq("sensitivity", "standard");

    const { data, error } = await ("key" in ref
      ? query.eq("key", ref.key)
      : query.eq("id", ref.id)
    ).maybeSingle();

    if (error) throw error;
    return data ?? null;
  };

  return {
    async getBlock(scope, ref, options = {}) {
      let query = supabase
        .from("founder_blocks")
        .select(BLOCK_COLUMNS)
        .eq("founder_id", scope.founderId);
      if (!options.includePersonal) query = query.eq("sensitivity", "standard");

      const { data, error } = await ("key" in ref
        ? query.eq("key", ref.key)
        : query.eq("id", ref.id)
      ).maybeSingle();

      if (error) throw error;
      return data ? toBlock(data) : null;
    },

    async listCurrentBlocks(scope, query = {}) {
      let builder = supabase
        .from("founder_blocks")
        .select(BLOCK_COLUMNS)
        .eq("founder_id", scope.founderId)
        .in("status", query.statuses ?? [...CURRENT_STATUSES])
        .order("salience", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(query.limit ?? DEFAULT_LIST_LIMIT);

      if (!query.includePersonal) builder = builder.eq("sensitivity", "standard");
      if (query.labels?.length) builder = builder.overlaps("labels", query.labels);
      if (query.minSalience !== undefined) builder = builder.gte("salience", query.minSalience);

      const { data, error } = await builder;
      if (error) throw error;
      return (data ?? []).map(toBlock);
    },

    async searchCurrentBlocks(scope, query) {
      const { data, error } = await supabase.rpc("founder_block_search", {
        p_founder_id: scope.founderId,
        p_text: query.text ?? undefined,
        p_statuses: query.statuses ?? [...CURRENT_STATUSES],
        p_labels: query.labels?.length ? query.labels : undefined,
        p_include_personal: query.includePersonal ?? false,
        p_limit: query.limit ?? DEFAULT_SEARCH_LIMIT,
      });

      if (error) throw error;
      return (data ?? []).map((row) => toBlock(row as BlockRow));
    },

    async getBlockHistory(scope, ref, query = {}) {
      const block = await resolve(scope, ref, query);
      if (!block) throw new UnknownFounderBlockError(ref);

      const { data, error } = await supabase
        .from("founder_block_revisions")
        .select(REVISION_COLUMNS)
        .eq("founder_id", scope.founderId)
        .eq("block_id", block.id)
        .order("revision", { ascending: false })
        .limit(query.limit ?? DEFAULT_HISTORY_LIMIT);

      if (error) throw error;
      return (data ?? []).map((row) => toRevision(row, block.key));
    },

    async reviseBlock(scope, input) {
      const { data, error } = await supabase.rpc("founder_block_revise", {
        p_founder_id: scope.founderId,
        p_key: input.key,
        p_title: input.title,
        p_body: input.body,
        p_summary: input.summary ?? undefined,
        p_labels: input.labels ?? [],
        p_status: input.status ?? "active",
        p_sensitivity: input.sensitivity ?? undefined,
        p_salience: input.salience ?? 0.5,
        p_confidence: input.confidence ?? undefined,
        p_as_of: input.asOf ?? undefined,
        p_provenance: asJson(input.provenance),
        p_attributes: asJson(input.attributes),
        p_change_kind: input.changeKind ?? undefined,
        p_change_note: input.changeNote ?? undefined,
        p_recorded_at: input.recordedAt ?? undefined,
      });

      if (error) {
        if (SENSITIVITY_DOWNGRADE.test(error.message)) {
          throw new FounderSensitivityDowngradeError(input.key);
        }
        throw error;
      }

      const [result] = data ?? [];
      if (!result) throw new Error(`founder_block_revise returned no row for "${input.key}".`);

      return {
        blockId: result.block_id,
        revisionId: result.revision_id,
        revision: result.revision,
        created: result.created,
      } satisfies RevisedFounderBlock;
    },

    async deleteBlock(scope, ref) {
      // Deletion is not a read: a personal block must be erasable without the
      // caller first having to ask to see it.
      const block = await resolve(scope, ref, { includePersonal: true });
      if (!block) return false;

      const { error } = await supabase
        .from("founder_blocks")
        .delete()
        .eq("founder_id", scope.founderId)
        .eq("id", block.id);

      if (error) throw error;
      return true;
    },
  };
};

const toContract = (row: ContractRow): CommunicationContract => ({
  id: row.id,
  revision: row.revision,
  badNews: optional(row.bad_news) as CommunicationContract["badNews"],
  detail: optional(row.detail) as CommunicationContract["detail"],
  recommendations: optional(row.recommendations) as CommunicationContract["recommendations"],
  pushback: optional(row.pushback) as CommunicationContract["pushback"],
  flagOptimisticAssumptions: optional(row.flag_optimistic_assumptions),
  financeFluency: optional(row.finance_fluency) as CommunicationContract["financeFluency"],
  alerts: (row.alerts ?? []) as unknown as FounderAlert[],
  provenance: (row.provenance ?? {}) as SemanticProvenance,
  changeKind: row.change_kind,
  changeNote: optional(row.change_note),
  recordedAt: row.recorded_at,
});

/** camelCase patch -> the column names `founder_contract_revise` merges on. */
const toColumnPatch = (patch: CommunicationContractPatch): Record<string, unknown> => {
  const columns: Record<keyof CommunicationContractPatch, string> = {
    badNews: "bad_news",
    detail: "detail",
    recommendations: "recommendations",
    pushback: "pushback",
    flagOptimisticAssumptions: "flag_optimistic_assumptions",
    financeFluency: "finance_fluency",
    alerts: "alerts",
  };

  return Object.fromEntries(
    Object.entries(patch).map(([field, value]) => [
      columns[field as keyof CommunicationContractPatch],
      value,
    ])
  );
};

const CONTRACT_COLUMNS =
  "id, founder_id, revision, bad_news, detail, recommendations, pushback, flag_optimistic_assumptions, finance_fluency, alerts, provenance, change_kind, change_note, recorded_at";

export const createCommunicationContractStore = (
  client?: ServiceClient
): CommunicationContractStore => {
  const supabase = client ?? createServiceClient();

  return {
    async getCurrent(scope) {
      const { data, error } = await supabase
        .from("founder_communication_contract_revisions")
        .select(CONTRACT_COLUMNS)
        .eq("founder_id", scope.founderId)
        .order("revision", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data ? toContract(data) : null;
    },

    async getHistory(scope, query = {}) {
      const { data, error } = await supabase
        .from("founder_communication_contract_revisions")
        .select(CONTRACT_COLUMNS)
        .eq("founder_id", scope.founderId)
        .order("revision", { ascending: false })
        .limit(query.limit ?? DEFAULT_HISTORY_LIMIT);

      if (error) throw error;
      return (data ?? []).map(toContract);
    },

    async revise(scope, input) {
      const patch = contractPatchSchema.parse(input.patch);

      const { data, error } = await supabase.rpc("founder_contract_revise", {
        p_founder_id: scope.founderId,
        p_patch: toColumnPatch(patch) as Json,
        p_provenance: asJson(input.provenance),
        p_change_kind: input.changeKind ?? undefined,
        p_change_note: input.changeNote ?? undefined,
      });

      if (error) throw error;
      if (!data) throw new Error("founder_contract_revise returned no row.");
      return toContract(data as ContractRow);
    },
  };
};

export { applyContractPatch };
