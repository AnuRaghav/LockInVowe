import type {
  SemanticBlockRef,
  SemanticBlockStatus,
  SemanticChangeKind,
  SemanticProvenance,
} from "@/lib/semantic/types";

/**
 * The Founder Model - domain types.
 *
 * Who the person running the company is: background, motivation, values,
 * non-negotiables, decision style, personal constraints. It belongs to the
 * founder, not the company, so everything here is scoped by {@link FounderScope}
 * and nothing takes a company id.
 *
 * Blocks deliberately reuse the semantic block's shape and lifecycle - prose,
 * revised in full, history kept - so the updater and brief machinery can be
 * pointed at them later without a second vocabulary. What is new is
 * {@link FounderBlockSensitivity}, and the rule that comes with it: a personal
 * block is invisible to every read that does not ask for it by name.
 *
 * The typed half of the Founder Model, the communication contract, lives in
 * `contract.ts`.
 */

/** Everything founder state is scoped by. Server-resolved; never model-supplied. */
export interface FounderScope {
  founderId: string;
}

/**
 * How carefully a block must be handled.
 *
 * `personal` is for what the founder shared about their own money and life:
 * salary, personal runway, personal guarantees. It only ever increases - a
 * personal block can never be revised back to `standard`.
 */
export type FounderBlockSensitivity = "standard" | "personal";

export interface FounderBlock {
  id: string;
  key: string;
  title: string;
  summary?: string;
  body: string;
  labels: string[];
  status: SemanticBlockStatus;
  sensitivity: FounderBlockSensitivity;
  salience: number;
  confidence?: number;
  asOf?: string;
  provenance: SemanticProvenance;
  attributes: Record<string, unknown>;
  revision: number;
  currentRevisionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FounderRevision {
  id: string;
  blockId: string;
  blockKey: string;
  revision: number;
  title: string;
  summary?: string;
  body: string;
  labels: string[];
  status: SemanticBlockStatus;
  sensitivity: FounderBlockSensitivity;
  salience: number;
  confidence?: number;
  asOf?: string;
  provenance: SemanticProvenance;
  attributes: Record<string, unknown>;
  changeKind: SemanticChangeKind;
  changeNote?: string;
  supersedesRevisionId?: string;
  recordedAt: string;
  supersededAt?: string;
}

export type FounderBlockRef = SemanticBlockRef;

/**
 * Opting in to personal blocks.
 *
 * Every read takes this and every read defaults it to `false`. A caller that
 * forgets it gets less than it wanted, never more than it should have.
 */
export interface FounderReadOptions {
  includePersonal?: boolean;
}

export interface ListFounderBlocksQuery extends FounderReadOptions {
  /** Defaults to `CURRENT_STATUSES`. */
  statuses?: SemanticBlockStatus[];
  labels?: string[];
  minSalience?: number;
  limit?: number;
}

export interface SearchFounderBlocksQuery extends FounderReadOptions {
  text?: string;
  statuses?: SemanticBlockStatus[];
  labels?: string[];
  limit?: number;
}

export interface FounderHistoryQuery extends FounderReadOptions {
  limit?: number;
}

export interface ReviseFounderBlockInput {
  key: string;
  title: string;
  body: string;
  summary?: string;
  labels?: string[];
  status?: SemanticBlockStatus;
  /** Omit to keep the block's current sensitivity (`standard` for a new block). */
  sensitivity?: FounderBlockSensitivity;
  salience?: number;
  confidence?: number;
  asOf?: string;
  provenance?: SemanticProvenance;
  attributes?: Record<string, unknown>;
  changeKind?: SemanticChangeKind;
  changeNote?: string;
  recordedAt?: string;
}

export interface RevisedFounderBlock {
  blockId: string;
  revisionId: string;
  revision: number;
  created: boolean;
}

export interface FounderBlockStore {
  getBlock(
    scope: FounderScope,
    ref: FounderBlockRef,
    options?: FounderReadOptions
  ): Promise<FounderBlock | null>;
  listCurrentBlocks(scope: FounderScope, query?: ListFounderBlocksQuery): Promise<FounderBlock[]>;
  /** Best first. */
  searchCurrentBlocks(scope: FounderScope, query: SearchFounderBlocksQuery): Promise<FounderBlock[]>;
  /** Newest first. A personal block's history is as hidden as the block. */
  getBlockHistory(
    scope: FounderScope,
    ref: FounderBlockRef,
    query?: FounderHistoryQuery
  ): Promise<FounderRevision[]>;
  reviseBlock(scope: FounderScope, input: ReviseFounderBlockInput): Promise<RevisedFounderBlock>;
  /**
   * Erases a block and every revision of it. Returns whether anything was
   * deleted. Unlike company semantic state, this is permitted: a founder's
   * account of themselves is theirs to remove.
   */
  deleteBlock(scope: FounderScope, ref: FounderBlockRef): Promise<boolean>;
}

/** Thrown when a caller names a block that does not exist - or is hidden - for this founder. */
export class UnknownFounderBlockError extends Error {
  constructor(ref: FounderBlockRef) {
    super(`No founder block ${"key" in ref ? `"${ref.key}"` : ref.id} for this founder.`);
    this.name = "UnknownFounderBlockError";
  }
}

/** Thrown when a revision would make a personal block readable by default. */
export class FounderSensitivityDowngradeError extends Error {
  constructor(key: string) {
    super(`founder block sensitivity only increases: "${key}" is personal and cannot become standard`);
    this.name = "FounderSensitivityDowngradeError";
  }
}
