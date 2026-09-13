import type Stripe from "stripe";

import { createStripeClient, readSecretKey } from "@/lib/source/stripe/client";
import { toAccountsAndBalances, toEntry } from "@/lib/source/stripe/map";
import type { SourceProviderAdapter, SourcePullContext, SourceSyncPage } from "@/lib/source/types";

/**
 * The Stripe adapter.
 *
 * Stripe's `/v1/balance_transactions` has no diff cursor and no `removed`
 * channel - like Rho, it is a plain list endpoint filtered by `created`. So
 * incremental sync here uses the same watermark strategy as the Rho adapter:
 * resume from the last `created` timestamp seen, rewound slightly so a
 * transaction whose `status` flips from `pending` to `available` after this
 * layer first saw it is re-read rather than left stale forever.
 */

/** How far to rewind the watermark so pending -> available transitions are caught. */
export const RESYNC_OVERLAP_SECONDS = 14 * 24 * 60 * 60;

/** How far back a first sync reaches. */
export const INITIAL_LOOKBACK_SECONDS = 180 * 24 * 60 * 60;

const PAGE_SIZE = 100;

/** Where this run starts reading from, given what the last one recorded. */
export const resolveCreatedAfter = (
  syncState: Record<string, unknown>,
  now: Date
): number => {
  const watermark = syncState.watermark;
  const nowSeconds = Math.floor(now.getTime() / 1000);

  if (typeof watermark === "number" && Number.isFinite(watermark)) {
    return Math.max(0, watermark - RESYNC_OVERLAP_SECONDS);
  }

  return Math.max(0, nowSeconds - INITIAL_LOOKBACK_SECONDS);
};

export interface StripeAdapterOptions {
  /** Injectable for tests; built from the connection's credentials otherwise. */
  client?: Stripe;
}

export const createStripeAdapter = ({
  client,
}: StripeAdapterOptions = {}): SourceProviderAdapter => ({
  provider: "stripe",

  async *pull({ connection, now, signal }: SourcePullContext) {
    const stripe = client ?? createStripeClient(readSecretKey(connection.credentials));
    const observedAt = now.toISOString();

    // Balance (and the synthetic per-currency accounts it implies) is read
    // once per sync, at the start - it describes "right now", not a window.
    const balance = await stripe.balance.retrieve();
    const { accounts, balances } = toAccountsAndBalances(balance, observedAt);

    yield {
      accounts,
      balances,
      syncStateAfter: { watermark: connection.syncState.watermark ?? null },
    } satisfies SourceSyncPage;

    const createdAfter = resolveCreatedAfter(connection.syncState, now);
    // Held across pages so an interrupted sync never advances the watermark
    // past transactions it did not actually persist.
    let watermark =
      typeof connection.syncState.watermark === "number"
        ? connection.syncState.watermark
        : createdAfter;

    let startingAfter: string | undefined;
    let hasMore = true;

    while (hasMore) {
      signal?.throwIfAborted();

      const page = await stripe.balanceTransactions.list({
        limit: PAGE_SIZE,
        created: { gt: createdAfter },
        starting_after: startingAfter,
      });

      for (const transaction of page.data) {
        if (transaction.created > watermark) watermark = transaction.created;
      }

      yield {
        entries: page.data.map((transaction) => toEntry(transaction, observedAt)),
        // Stripe never retracts a balance transaction.
        retractions: [],
        syncStateAfter: { watermark },
      } satisfies SourceSyncPage;

      hasMore = page.has_more;
      startingAfter = page.data.at(-1)?.id;
    }
  },
});
