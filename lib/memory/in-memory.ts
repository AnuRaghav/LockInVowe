import type {
  MemoryQuery,
  MemoryRecord,
  MemoryScope,
  PersistentMemory,
  ThreadMemory,
  ThreadRef,
  ThreadState,
} from "@/lib/memory/types";

/**
 * Process-local memory implementations.
 *
 * These exist to make the boundaries in `types.ts` real and testable, not to
 * be the eventual storage. Relevance here is naive token overlap; a real
 * backend will rank differently and callers will not notice, which is the
 * whole point of the interface.
 */

const DEFAULT_LIMIT = 5;

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "can", "do", "does", "for", "from",
  "have", "how", "i", "if", "in", "is", "it", "long", "many", "much", "of", "on",
  "or", "our", "should", "the", "to", "we", "what", "when", "will", "with",
]);

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));

/** Crude stem so "hire"/"hiring"/"hires" and "raise"/"raising" collapse together. */
const stem = (token: string): string =>
  token.replace(/(ings|ing|ed|es|s)$/, "").replace(/e$/, "");

/** Prefix match, so "hir" from "hiring" still finds "hire". */
const matches = (queryToken: string, recordToken: string): boolean =>
  queryToken === recordToken ||
  recordToken.startsWith(queryToken) ||
  queryToken.startsWith(recordToken);

const overlapScore = (query: string, record: MemoryRecord): number => {
  const queryTokens = [...new Set(tokenize(query).map(stem))].filter(
    (token) => token.length > 2
  );
  if (queryTokens.length === 0) return 0;

  const recordTokens = [
    ...new Set(
      tokenize([record.content, record.kind, ...(record.labels ?? [])].join(" ")).map(stem)
    ),
  ];

  const hits = queryTokens.filter((queryToken) =>
    recordTokens.some((recordToken) => matches(queryToken, recordToken))
  ).length;

  return hits / queryTokens.length;
};

const matchesFilters = (record: MemoryRecord, query: MemoryQuery): boolean => {
  if (query.kinds?.length && !query.kinds.includes(record.kind)) return false;
  if (query.labels?.length) {
    const labels = record.labels ?? [];
    if (!query.labels.some((label) => labels.includes(label))) return false;
  }
  return true;
};

/**
 * Seeded, read-only persistent memory.
 *
 * Ranking is relevance first, then importance, so a caller that supplies no
 * query text still gets the company's most load-bearing knowledge back. That
 * is what lets the context builder open a brand-new conversation with
 * something useful already in hand.
 */
export class InMemoryPersistentMemory implements PersistentMemory {
  private readonly byCompany = new Map<string, MemoryRecord[]>();

  constructor(seed: Record<string, MemoryRecord[]> = {}) {
    for (const [companyId, records] of Object.entries(seed)) {
      this.byCompany.set(companyId, [...records]);
    }
  }

  async search(scope: MemoryScope, query: MemoryQuery): Promise<MemoryRecord[]> {
    const records = this.byCompany.get(scope.companyId) ?? [];

    return records
      .filter((record) => matchesFilters(record, query))
      .map((record) => ({
        record,
        score: query.text ? overlapScore(query.text, record) : 0,
      }))
      .sort(
        (a, b) =>
          b.score - a.score || (b.record.importance ?? 0) - (a.record.importance ?? 0)
      )
      .slice(0, query.limit ?? DEFAULT_LIMIT)
      .map(({ record }) => record);
  }

  async get(scope: MemoryScope, id: string): Promise<MemoryRecord | null> {
    const records = this.byCompany.get(scope.companyId) ?? [];
    return records.find((record) => record.id === id) ?? null;
  }

  /** Test/seed helper. Not part of {@link PersistentMemory}. */
  add(scope: MemoryScope, record: MemoryRecord): void {
    const records = this.byCompany.get(scope.companyId) ?? [];
    this.byCompany.set(scope.companyId, [...records, record]);
  }
}

/**
 * Process-local working memory, keyed by company *and* thread.
 *
 * Nothing written here is company knowledge: it disappears with the process,
 * and it is invisible to any other thread.
 */
export class InMemoryThreadMemory implements ThreadMemory {
  private readonly byThread = new Map<string, ThreadState>();

  private static key({ companyId, threadId }: ThreadRef): string {
    return `${companyId}::${threadId}`;
  }

  async load(ref: ThreadRef): Promise<ThreadState | null> {
    return this.byThread.get(InMemoryThreadMemory.key(ref)) ?? null;
  }

  async appendNote(ref: ThreadRef, note: string): Promise<void> {
    const key = InMemoryThreadMemory.key(ref);
    const existing = this.byThread.get(key);

    this.byThread.set(key, {
      threadId: ref.threadId,
      summary: existing?.summary,
      notes: [...(existing?.notes ?? []), note],
    });
  }

  /** Test/seed helper. Not part of {@link ThreadMemory}. */
  setSummary(ref: ThreadRef, summary: string): void {
    const key = InMemoryThreadMemory.key(ref);
    const existing = this.byThread.get(key);

    this.byThread.set(key, {
      threadId: ref.threadId,
      summary,
      notes: existing?.notes ?? [],
    });
  }
}
