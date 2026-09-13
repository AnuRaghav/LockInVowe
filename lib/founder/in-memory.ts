import { randomUUID } from "node:crypto";

import { textRelevance } from "@/lib/semantic/in-memory";
import { CURRENT_STATUSES } from "@/lib/semantic/types";
import {
  applyContractPatch,
  contractPatchSchema,
  type CommunicationContract,
  type CommunicationContractStore,
  type ReviseContractInput,
} from "@/lib/founder/contract";
import {
  FounderSensitivityDowngradeError,
  UnknownFounderBlockError,
  type FounderBlock,
  type FounderBlockRef,
  type FounderBlockStore,
  type FounderReadOptions,
  type FounderRevision,
  type FounderScope,
  type ListFounderBlocksQuery,
  type ReviseFounderBlockInput,
  type SearchFounderBlocksQuery,
} from "@/lib/founder/types";

/**
 * Process-local founder state, for tests and for running without a database.
 *
 * Mirrors the SQL functions' rules: one block per key, full-snapshot revisions,
 * sensitivity that only increases, personal blocks hidden unless asked for, and
 * a contract merged key by key. Where this and SQL differ, the integration tests
 * are the authority.
 */

interface StoredBlock {
  block: FounderBlock;
  revisions: FounderRevision[];
}

const visible = (block: FounderBlock, options: FounderReadOptions = {}) =>
  options.includePersonal || block.sensitivity === "standard";

export class InMemoryFounderBlockStore implements FounderBlockStore {
  private readonly byFounder = new Map<string, Map<string, StoredBlock>>();

  private blocks(founderId: string): Map<string, StoredBlock> {
    const existing = this.byFounder.get(founderId);
    if (existing) return existing;

    const created = new Map<string, StoredBlock>();
    this.byFounder.set(founderId, created);
    return created;
  }

  private find(scope: FounderScope, ref: FounderBlockRef): StoredBlock | null {
    const blocks = this.blocks(scope.founderId);
    if ("key" in ref) return blocks.get(ref.key) ?? null;
    return [...blocks.values()].find((stored) => stored.block.id === ref.id) ?? null;
  }

  async getBlock(scope: FounderScope, ref: FounderBlockRef, options: FounderReadOptions = {}) {
    const stored = this.find(scope, ref);
    return stored && visible(stored.block, options) ? stored.block : null;
  }

  async listCurrentBlocks(scope: FounderScope, query: ListFounderBlocksQuery = {}) {
    const statuses = query.statuses ?? [...CURRENT_STATUSES];

    return [...this.blocks(scope.founderId).values()]
      .map((stored) => stored.block)
      .filter((block) => visible(block, query))
      .filter((block) => statuses.includes(block.status))
      .filter((block) => !query.labels?.length || block.labels.some((label) => query.labels?.includes(label)))
      .filter((block) => query.minSalience === undefined || block.salience >= query.minSalience)
      .sort((a, b) => b.salience - a.salience || b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, query.limit ?? 50);
  }

  async searchCurrentBlocks(scope: FounderScope, query: SearchFounderBlocksQuery) {
    const statuses = query.statuses ?? [...CURRENT_STATUSES];

    return [...this.blocks(scope.founderId).values()]
      .map((stored) => stored.block)
      .filter((block) => visible(block, query))
      .filter((block) => statuses.includes(block.status))
      .filter((block) => !query.labels?.length || block.labels.some((label) => query.labels?.includes(label)))
      .map((block) => ({ block, score: query.text ? textRelevance(query.text, block) : 0 }))
      .filter(({ score }) => !query.text || score > 0)
      .sort((a, b) => b.score - a.score || b.block.salience - a.block.salience)
      .slice(0, query.limit ?? 5)
      .map(({ block }) => block);
  }

  async getBlockHistory(
    scope: FounderScope,
    ref: FounderBlockRef,
    query: { limit?: number } & FounderReadOptions = {}
  ) {
    const stored = this.find(scope, ref);
    if (!stored || !visible(stored.block, query)) throw new UnknownFounderBlockError(ref);

    return [...stored.revisions].sort((a, b) => b.revision - a.revision).slice(0, query.limit ?? 20);
  }

  async reviseBlock(scope: FounderScope, input: ReviseFounderBlockInput) {
    const blocks = this.blocks(scope.founderId);
    const existing = blocks.get(input.key);
    const recordedAt = input.recordedAt ?? new Date().toISOString();
    const previous = existing?.revisions[existing.revisions.length - 1];

    if (previous && recordedAt < previous.recordedAt) {
      throw new Error(
        `founder history moves forward: ${recordedAt} precedes revision ${previous.revision} at ${previous.recordedAt}`
      );
    }
    if (previous?.sensitivity === "personal" && input.sensitivity === "standard") {
      throw new FounderSensitivityDowngradeError(input.key);
    }

    const created = !existing;
    const blockId = existing?.block.id ?? randomUUID();
    const revisionNumber = (existing?.block.revision ?? 0) + 1;
    const revisionId = randomUUID();
    const status = input.status ?? "active";

    const changeKind =
      input.changeKind ??
      (created
        ? "created"
        : status === "archived"
          ? "archived"
          : previous && previous.status !== status
            ? "status_changed"
            : "revised");

    const snapshot = {
      title: input.title,
      summary: input.summary,
      body: input.body,
      labels: input.labels ?? [],
      status,
      sensitivity: input.sensitivity ?? previous?.sensitivity ?? "standard",
      salience: input.salience ?? 0.5,
      confidence: input.confidence,
      asOf: input.asOf,
      provenance: input.provenance ?? {},
      attributes: input.attributes ?? {},
    } as const;

    if (previous) previous.supersededAt = recordedAt;

    blocks.set(input.key, {
      block: {
        ...snapshot,
        id: blockId,
        key: input.key,
        revision: revisionNumber,
        currentRevisionId: revisionId,
        createdAt: existing?.block.createdAt ?? recordedAt,
        updatedAt: recordedAt,
      },
      revisions: [
        ...(existing?.revisions ?? []),
        {
          ...snapshot,
          id: revisionId,
          blockId,
          blockKey: input.key,
          revision: revisionNumber,
          changeKind,
          changeNote: input.changeNote,
          supersedesRevisionId: previous?.id,
          recordedAt,
        },
      ],
    });

    return { blockId, revisionId, revision: revisionNumber, created };
  }

  async deleteBlock(scope: FounderScope, ref: FounderBlockRef) {
    const stored = this.find(scope, ref);
    if (!stored) return false;
    return this.blocks(scope.founderId).delete(stored.block.key);
  }
}

export class InMemoryCommunicationContractStore implements CommunicationContractStore {
  private readonly byFounder = new Map<string, CommunicationContract[]>();

  async getCurrent(scope: FounderScope) {
    const revisions = this.byFounder.get(scope.founderId) ?? [];
    return revisions[revisions.length - 1] ?? null;
  }

  async getHistory(scope: FounderScope, query: { limit?: number } = {}) {
    return [...(this.byFounder.get(scope.founderId) ?? [])].reverse().slice(0, query.limit ?? 20);
  }

  async revise(scope: FounderScope, input: ReviseContractInput) {
    const patch = contractPatchSchema.parse(input.patch);
    const revisions = this.byFounder.get(scope.founderId) ?? [];
    const previous = revisions[revisions.length - 1] ?? null;

    // Every metadata field is set explicitly, so nothing from the previous
    // revision's metadata survives the spread.
    const contract: CommunicationContract = {
      ...applyContractPatch(previous, patch),
      id: randomUUID(),
      revision: (previous?.revision ?? 0) + 1,
      provenance: input.provenance ?? {},
      changeKind: input.changeKind ?? (previous ? "revised" : "created"),
      changeNote: input.changeNote,
      recordedAt: new Date().toISOString(),
    };

    this.byFounder.set(scope.founderId, [...revisions, contract]);
    return contract;
  }
}
