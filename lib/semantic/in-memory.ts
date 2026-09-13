import { randomUUID } from "node:crypto";

import {
  CURRENT_STATUSES,
  UnknownSemanticBlockError,
  type ReviseSemanticBlockInput,
  type SemanticBlock,
  type SemanticBlockRef,
  type SemanticBlockStore,
  type SemanticRevision,
  type SemanticScope,
} from "@/lib/semantic/types";
import type { SemanticInteractionStore } from "@/lib/semantic/update/interactions";
import type { StoredSemanticInteraction } from "@/lib/semantic/update/types";

/**
 * Process-local semantic state.
 *
 * Not the storage - `store.ts` is. This exists so the parts of the system that
 * are *not* about Postgres can be tested and demonstrated without it: the
 * updater's consolidation behaviour, the brief's staleness rules, the context
 * builder's selection. Those are the interesting decisions, and tying them to a
 * running database would mean they are only checked when one happens to be up.
 *
 * It implements the same revision semantics as the database function: one block
 * per key, a monotonic revision counter, a full snapshot per revision, and
 * `supersededAt` closed out on the revision being replaced. Where it differs,
 * the integration tests against real SQL are the authority - which is why those
 * exist alongside these rather than instead of them.
 */

const DEFAULT_SEARCH_LIMIT = 5;

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "can", "do", "does", "for", "from",
  "have", "how", "i", "if", "in", "is", "it", "of", "on", "or", "our", "should",
  "the", "to", "we", "what", "when", "will", "with", "you",
]);

const stem = (token: string): string =>
  token.replace(/(ings|ing|ed|es|s)$/, "").replace(/e$/, "");

const tokenize = (text: string): string[] => [
  ...new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2 && !STOP_WORDS.has(token))
      .map(stem)
  ),
];

/** Prefix-tolerant overlap, mirroring the OR-of-prefixes the SQL search uses. */
const relevance = (text: string, block: SemanticBlock): number => {
  const queryTokens = tokenize(text);
  if (queryTokens.length === 0) return 0;

  const weighted: Array<[string[], number]> = [
    [tokenize(`${block.title} ${block.key}`), 3],
    [tokenize(block.labels.join(" ")), 2],
    [tokenize(`${block.summary ?? ""} ${block.body}`), 1],
  ];

  let score = 0;
  for (const queryToken of queryTokens) {
    for (const [tokens, weight] of weighted) {
      if (
        tokens.some(
          (token) => token === queryToken || token.startsWith(queryToken) || queryToken.startsWith(token)
        )
      ) {
        score += weight;
        break;
      }
    }
  }

  return score / queryTokens.length;
};

const POLICY_ORDER = { always: 0, when_relevant: 1, background: 2 } as const;

interface StoredBlock {
  block: SemanticBlock;
  revisions: SemanticRevision[];
}

export class InMemorySemanticBlockStore implements SemanticBlockStore {
  private readonly byCompany = new Map<string, Map<string, StoredBlock>>();

  private blocks(companyId: string): Map<string, StoredBlock> {
    const existing = this.byCompany.get(companyId);
    if (existing) return existing;

    const created = new Map<string, StoredBlock>();
    this.byCompany.set(companyId, created);
    return created;
  }

  private find(scope: SemanticScope, ref: SemanticBlockRef): StoredBlock | null {
    const blocks = this.blocks(scope.companyId);
    if ("key" in ref) return blocks.get(ref.key) ?? null;

    return [...blocks.values()].find((stored) => stored.block.id === ref.id) ?? null;
  }

  async getBlock(scope: SemanticScope, ref: SemanticBlockRef): Promise<SemanticBlock | null> {
    return this.find(scope, ref)?.block ?? null;
  }

  async listCurrentBlocks(
    scope: SemanticScope,
    query: Parameters<SemanticBlockStore["listCurrentBlocks"]>[1] = {}
  ): Promise<SemanticBlock[]> {
    const statuses = query.statuses ?? [...CURRENT_STATUSES];

    return [...this.blocks(scope.companyId).values()]
      .map((stored) => stored.block)
      .filter((block) => statuses.includes(block.status))
      .filter((block) => !query.labels?.length || block.labels.some((label) => query.labels?.includes(label)))
      .filter(
        (block) =>
          !query.contextPolicies?.length || query.contextPolicies.includes(block.contextPolicy)
      )
      .filter((block) => query.minSalience === undefined || block.salience >= query.minSalience)
      .sort(
        (a, b) =>
          POLICY_ORDER[a.contextPolicy] - POLICY_ORDER[b.contextPolicy] ||
          b.salience - a.salience ||
          b.updatedAt.localeCompare(a.updatedAt)
      )
      .slice(0, query.limit ?? 50);
  }

  async searchCurrentBlocks(
    scope: SemanticScope,
    query: Parameters<SemanticBlockStore["searchCurrentBlocks"]>[1]
  ): Promise<SemanticBlock[]> {
    const statuses = query.statuses ?? [...CURRENT_STATUSES];

    return [...this.blocks(scope.companyId).values()]
      .map((stored) => stored.block)
      .filter((block) => statuses.includes(block.status))
      .filter((block) => !query.labels?.length || block.labels.some((label) => query.labels?.includes(label)))
      .map((block) => ({ block, score: query.text ? relevance(query.text, block) : 0 }))
      // A query that matches nothing returns nothing, as in SQL. Falling back to
      // "here is everything" would hide a retrieval failure behind plausible
      // output, which is the hardest kind of bug to notice.
      .filter(({ score }) => !query.text || score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          POLICY_ORDER[a.block.contextPolicy] - POLICY_ORDER[b.block.contextPolicy] ||
          b.block.salience - a.block.salience
      )
      .slice(0, query.limit ?? DEFAULT_SEARCH_LIMIT)
      .map(({ block }) => block);
  }

  async getBlockHistory(
    scope: SemanticScope,
    ref: SemanticBlockRef,
    query: { limit?: number } = {}
  ): Promise<SemanticRevision[]> {
    const stored = this.find(scope, ref);
    if (!stored) throw new UnknownSemanticBlockError(ref);

    return [...stored.revisions]
      .sort((a, b) => b.revision - a.revision)
      .slice(0, query.limit ?? 20);
  }

  async getBlockAsOf(
    scope: SemanticScope,
    ref: SemanticBlockRef,
    instant: string
  ): Promise<SemanticRevision | null> {
    const stored = this.find(scope, ref);
    if (!stored) throw new UnknownSemanticBlockError(ref);

    return (
      [...stored.revisions]
        .filter((revision) => revision.recordedAt <= instant)
        .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0] ?? null
    );
  }

  async getRevision(scope: SemanticScope, revisionId: string): Promise<SemanticRevision | null> {
    for (const stored of this.blocks(scope.companyId).values()) {
      const match = stored.revisions.find((revision) => revision.id === revisionId);
      if (match) return match;
    }
    return null;
  }

  async reviseBlock(scope: SemanticScope, input: ReviseSemanticBlockInput) {
    const blocks = this.blocks(scope.companyId);
    const existing = blocks.get(input.key);
    const recordedAt = input.recordedAt ?? new Date().toISOString();

    const previous = existing?.revisions[existing.revisions.length - 1];
    if (previous && recordedAt < previous.recordedAt) {
      throw new Error(
        `semantic history moves forward: ${recordedAt} precedes revision ${previous.revision} at ${previous.recordedAt}`
      );
    }

    const created = !existing;
    const blockId = existing?.block.id ?? randomUUID();
    const revisionNumber = (existing?.block.revision ?? 0) + 1;
    // Real uuids, not readable counters. Callers distinguish a topic key from an
    // id by shape (see `memory-adapter.ts`), so a fake that minted `blk_0001`
    // would exercise a different code path than production does.
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
      contextPolicy: input.contextPolicy ?? "when_relevant",
      salience: input.salience ?? 0.5,
      confidence: input.confidence,
      asOf: input.asOf,
      provenance: input.provenance ?? {},
      attributes: input.attributes ?? {},
    } as const;

    const revision: SemanticRevision = {
      ...snapshot,
      id: revisionId,
      blockId,
      blockKey: input.key,
      revision: revisionNumber,
      changeKind,
      changeNote: input.changeNote,
      supersedesRevisionId: previous?.id,
      sourceInteractionId:
        typeof input.provenance?.interactionId === "string"
          ? input.provenance.interactionId
          : undefined,
      recordedAt,
    };

    if (previous) previous.supersededAt = recordedAt;

    const block: SemanticBlock = {
      ...snapshot,
      id: blockId,
      key: input.key,
      revision: revisionNumber,
      currentRevisionId: revisionId,
      createdAt: existing?.block.createdAt ?? recordedAt,
      updatedAt: recordedAt,
    };

    blocks.set(input.key, {
      block,
      revisions: [...(existing?.revisions ?? []), revision],
    });

    return { blockId, revisionId, revision: revisionNumber, created };
  }
}

/** Process-local interaction log. Same contract, no database. */
export class InMemorySemanticInteractionStore implements SemanticInteractionStore {
  private readonly byKey = new Map<string, StoredSemanticInteraction>();
  /** Proposals and outcomes, for tests asserting on the audit trail. */
  readonly completions = new Map<string, unknown>();

  private static key(companyId: string, externalKey: string): string {
    return `${companyId}::${externalKey}`;
  }

  async claim(scope: SemanticScope, interaction: Parameters<SemanticInteractionStore["claim"]>[1]) {
    const key = InMemorySemanticInteractionStore.key(scope.companyId, interaction.externalKey);
    const existing = this.byKey.get(key);
    if (existing) return { interaction: existing, existed: true };

    const stored: StoredSemanticInteraction = {
      ...interaction,
      id: randomUUID(),
      occurredAt: interaction.occurredAt ?? new Date().toISOString(),
      status: "pending",
    };

    this.byKey.set(key, stored);
    return { interaction: stored, existed: false };
  }

  async complete(
    scope: SemanticScope,
    id: string,
    outcome: Parameters<SemanticInteractionStore["complete"]>[2]
  ) {
    this.completions.set(id, outcome);

    for (const stored of this.byKey.values()) {
      if (stored.id === id) stored.status = outcome.status;
    }
  }

  async get(scope: SemanticScope, id: string): Promise<StoredSemanticInteraction | null> {
    return (
      [...this.byKey.values()].find(
        (interaction) => interaction.id === id
      ) ?? null
    );
  }
}
