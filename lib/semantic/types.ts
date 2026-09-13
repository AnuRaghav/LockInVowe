/**
 * The Semantic Company Model - domain types.
 *
 * What this layer is: the company's own understanding of itself, in prose.
 * What it is not: a knowledge graph, a triple store, or a taxonomy of business
 * concepts. There is no `Entity`, no `Relation`, no `ConceptKind` in this file,
 * and adding one should require an argument rather than a commit.
 *
 * The unit is a {@link SemanticBlock}: one cohesive natural-language account of
 * one meaningful area of the company. "Hiring". "Fundraising". "Financial
 * posture". "Customer Acme". Which areas exist is decided by the company, not
 * by us - two companies will develop different blocks, and that is the point.
 *
 * Every field beside `body` exists to serve one of six jobs, and nothing else
 * belongs here:
 *
 *   ownership       companyId, carried by the scope rather than the block
 *   identity        key, title
 *   retrieval       summary, labels
 *   selection       contextPolicy, salience
 *   currentness     status, asOf, revision
 *   provenance      provenance, plus the revision's own trail
 *
 * Nothing in this module knows it is stored in Postgres. `store.ts` is the only
 * file that does, which is what keeps "do not force Sam to understand the
 * physical schema" true rather than aspirational.
 */

/** Everything semantic state is scoped by. Server-resolved; never model-supplied. */
export interface SemanticScope {
  companyId: string;
}

/**
 * Where a block sits in its own life.
 *
 * `resolved` and `archived` are both "not current", for different reasons worth
 * keeping apart: a resolved topic ran its course (the launch shipped), an
 * archived one turned out not to be a topic at all. Neither is deleted - the
 * history of a company includes the things that stopped mattering.
 */
export type SemanticBlockStatus = "active" | "dormant" | "resolved" | "archived";

/**
 * How eagerly a block should reach the model.
 *
 * Distinct from {@link SemanticBlock.salience} on purpose. Salience says how
 * much this matters to the company; the policy says how often a conversation is
 * likely to be *wrong without it*. A large one-off customer risk can be highly
 * salient and still only worth retrieving when asked about.
 */
export type SemanticContextPolicy = "always" | "when_relevant" | "background";

/**
 * Why a revision exists.
 *
 * `revised` means the company changed. `corrected` means we had it wrong. A
 * history shown to a founder must not present the second as the first.
 */
export type SemanticChangeKind =
  | "created"
  | "revised"
  | "corrected"
  | "status_changed"
  | "archived";

/**
 * What "current" means when nobody says otherwise.
 *
 * A read-time policy, deliberately: the same rows answer "what do we currently
 * understand?" and "what did we ever understand?" depending only on which
 * statuses the caller asks for.
 */
export const CURRENT_STATUSES: readonly SemanticBlockStatus[] = ["active", "dormant"];

/**
 * Where a piece of understanding came from.
 *
 * A *reference*, never a transcript. An interaction's text lives once, in the
 * interaction record; a block that has been revised by five conversations
 * carries five references, not five copies. Open-ended because the set of
 * things that can teach us about a company is not one we can enumerate.
 */
export interface SemanticProvenance {
  /** 'onboarding', 'conversation', 'founder', 'seed', 'import'. */
  kind?: string;
  /** Who or what asserted it, when that is meaningful. */
  actor?: string;
  /** The interaction this came from. Resolvable against `semantic_interactions`. */
  interactionId?: string;
  threadId?: string;
  runId?: string;
  /** A short quote, at most a sentence. Never the conversation. */
  excerpt?: string;
  [key: string]: unknown;
}

/** The company's current understanding of one topic. */
export interface SemanticBlock {
  id: string;
  /** Stable, human-meaningful identity: 'hiring', 'customer-acme'. */
  key: string;
  title: string;
  /** One line, when the body is more than a caller needs. */
  summary?: string;
  /** The understanding itself. This is the field that carries meaning. */
  body: string;
  labels: string[];
  status: SemanticBlockStatus;
  contextPolicy: SemanticContextPolicy;
  /** How load-bearing this is for the company, 0-1. */
  salience: number;
  /** How sure the company is, 0-1. Absent means "not stated", not "unsure". */
  confidence?: number;
  /** The date the understanding is *about* (ISO date), not when it was recorded. */
  asOf?: string;
  provenance: SemanticProvenance;
  /** Extension point. Nothing outside a caller that wrote it should read this. */
  attributes: Record<string, unknown>;
  /** 1-based. Equals the newest revision's number. */
  revision: number;
  currentRevisionId?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * One understanding the company once held.
 *
 * A full snapshot, not a delta: reconstructing October is a lookup, never a
 * replay. `recordedAt`/`supersededAt` bound the window this was believed in,
 * which is what makes "what did we think in October?" answerable and lets a
 * rendered history state an interval rather than a point.
 */
export interface SemanticRevision {
  id: string;
  blockId: string;
  blockKey: string;
  revision: number;
  title: string;
  summary?: string;
  body: string;
  labels: string[];
  status: SemanticBlockStatus;
  contextPolicy: SemanticContextPolicy;
  salience: number;
  confidence?: number;
  asOf?: string;
  provenance: SemanticProvenance;
  attributes: Record<string, unknown>;
  changeKind: SemanticChangeKind;
  /** Why it changed, in one line. What a rendered history actually reads as. */
  changeNote?: string;
  supersedesRevisionId?: string;
  sourceInteractionId?: string;
  /** When we learned it. */
  recordedAt: string;
  /** When the next revision replaced it. Absent while current. */
  supersededAt?: string;
}

/**
 * How a caller names a block.
 *
 * Both forms are first-class: `key` is how a human or a model refers to a topic
 * ("hiring"), `id` is how a stored reference does. Neither is a storage detail
 * leaking out - the key *is* the domain identity.
 */
export type SemanticBlockRef = { key: string } | { id: string };

export const byKey = (key: string): SemanticBlockRef => ({ key });
export const byId = (id: string): SemanticBlockRef => ({ id });

export interface ListSemanticBlocksQuery {
  /** Defaults to {@link CURRENT_STATUSES}. Pass explicitly to reach the rest. */
  statuses?: SemanticBlockStatus[];
  /** Blocks carrying at least one of these labels. */
  labels?: string[];
  contextPolicies?: SemanticContextPolicy[];
  /** Only blocks this load-bearing or more. */
  minSalience?: number;
  limit?: number;
}

export interface SearchSemanticBlocksQuery {
  /** What the caller is trying to find out, in natural language. */
  text?: string;
  statuses?: SemanticBlockStatus[];
  labels?: string[];
  limit?: number;
}

export interface SemanticHistoryQuery {
  /** Newest first. Defaults to a small number. */
  limit?: number;
}

/**
 * Reading current semantic state and its history.
 *
 * Four questions, which is deliberately the whole surface:
 *
 *   "what do we understand about X?"   getBlock
 *   "what do we understand?"           listCurrentBlocks
 *   "what do we understand about ~"    searchCurrentBlocks
 *   "how did that change?"             getBlockHistory / getBlockAsOf
 */
export interface SemanticBlockReader {
  getBlock(scope: SemanticScope, ref: SemanticBlockRef): Promise<SemanticBlock | null>;
  listCurrentBlocks(
    scope: SemanticScope,
    query?: ListSemanticBlocksQuery
  ): Promise<SemanticBlock[]>;
  /** Best first. Current state only unless `statuses` says otherwise. */
  searchCurrentBlocks(
    scope: SemanticScope,
    query: SearchSemanticBlocksQuery
  ): Promise<SemanticBlock[]>;
  /** Every revision of one block, newest first. */
  getBlockHistory(
    scope: SemanticScope,
    ref: SemanticBlockRef,
    query?: SemanticHistoryQuery
  ): Promise<SemanticRevision[]>;
  /** What was understood at an instant, or `null` if the block did not exist yet. */
  getBlockAsOf(
    scope: SemanticScope,
    ref: SemanticBlockRef,
    instant: string
  ): Promise<SemanticRevision | null>;
  getRevision(scope: SemanticScope, revisionId: string): Promise<SemanticRevision | null>;
}

/**
 * One statement of what the company now understands about a topic.
 *
 * Note what is *not* here: a revision number, a previous body, a supersession
 * pointer. A caller says what is true now; the store decides whether that is
 * this topic's first revision or its fourth. Making creation and revision the
 * same call is what makes consolidation the default and a duplicate Hiring
 * block impossible to write by accident.
 */
export interface ReviseSemanticBlockInput {
  key: string;
  title: string;
  body: string;
  summary?: string;
  labels?: string[];
  status?: SemanticBlockStatus;
  contextPolicy?: SemanticContextPolicy;
  salience?: number;
  confidence?: number;
  asOf?: string;
  provenance?: SemanticProvenance;
  attributes?: Record<string, unknown>;
  /** Usually inferred. Set it to distinguish a correction from a real change. */
  changeKind?: SemanticChangeKind;
  changeNote?: string;
  /** Backdating, for seeding and import. Must move forward. */
  recordedAt?: string;
}

export interface RevisedSemanticBlock {
  blockId: string;
  revisionId: string;
  revision: number;
  /** True when this call brought the block into existence. */
  created: boolean;
}

export interface SemanticBlockWriter {
  reviseBlock(
    scope: SemanticScope,
    input: ReviseSemanticBlockInput
  ): Promise<RevisedSemanticBlock>;
}

export type SemanticBlockStore = SemanticBlockReader & SemanticBlockWriter;

/** Thrown when a caller names a block that does not exist for this company. */
export class UnknownSemanticBlockError extends Error {
  constructor(ref: SemanticBlockRef) {
    super(
      `No semantic block ${"key" in ref ? `"${ref.key}"` : ref.id} for this company.`
    );
    this.name = "UnknownSemanticBlockError";
  }
}

/**
 * The shape a block key must take.
 *
 * Enforced in the database too. Keys are addressed by humans and proposed by a
 * model, so they must be predictable enough that "hiring" always means the same
 * block - and never a free-text field in disguise.
 */
export const SEMANTIC_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/;

/**
 * Coerces a proposed key into the canonical form.
 *
 * Returns `null` when nothing usable survives, so a caller must decide what to
 * do rather than silently storing a block under a mangled name.
 */
export const normalizeSemanticKey = (raw: string): string | null => {
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return SEMANTIC_KEY_PATTERN.test(key) ? key : null;
};
