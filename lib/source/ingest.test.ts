import { describe, expect, it } from "vitest";

import {
  SourceConnectionNotFoundError,
  syncSourceConnection,
} from "@/lib/source/ingest";
import type { PagePersistCounts, SourceStore } from "@/lib/source/store";
import type {
  NormalizedEntry,
  SourceConnectionHandle,
  SourceProviderAdapter,
  SourceSyncPage,
} from "@/lib/source/types";

const connection: SourceConnectionHandle = {
  id: "conn_1",
  companyId: "company_1",
  provider: "rho",
  providerConnectionId: "rho_abc",
  credentials: { api_token: "t" },
  syncState: { watermark: "2026-01-01T00:00:00Z" },
};

const noCounts = (): PagePersistCounts => ({
  rawRecords: 0,
  accounts: 0,
  balances: 0,
  entries: 0,
  retractions: 0,
});

interface Recorded {
  persisted: SourceSyncPage[];
  completed: { syncStateAfter: Record<string, unknown>; counts: PagePersistCounts }[];
  failed: { error: string }[];
}

const createFakeStore = (
  recorded: Recorded,
  handle: SourceConnectionHandle | null = connection,
  onPersist?: () => void
): SourceStore => ({
  async loadConnection() {
    return handle;
  },
  async startSyncRun() {
    return { syncId: "sync_1" };
  },
  async persistPage({ page }) {
    onPersist?.();
    recorded.persisted.push(page);
    return {
      ...noCounts(),
      entries: page.entries?.length ?? 0,
      accounts: page.accounts?.length ?? 0,
    };
  },
  async completeSyncRun({ syncStateAfter, counts }) {
    recorded.completed.push({ syncStateAfter, counts });
  },
  async failSyncRun({ error }) {
    recorded.failed.push({ error });
  },
});

const pagesAdapter = (pages: SourceSyncPage[]): SourceProviderAdapter => ({
  provider: "rho",
  async *pull() {
    for (const page of pages) yield page;
  },
});

const entry = (id: string): NormalizedEntry => ({
  providerEntryId: id,
  providerAccountId: "acct",
  movementKey: null,
  amountMinor: -100,
  currency: "USD",
  status: "posted",
  initiatedAt: null,
  postedAt: null,
  occurredOn: "2026-09-01",
  description: id,
  counterpartyName: null,
  providerCategory: null,
  providerAttributes: {},
  supersedesProviderEntryId: null,
  raw: {
    recordType: "transaction",
    providerRecordId: id,
    payload: { id },
    observedAt: "2026-09-13T00:00:00.000Z",
  },
});

describe("syncSourceConnection", () => {
  it("persists every page and records the last sync state", async () => {
    const recorded: Recorded = { persisted: [], completed: [], failed: [] };

    const result = await syncSourceConnection({
      companyId: "company_1",
      connectionId: "conn_1",
      store: createFakeStore(recorded),
      adapter: pagesAdapter([
        { entries: [entry("a")], syncStateAfter: { watermark: "2026-02-01T00:00:00Z" } },
        { entries: [entry("b"), entry("c")], syncStateAfter: { watermark: "2026-03-01T00:00:00Z" } },
      ]),
    });

    expect(recorded.persisted).toHaveLength(2);
    expect(result.counts.entries).toBe(3);
    expect(result.syncState).toEqual({ watermark: "2026-03-01T00:00:00Z" });
    expect(recorded.completed[0].syncStateAfter).toEqual({
      watermark: "2026-03-01T00:00:00Z",
    });
  });

  it("leaves the sync state where it was when a run fails part-way", async () => {
    const recorded: Recorded = { persisted: [], completed: [], failed: [] };
    let calls = 0;

    await expect(
      syncSourceConnection({
        companyId: "company_1",
        connectionId: "conn_1",
        store: createFakeStore(recorded, connection, () => {
          calls += 1;
          if (calls === 2) throw new Error("provider blew up");
        }),
        adapter: pagesAdapter([
          { entries: [entry("a")], syncStateAfter: { watermark: "2026-02-01T00:00:00Z" } },
          { entries: [entry("b")], syncStateAfter: { watermark: "2026-03-01T00:00:00Z" } },
        ]),
      })
    ).rejects.toThrow("provider blew up");

    // A failed run must be safe to retry, so nothing was committed as progress.
    expect(recorded.completed).toHaveLength(0);
    expect(recorded.failed).toEqual([{ error: "provider blew up" }]);
  });

  it("refuses a connection that does not belong to the company", async () => {
    const recorded: Recorded = { persisted: [], completed: [], failed: [] };

    await expect(
      syncSourceConnection({
        companyId: "other_company",
        connectionId: "conn_1",
        store: createFakeStore(recorded, null),
        adapter: pagesAdapter([]),
      })
    ).rejects.toBeInstanceOf(SourceConnectionNotFoundError);
  });

  it("stays provider-agnostic: a Plaid-shaped run drives the same code path", async () => {
    const recorded: Recorded = { persisted: [], completed: [], failed: [] };

    const result = await syncSourceConnection({
      companyId: "company_1",
      connectionId: "conn_1",
      store: createFakeStore(recorded),
      adapter: {
        provider: "plaid",
        async *pull() {
          yield {
            entries: [entry("p1")],
            retractions: [
              { providerEntryId: "gone", observedAt: "2026-09-13T00:00:00.000Z" },
            ],
            syncStateAfter: { cursor: "CURSOR_2" },
          };
        },
      },
    });

    // Same orchestration, different provider bookkeeping - and the orchestrator
    // never inspects which.
    expect(result.syncState).toEqual({ cursor: "CURSOR_2" });
    expect(recorded.persisted[0].retractions).toHaveLength(1);
  });
});
