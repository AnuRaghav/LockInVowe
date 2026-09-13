/**
 * The Semantic Company Model.
 *
 * What the company understands about itself, durably, in its own words - and
 * the machinery that keeps that understanding current without letting it turn
 * into a pile of undifferentiated memories.
 *
 * Four things live here, and the boundaries between them are the design:
 *
 *   types.ts           What a block is. No storage, no model, no ontology.
 *   store.ts           The only module that knows this is Postgres.
 *   update/            Interaction -> proposal (model) -> validation -> state.
 *   brief/             A compact projection of current state, for every run.
 *
 * Plus `memory-adapter.ts`, which presents all of it through the older
 * {@link PersistentMemory} boundary so the context builder and Sam's retrieval
 * tools never needed to learn that any of this happened.
 *
 * The rule that holds it together: the model decides what things *mean*;
 * application code decides what the database *does*.
 */

export {
  CURRENT_STATUSES,
  SEMANTIC_KEY_PATTERN,
  UnknownSemanticBlockError,
  byId,
  byKey,
  normalizeSemanticKey,
  type ListSemanticBlocksQuery,
  type ReviseSemanticBlockInput,
  type RevisedSemanticBlock,
  type SearchSemanticBlocksQuery,
  type SemanticBlock,
  type SemanticBlockReader,
  type SemanticBlockRef,
  type SemanticBlockStatus,
  type SemanticBlockStore,
  type SemanticBlockWriter,
  type SemanticChangeKind,
  type SemanticContextPolicy,
  type SemanticHistoryQuery,
  type SemanticProvenance,
  type SemanticRevision,
  type SemanticScope,
} from "@/lib/semantic/types";

export { createSemanticBlockStore } from "@/lib/semantic/store";

export {
  SEMANTIC_MEMORY_KIND,
  SemanticPersistentMemory,
  blockToMemoryRecord,
  createSemanticPersistentMemory,
  type SemanticPersistentMemoryOptions,
} from "@/lib/semantic/memory-adapter";

export {
  SEED_SEMANTIC_KEYS,
  SEED_SEMANTIC_REVISIONS,
  seedSemanticBlocks,
  type SeedRevision,
} from "@/lib/semantic/seed";

export {
  createSemanticModel,
  getSemanticModelName,
  hasSemanticModel,
} from "@/lib/semantic/model";

export * from "@/lib/semantic/brief";
export {
  applySemanticProposal,
  createModelSemanticProposer,
  createNoopSemanticProposer,
  createScriptedSemanticProposer,
  createSemanticInteractionStore,
  isMaterialChange,
  updateSemanticState,
  type AppliedSemanticChange,
  type RejectedSemanticOperation,
  type SemanticInteraction,
  type SemanticInteractionMessage,
  type SemanticOperation,
  type SemanticProposal,
  type SemanticProposer,
  type SemanticUpdateResult,
  type UpdateSemanticStateInput,
} from "@/lib/semantic/update";
