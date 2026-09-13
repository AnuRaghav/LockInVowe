import { createServiceClient } from "@/lib/supabase/service";
import type { Database, Json } from "@/lib/supabase/types";
import {
  CURRENT_STATUSES,
  UnknownSemanticBlockError,
  type ListSemanticBlocksQuery,
  type ReviseSemanticBlockInput,
  type RevisedSemanticBlock,
  type SearchSemanticBlocksQuery,
  type SemanticBlock,
  type SemanticBlockRef,
  type SemanticBlockStore,
  type SemanticHistoryQuery,
  type SemanticProvenance,
  type SemanticRevision,
  type SemanticScope,
} from "@/lib/semantic/types";

/**
 * Persistence for the Semantic Company Model.
 *
 * The only module that knows `semantic_blocks` and `semantic_block_revisions`
 * are tables. Everything above it works in {@link SemanticBlock}s and
 * {@link SemanticRevision}s and could not tell you what a tsvector is - which
 * is the requirement that Sam never has to understand the physical schema,
 * expressed as a module boundary rather than a comment.
 *
 * Two things are deliberately *not* done here:
 *
 * - **No transaction juggling.** A revision writes two tables atomically, and
 *   supabase-js has no transaction API, so that write lives in the
 *   `semantic_block_revise()` database function. This file calls it. The
 *   alternative - read, compute, write, hope - is how heads and histories
 *   drift apart.
 * - **No ranking.** Relevance ordering is `semantic_block_search()`, in SQL,
 *   next to the index that makes it cheap. Re-sorting rows in TypeScript after
 *   the database already ranked them is how a retrieval layer quietly stops
 *   matching its own tests.
 */

type ServiceClient = ReturnType<typeof createServiceClient>;
/**
 * A block row as this module ever reads one.
 *
 * `search` is excluded: it is a generated tsvector that exists for the index
 * and has no meaning above this file, so no read selects it and nothing that
 * maps rows should have to pretend it might be there.
 */
type BlockRow = Omit<Database["public"]["Tables"]["semantic_blocks"]["Row"], "search">;
type RevisionRow = Database["public"]["Tables"]["semantic_block_revisions"]["Row"];

/**
 * Domain values on their way into a `jsonb` column.
 *
 * `provenance` and `attributes` are open bags by design, so their TypeScript
 * types are deliberately looser than `Json`. Asserting the bridge at the one
 * boundary that talks to the database is better than weakening the domain types
 * or making `types.ts` import from the generated schema.
 */
const asJson = (value: unknown): Json => (value ?? {}) as Json;

const asProvenance = (value: Json | null): SemanticProvenance =>
  (value ?? {}) as SemanticProvenance;

const asAttributes = (value: Json | null): Record<string, unknown> =>
  (value ?? {}) as Record<string, unknown>;

/** Columns a block read needs. See {@link BlockRow} on the absent `search`. */
const BLOCK_COLUMNS =
  "id, company_id, key, title, summary, body, labels, status, context_policy, salience, confidence, as_of, provenance, attributes, revision, current_revision_id, created_at, updated_at";

const REVISION_COLUMNS =
  "id, company_id, block_id, revision, title, summary, body, labels, status, context_policy, salience, confidence, as_of, provenance, attributes, change_kind, change_note, supersedes_revision_id, source_interaction_id, recorded_at, superseded_at";

/** `null` is how Postgres says "absent"; the domain says it by leaving it out. */
const optional = <T>(value: T | null): T | undefined => value ?? undefined;

const toBlock = (row: BlockRow): SemanticBlock => ({
  id: row.id,
  key: row.key,
  title: row.title,
  summary: optional(row.summary),
  body: row.body,
  labels: row.labels ?? [],
  status: row.status,
  contextPolicy: row.context_policy,
  salience: Number(row.salience),
  confidence: row.confidence === null ? undefined : Number(row.confidence),
  asOf: optional(row.as_of),
  provenance: asProvenance(row.provenance),
  attributes: asAttributes(row.attributes),
  revision: row.revision,
  currentRevisionId: optional(row.current_revision_id),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toRevision = (row: RevisionRow, blockKey: string): SemanticRevision => ({
  id: row.id,
  blockId: row.block_id,
  blockKey,
  revision: row.revision,
  title: row.title,
  summary: optional(row.summary),
  body: row.body,
  labels: row.labels ?? [],
  status: row.status,
  contextPolicy: row.context_policy,
  salience: Number(row.salience),
  confidence: row.confidence === null ? undefined : Number(row.confidence),
  asOf: optional(row.as_of),
  provenance: asProvenance(row.provenance),
  attributes: asAttributes(row.attributes),
  changeKind: row.change_kind,
  changeNote: optional(row.change_note),
  supersedesRevisionId: optional(row.supersedes_revision_id),
  sourceInteractionId: optional(row.source_interaction_id),
  recordedAt: row.recorded_at,
  supersededAt: optional(row.superseded_at),
});

const DEFAULT_SEARCH_LIMIT = 5;
const DEFAULT_LIST_LIMIT = 50;
const DEFAULT_HISTORY_LIMIT = 20;

export const createSemanticBlockStore = (client?: ServiceClient): SemanticBlockStore => {
  const supabase = client ?? createServiceClient();

  /**
   * Resolves a ref to `(id, key)`, confined to one company.
   *
   * Every path that touches a block goes through here, so company scoping is
   * enforced in one place rather than remembered at each call site. A ref that
   * belongs to another company is indistinguishable from one that does not
   * exist, which is the correct answer to give.
   */
  const resolve = async (
    scope: SemanticScope,
    ref: SemanticBlockRef
  ): Promise<{ id: string; key: string } | null> => {
    const query = supabase
      .from("semantic_blocks")
      .select("id, key")
      .eq("company_id", scope.companyId);

    const { data, error } = await ("key" in ref
      ? query.eq("key", ref.key)
      : query.eq("id", ref.id)
    ).maybeSingle();

    if (error) throw error;
    return data ?? null;
  };

  const requireBlock = async (scope: SemanticScope, ref: SemanticBlockRef) => {
    const resolved = await resolve(scope, ref);
    if (!resolved) throw new UnknownSemanticBlockError(ref);
    return resolved;
  };

  return {
    async getBlock(scope, ref) {
      const query = supabase
        .from("semantic_blocks")
        .select(BLOCK_COLUMNS)
        .eq("company_id", scope.companyId);

      const { data, error } = await ("key" in ref
        ? query.eq("key", ref.key)
        : query.eq("id", ref.id)
      ).maybeSingle();

      if (error) throw error;
      return data ? toBlock(data) : null;
    },

    async listCurrentBlocks(scope, query = {}) {
      const statuses = query.statuses ?? [...CURRENT_STATUSES];

      let builder = supabase
        .from("semantic_blocks")
        .select(BLOCK_COLUMNS)
        .eq("company_id", scope.companyId)
        .in("status", statuses)
        // Selection policy first, then how much it matters, then recency. The
        // same order the brief and a cold-open context want.
        .order("context_policy", { ascending: true })
        .order("salience", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(query.limit ?? DEFAULT_LIST_LIMIT);

      if (query.labels?.length) builder = builder.overlaps("labels", query.labels);
      if (query.contextPolicies?.length) {
        builder = builder.in("context_policy", query.contextPolicies);
      }
      if (query.minSalience !== undefined) {
        builder = builder.gte("salience", query.minSalience);
      }

      const { data, error } = await builder;
      if (error) throw error;

      return (data ?? []).map(toBlock);
    },

    async searchCurrentBlocks(scope, query) {
      const { data, error } = await supabase.rpc("semantic_block_search", {
        p_company_id: scope.companyId,
        p_text: query.text ?? undefined,
        p_statuses: query.statuses ?? [...CURRENT_STATUSES],
        p_labels: query.labels?.length ? query.labels : undefined,
        p_limit: query.limit ?? DEFAULT_SEARCH_LIMIT,
      });

      if (error) throw error;

      // The function returns rows already ranked. Preserved verbatim.
      return (data ?? []).map((row) => toBlock(row as BlockRow));
    },

    async getBlockHistory(scope, ref, query = {}) {
      const block = await requireBlock(scope, ref);

      const { data, error } = await supabase
        .from("semantic_block_revisions")
        .select(REVISION_COLUMNS)
        .eq("company_id", scope.companyId)
        .eq("block_id", block.id)
        .order("revision", { ascending: false })
        .limit(query.limit ?? DEFAULT_HISTORY_LIMIT);

      if (error) throw error;
      return (data ?? []).map((row) => toRevision(row, block.key));
    },

    async getBlockAsOf(scope, ref, instant) {
      const block = await requireBlock(scope, ref);

      // The revision in force at `instant`: the newest one recorded at or
      // before it. `superseded_at` bounds the same window from the other side,
      // but ordering by `recorded_at` answers it in one index scan and is
      // correct even for the still-current revision, which has no upper bound.
      const { data, error } = await supabase
        .from("semantic_block_revisions")
        .select(REVISION_COLUMNS)
        .eq("company_id", scope.companyId)
        .eq("block_id", block.id)
        .lte("recorded_at", instant)
        .order("recorded_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data ? toRevision(data, block.key) : null;
    },

    async getRevision(scope, revisionId) {
      const { data, error } = await supabase
        .from("semantic_block_revisions")
        .select(REVISION_COLUMNS)
        .eq("company_id", scope.companyId)
        .eq("id", revisionId)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      // Two explicit reads rather than a PostgREST embed. There are two foreign
      // keys between these tables - a revision's block, and a block's current
      // revision - so an embed is ambiguous and is rejected at runtime, not at
      // compile time. A second indexed lookup is the cheaper kind of correct.
      const { data: block, error: blockError } = await supabase
        .from("semantic_blocks")
        .select("key")
        .eq("company_id", scope.companyId)
        .eq("id", data.block_id)
        .maybeSingle();

      if (blockError) throw blockError;
      if (!block) return null;

      return toRevision(data, block.key);
    },

    async reviseBlock(scope, input) {
      const { data, error } = await supabase.rpc("semantic_block_revise", {
        p_company_id: scope.companyId,
        p_key: input.key,
        p_title: input.title,
        p_body: input.body,
        p_summary: input.summary ?? undefined,
        p_labels: input.labels ?? [],
        p_status: input.status ?? "active",
        p_context_policy: input.contextPolicy ?? "when_relevant",
        p_salience: input.salience ?? 0.5,
        p_confidence: input.confidence ?? undefined,
        p_as_of: input.asOf ?? undefined,
        p_provenance: asJson(input.provenance),
        p_attributes: asJson(input.attributes),
        p_change_kind: input.changeKind ?? undefined,
        p_change_note: input.changeNote ?? undefined,
        p_recorded_at: input.recordedAt ?? undefined,
      });

      if (error) throw error;

      const [result] = data ?? [];
      if (!result) {
        throw new Error(`semantic_block_revise returned no row for "${input.key}".`);
      }

      return {
        blockId: result.block_id,
        revisionId: result.revision_id,
        revision: result.revision,
        created: result.created,
      } satisfies RevisedSemanticBlock;
    },
  };
};

export type { ListSemanticBlocksQuery, SearchSemanticBlocksQuery, SemanticHistoryQuery };
export type { ReviseSemanticBlockInput };
