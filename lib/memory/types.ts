/**
 * Memory boundaries for Sam.
 *
 * This module defines *what kinds of memory exist* and *how they are asked
 * questions* - deliberately not how any of them is stored. A persistent memory
 * may later be Postgres rows, a graph, embeddings, a pile of documents, or a
 * hybrid of all four; nothing outside an implementation should be able to tell.
 *
 * Two rules keep that possible:
 *
 * 1. Queries are described in domain terms (text, kinds, labels, a limit), not
 *    in storage terms (no SQL fragments, no vector params, no cursors).
 * 2. A record carries a model-readable `content` string plus an open
 *    `attributes` bag. Structure that only one backend understands goes in
 *    `attributes`, so adding it never changes this contract.
 */

/** Everything memory is scoped by. Server-resolved; never model-supplied. */
export interface MemoryScope {
  companyId: string;
}

/** Identifies one conversation's working state within a company. */
export interface ThreadRef extends MemoryScope {
  threadId: string;
}

/**
 * Coarse label for what a memory *is*.
 *
 * Intentionally a plain string, not a union: the semantic ontology is not
 * designed yet, and locking one in here would be the expensive kind of guess.
 * {@link MEMORY_KINDS} lists the shapes we already know we have.
 */
export type MemoryKind = string;

/** Known kinds so far. Not exhaustive and not enforced. */
export const MEMORY_KINDS = {
  fact: "fact",
  assumption: "assumption",
  goal: "goal",
  constraint: "constraint",
  plan: "plan",
  commitment: "commitment",
  decision: "decision",
  relationship: "relationship",
  document: "document",
} as const;

/**
 * One unit of long-lived company knowledge.
 *
 * `content` is the only field the model is guaranteed to understand, so every
 * record must be self-contained prose. Backend-specific structure (a row id, a
 * node/edge pair, an embedding's neighbours, a file range) belongs in
 * `attributes` where nothing depends on it.
 */
export interface MemoryRecord {
  id: string;
  kind: MemoryKind;
  /** Self-contained statement, e.g. "Management requires 12 months of runway." */
  content: string;
  /** Free-form tags an implementation may filter on. */
  labels?: string[];
  /**
   * How central this is to the company, 0-1. A retriever may use it to decide
   * what a founder should see before they think to ask. Optional because some
   * backends will infer it instead of storing it.
   */
  importance?: number;
  /** Where the memory came from ("onboarding", "stripe", "founder"). */
  source?: string;
  /** ISO timestamp the knowledge was recorded. */
  recordedAt?: string;
  /** Representation-specific payload. Nothing outside an implementation reads this. */
  attributes?: Record<string, unknown>;
}

/**
 * A request for company knowledge, described by intent.
 *
 * An implementation is free to answer `text` with keyword overlap today and
 * vector similarity later; callers cannot tell and must not care.
 */
export interface MemoryQuery {
  /** What the caller is trying to find out, in natural language. */
  text?: string;
  /** Restrict to these kinds. Empty/absent means every kind. */
  kinds?: MemoryKind[];
  /** Restrict to records carrying at least one of these labels. */
  labels?: string[];
  /** Maximum records to return. Implementations should apply a sane default. */
  limit?: number;
}

/**
 * Long-lived company knowledge that survives every conversation.
 *
 * Read-only for now. Writing is a separate, deliberate act - we are explicitly
 * *not* persisting model turns, tool results, or intermediate reasoning as
 * company knowledge - so a write path lands only once we know what earns a
 * place here.
 */
export interface PersistentMemory {
  /** Most relevant records for a query, best first. */
  search(scope: MemoryScope, query: MemoryQuery): Promise<MemoryRecord[]>;
  /** One record by id, or `null` when it does not exist for this company. */
  get(scope: MemoryScope, id: string): Promise<MemoryRecord | null>;
}

/**
 * One understanding a memory used to hold.
 *
 * Deliberately thin, and deliberately *not* the storage row: a caller learns
 * what was believed, when, and why it changed - not that there is a revisions
 * table, a supersession pointer, or a change-kind enum. Enough to answer "how
 * has this changed?", and nothing a model could mistake for schema.
 */
export interface MemoryRevision {
  /** Identifies this revision, so its exact wording can be fetched again. */
  id: string;
  /** The record this is a revision of. */
  recordId: string;
  /** Self-contained statement, as it was believed at the time. */
  content: string;
  /** Why it changed, in one line, when whoever changed it said. */
  changeNote?: string;
  /** When this understanding was recorded. */
  recordedAt: string;
  /** When it was replaced. Absent while it is still current. */
  supersededAt?: string;
}

/**
 * The optional half of persistent memory: knowing what it used to think.
 *
 * Kept off {@link PersistentMemory} because not every backend can answer it -
 * a plain document store has no revisions to return - and a required method
 * that half the implementations throw from is worse than an optional one a
 * caller can ask about. Use {@link supportsMemoryHistory} to find out.
 */
export interface MemoryHistory {
  /** Revisions of one record, newest first. Empty when there is only one. */
  history(
    scope: MemoryScope,
    id: string,
    options?: { limit?: number }
  ): Promise<MemoryRevision[]>;
}

/** Whether this memory can answer "how has that changed?". */
export const supportsMemoryHistory = (
  memory: PersistentMemory
): memory is PersistentMemory & MemoryHistory =>
  typeof (memory as Partial<MemoryHistory>).history === "function";

/**
 * Working state for the conversation currently in progress.
 *
 * Deliberately thin. This is scratch space for one thread - the founder's
 * current task, what has already been established in this exchange - and it is
 * *not* a place company knowledge accumulates. Anything worth keeping has to
 * be promoted into {@link PersistentMemory} on purpose.
 */
export interface ThreadState {
  threadId: string;
  /** Short recap of the conversation so far, if one exists yet. */
  summary?: string;
  /** Working notes for the active task. Ephemeral by design. */
  notes: string[];
}

export interface ThreadMemory {
  /** Current state of a thread, or `null` for a conversation that has not started. */
  load(ref: ThreadRef): Promise<ThreadState | null>;
  /** Record a working note against the active thread. */
  appendNote(ref: ThreadRef, note: string): Promise<void>;
}
