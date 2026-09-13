import type {
  MemoryDirectory,
  MemoryDirectoryEntry,
  MemoryDirectoryReader,
  MemoryHistory,
  MemoryQuery,
  MemoryRecord,
  MemoryRevision,
  MemoryScope,
  PersistentMemory,
} from "@/lib/memory/types";
import { createSemanticBlockStore } from "@/lib/semantic/store";
import {
  CURRENT_STATUSES,
  SEMANTIC_KEY_PATTERN,
  UnknownSemanticBlockError,
  type SemanticBlock,
  type SemanticBlockReader,
} from "@/lib/semantic/types";

/**
 * Semantic state, seen through the {@link PersistentMemory} boundary.
 *
 * `PersistentMemory` was written before this layer existed, and its promise was
 * that a backend could be Postgres rows, a graph, embeddings, or a pile of
 * documents without any caller noticing. This adapter is that promise being
 * kept: the context builder and Sam's retrieval tools keep asking the same two
 * questions, and the answers now come from durable, revisable semantic blocks
 * instead of a process-local array.
 *
 * The mapping is one block -> one record, and the decisions inside it are:
 *
 * - **The record's id is the block's key**, not its uuid. `hiring` is what a
 *   model can carry through a conversation, quote back, and ask for again; a
 *   uuid is something it will corrupt by the third turn. The uuid stays in
 *   `attributes` for callers that hold stored references.
 * - **`kind` is always `semantic_block`.** The old vocabulary - fact,
 *   assumption, plan, decision - was a placeholder for an ontology we
 *   deliberately did not build. A block about hiring is a plan *and* a
 *   constraint *and* a decision, and forcing it into one of those loses the
 *   thing that made it worth storing.
 * - **`content` is title plus body.** The body alone reads as an orphaned
 *   paragraph once it is one bullet among several in a prompt.
 */

/** The one kind there is. See the note above on why there are not more. */
export const SEMANTIC_MEMORY_KIND = "semantic_block";

const DEFAULT_LIMIT = 5;
const DEFAULT_DIRECTORY_LIMIT = 40;

/**
 * The one line a block gets in the directory.
 *
 * `summary` is the block's own one-liner when it has one. When it does not, the
 * body's first sentence is used and clipped - a directory entry has to say what
 * the topic is about, and an entry reading only "Hiring" tells a model nothing
 * it could not have guessed from the key.
 */
const SUMMARY_CHARS = 140;

const directorySummary = (block: SemanticBlock): string | undefined => {
  if (block.summary?.trim()) return block.summary.trim();

  const firstSentence = block.body.trim().split(/(?<=[.!?])\s/)[0]?.trim();
  if (!firstSentence) return undefined;

  return firstSentence.length > SUMMARY_CHARS
    ? `${firstSentence.slice(0, SUMMARY_CHARS).trimEnd()}...`
    : firstSentence;
};

/** What a block looks like as a table-of-contents line. */
export const blockToDirectoryEntry = (block: SemanticBlock): MemoryDirectoryEntry => ({
  id: block.key,
  title: block.title,
  summary: directorySummary(block),
  status: block.status,
  asOf: block.asOf ?? block.updatedAt.slice(0, 10),
  importance: block.salience,
});

/** What a block looks like once it is a memory record. */
export const blockToMemoryRecord = (block: SemanticBlock): MemoryRecord => ({
  id: block.key,
  kind: SEMANTIC_MEMORY_KIND,
  content: `${block.title}\n${block.body}`,
  labels: block.labels,
  importance: block.salience,
  source: typeof block.provenance.kind === "string" ? block.provenance.kind : undefined,
  // The date the understanding is *about* when we have it, falling back to when
  // it was last revised. Both are "when is this true of", not "when was the row
  // written", which is the sense `recordedAt` carries on a memory record.
  recordedAt: block.asOf ?? block.updatedAt,
  attributes: {
    blockId: block.id,
    key: block.key,
    title: block.title,
    summary: block.summary,
    status: block.status,
    contextPolicy: block.contextPolicy,
    salience: block.salience,
    confidence: block.confidence,
    revision: block.revision,
    asOf: block.asOf,
    updatedAt: block.updatedAt,
  },
});

/**
 * Tested *before* the key pattern, never after.
 *
 * A uuid is all lowercase hex and hyphens, so it satisfies
 * {@link SEMANTIC_KEY_PATTERN} too. Checking "is this a key?" first would send
 * every uuid down the key path and lose it.
 */
const looksLikeUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** How a model-supplied or stored identifier is read. See {@link looksLikeUuid}. */
const refFor = (id: string) => (looksLikeUuid(id) ? { id } : { key: id });

export interface SemanticPersistentMemoryOptions {
  reader?: SemanticBlockReader;
}

/**
 * A {@link PersistentMemory} (and {@link MemoryHistory}) over semantic blocks.
 */
export class SemanticPersistentMemory
  implements PersistentMemory, MemoryHistory, MemoryDirectoryReader
{
  private readonly reader: SemanticBlockReader;

  constructor({ reader }: SemanticPersistentMemoryOptions = {}) {
    this.reader = reader ?? createSemanticBlockStore();
  }

  /**
   * Relevant current understanding, best first.
   *
   * `query.kinds` is deliberately ignored rather than honoured or rejected. It
   * filtered a taxonomy this layer does not have, and the two alternatives are
   * both worse: returning nothing for `kinds: ["constraint"]` would make a
   * reasonable question unanswerable, and quietly reinterpreting kinds as
   * labels would answer a different question than the one asked. Returning the
   * most relevant blocks and letting their prose speak is the honest reading.
   * The parameter should leave the tool schema in the next pass.
   */
  async search(scope: MemoryScope, query: MemoryQuery): Promise<MemoryRecord[]> {
    const blocks = await this.reader.searchCurrentBlocks(scope, {
      text: query.text,
      labels: query.labels,
      limit: query.limit ?? DEFAULT_LIMIT,
    });

    return blocks.map(blockToMemoryRecord);
  }

  /**
   * Every topic the company currently has an understanding of, titles only.
   *
   * `listCurrentBlocks` already orders by context policy, then salience, then
   * recency - the order a cold-open context wants - so nothing is re-sorted
   * here. One extra row is requested beyond the cap purely to learn whether
   * there *is* an extra row: the caller has to be able to tell a complete
   * directory from a clipped one, and a count query for that would cost a
   * second round trip to say "and there are more".
   */
  async list(
    scope: MemoryScope,
    options: { limit?: number } = {}
  ): Promise<MemoryDirectory> {
    const limit = options.limit ?? DEFAULT_DIRECTORY_LIMIT;

    const blocks = await this.reader.listCurrentBlocks(scope, {
      statuses: [...CURRENT_STATUSES],
      limit: limit + 1,
    });

    return {
      entries: blocks.slice(0, limit).map(blockToDirectoryEntry),
      truncated: blocks.length > limit,
    };
  }

  /**
   * One record by whatever identifier the caller happens to hold.
   *
   * A key (`hiring`), a block uuid, or a *revision* uuid all resolve. The last
   * is what lets a model that has seen a history entry fetch its exact wording
   * without a second tool - and it returns the historical text, not the current
   * text, which is the only defensible answer to "show me that revision".
   */
  async get(scope: MemoryScope, id: string): Promise<MemoryRecord | null> {
    if (!looksLikeUuid(id) && !SEMANTIC_KEY_PATTERN.test(id)) return null;

    const block = await this.reader.getBlock(scope, refFor(id));
    if (block) return blockToMemoryRecord(block);

    // Not a topic, so the only other thing this id can name is one revision of
    // one. A key never reaches here, so no uuid check is needed first.
    if (!looksLikeUuid(id)) return null;

    const revision = await this.reader.getRevision(scope, id);
    if (!revision) return null;

    return {
      id: revision.id,
      kind: SEMANTIC_MEMORY_KIND,
      content: `${revision.title}\n${revision.body}`,
      labels: revision.labels,
      importance: revision.salience,
      source: typeof revision.provenance.kind === "string" ? revision.provenance.kind : undefined,
      recordedAt: revision.recordedAt,
      attributes: {
        blockId: revision.blockId,
        key: revision.blockKey,
        revision: revision.revision,
        changeNote: revision.changeNote,
        recordedAt: revision.recordedAt,
        supersededAt: revision.supersededAt,
        // Loudly, because a model holding a superseded revision and treating it
        // as current is the specific failure this whole layer exists to prevent.
        current: revision.supersededAt === undefined,
      },
    };
  }

  /** How one topic's understanding has changed, newest first. */
  async history(
    scope: MemoryScope,
    id: string,
    options: { limit?: number } = {}
  ): Promise<MemoryRevision[]> {
    try {
      const revisions = await this.reader.getBlockHistory(scope, refFor(id), options);

      return revisions.map((revision) => ({
        id: revision.id,
        recordId: revision.blockKey,
        content: `${revision.title}\n${revision.body}`,
        changeNote: revision.changeNote,
        recordedAt: revision.recordedAt,
        supersededAt: revision.supersededAt,
      }));
    } catch (error) {
      // "No such topic" is an empty history, not a failure. A caller asking
      // about a block that does not exist has learned what it needed to.
      if (error instanceof UnknownSemanticBlockError) return [];
      throw error;
    }
  }
}

export const createSemanticPersistentMemory = (
  options: SemanticPersistentMemoryOptions = {}
): SemanticPersistentMemory => new SemanticPersistentMemory(options);
