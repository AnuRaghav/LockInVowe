import { getSourceAdapter } from "@/lib/source/registry";
import {
  addCounts,
  createSourceStore,
  type PagePersistCounts,
  type SourceStore,
} from "@/lib/source/store";
import type { SourceProviderAdapter } from "@/lib/source/types";

/**
 * Running a sync.
 *
 * This is the whole orchestration, and the thing worth noticing is how little
 * of it there is and how completely provider-free it stays. It asks the
 * registry for an adapter, iterates whatever pages come back, hands each to the
 * store, and records the outcome.
 *
 * It contains no cursor handling, no pagination, no `added`/`modified`/`removed`
 * triage, no knowledge that Plaid has a diff stream and Rho does not. Those
 * live behind {@link SourceProviderAdapter}. That is the test of whether the
 * abstraction is real: adding Rho, whose sync model is fundamentally different
 * from Plaid's, required no change to this file at all.
 */

export interface SyncConnectionResult {
  connectionId: string;
  provider: string;
  syncId: string;
  counts: PagePersistCounts;
  syncState: Record<string, unknown>;
}

export class SourceConnectionNotFoundError extends Error {
  constructor(connectionId: string) {
    super(`No source connection "${connectionId}" for this company.`);
    this.name = "SourceConnectionNotFoundError";
  }
}

export interface SyncConnectionInput {
  companyId: string;
  connectionId: string;
  /** Injectable for tests. */
  store?: SourceStore;
  adapter?: SourceProviderAdapter;
  now?: Date;
  signal?: AbortSignal;
}

export const syncSourceConnection = async ({
  companyId,
  connectionId,
  store = createSourceStore(),
  adapter,
  now = new Date(),
  signal,
}: SyncConnectionInput): Promise<SyncConnectionResult> => {
  const connection = await store.loadConnection(companyId, connectionId);
  if (!connection) throw new SourceConnectionNotFoundError(connectionId);

  const provider = adapter ?? getSourceAdapter(connection.provider);
  const { syncId } = await store.startSyncRun(connection);

  let counts: PagePersistCounts = {
    rawRecords: 0,
    accounts: 0,
    balances: 0,
    entries: 0,
    retractions: 0,
  };
  // Only advanced by a page that has been persisted, so a run that dies
  // half-way is safe to retry: the next one re-reads from the last state that
  // was actually written through.
  let syncState = connection.syncState;

  try {
    for await (const page of provider.pull({ connection, now, signal })) {
      const pageCounts = await store.persistPage({ connection, syncId, page });
      counts = addCounts(counts, pageCounts);
      syncState = page.syncStateAfter;
    }

    await store.completeSyncRun({
      connection,
      syncId,
      syncStateAfter: syncState,
      counts,
      finishedAt: new Date(),
    });

    return {
      connectionId: connection.id,
      provider: connection.provider,
      syncId,
      counts,
      syncState,
    };
  } catch (error) {
    await store.failSyncRun({
      connection,
      syncId,
      error: error instanceof Error ? error.message : String(error),
      counts,
      finishedAt: new Date(),
    });
    throw error;
  }
};
