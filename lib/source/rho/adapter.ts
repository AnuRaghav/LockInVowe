import { createHash } from "node:crypto";

import {
  createRhoClient,
  isRhoEnvironment,
  type RhoClient,
  type RhoEnvironment,
} from "@/lib/source/rho/client";
import { toAccount, toBalanceObservation, toEntry } from "@/lib/source/rho/map";
import type {
  NormalizedBalanceObservation,
  SourceProviderAdapter,
  SourcePullContext,
  SourceSyncPage,
} from "@/lib/source/types";

/**
 * The Rho adapter.
 *
 * Rho has no diff endpoint. There is no cursor that means "what changed since",
 * no `removed` channel, and no webhook in the v1 surface - only
 * `GET /transactions` with filters and an opaque page token that is bound to
 * the query that issued it.
 *
 * So incremental sync is a *watermark* over `initiated_at`, not a cursor, and
 * the two providers' bookkeeping stays behind the opaque `sync_state` bag
 * precisely so this difference never reaches the layer above.
 *
 * The watermark is rewound by {@link RESYNC_OVERLAP_DAYS} on every run. A Rho
 * transaction's `initiated_at` never changes, but its `status` does - pending
 * becomes settled days later - and a strict watermark would sail straight past
 * that update and leave the entry pending forever. Re-reading a window is
 * cheap and harmless because observations are upserted by natural key.
 */

/** How far to rewind the watermark so status changes on known entries are caught. */
export const RESYNC_OVERLAP_DAYS = 14;

/**
 * How far back a first sync reaches.
 *
 * Rho returns the full history when unfiltered, which is the wrong default for
 * a first link on a large business. A bounded window keeps the initial pull
 * predictable; a deliberate backfill can widen it later.
 */
export const INITIAL_LOOKBACK_DAYS = 180;

const PAGE_SIZE = 100;

const readApiToken = (credentials: Record<string, unknown>): string => {
  const token = credentials.api_token;
  if (typeof token !== "string" || !token) {
    throw new Error("Rho connection is missing an api_token credential.");
  }
  return token;
};

export const readEnvironment = (
  credentials: Record<string, unknown>
): RhoEnvironment =>
  isRhoEnvironment(credentials.environment) ? credentials.environment : "sandbox";

/**
 * A stable identifier for the business a Rho token addresses.
 *
 * Rho's v1 API exposes no business or organization id - the token *is* the
 * scope - so there is nothing to key a connection on. A hash of the credential
 * gives a stable surrogate that never stores or reveals the token itself.
 *
 * The caveat, which is real: rotating the token produces a new surrogate and so
 * a new connection row. Whoever rotates a token has to point the existing
 * connection at it rather than linking again. Plaid has the same property when
 * an Item is re-created, and the fix in both cases is a re-link flow that
 * updates rather than inserts.
 */
export const deriveConnectionId = (apiToken: string): string =>
  `rho_${createHash("sha256").update(apiToken).digest("hex").slice(0, 32)}`;

const shiftDays = (date: Date, days: number): Date =>
  new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

/** Where this run starts reading from, given what the last one recorded. */
export const resolveInitiatedAfter = (
  syncState: Record<string, unknown>,
  now: Date
): string => {
  const watermark = syncState.watermark;

  if (typeof watermark === "string" && !Number.isNaN(Date.parse(watermark))) {
    return shiftDays(new Date(watermark), -RESYNC_OVERLAP_DAYS).toISOString();
  }

  return shiftDays(now, -INITIAL_LOOKBACK_DAYS).toISOString();
};

export interface RhoAdapterOptions {
  /** Injectable for tests; built from the connection's credentials otherwise. */
  client?: RhoClient;
}

export const createRhoAdapter = ({
  client,
}: RhoAdapterOptions = {}): SourceProviderAdapter => ({
  provider: "rho",

  async *pull({ connection, now, signal }: SourcePullContext) {
    const rho =
      client ??
      createRhoClient({
        apiToken: readApiToken(connection.credentials),
        environment: readEnvironment(connection.credentials),
      });

    const observedAt = now.toISOString();
    const initiatedAfter = resolveInitiatedAfter(connection.syncState, now);
    // Held across pages so an interrupted sync never advances the watermark
    // past transactions it did not actually persist.
    let watermark =
      typeof connection.syncState.watermark === "string"
        ? connection.syncState.watermark
        : initiatedAfter;

    // Accounts first: entries reference them, and Rho returns the full list
    // cheaply. Balances are observed at the same instant.
    let accountToken: string | undefined;
    do {
      signal?.throwIfAborted();

      const response = await rho.listAccounts({
        pageSize: PAGE_SIZE,
        pageToken: accountToken,
        signal,
      });

      const page: SourceSyncPage = {
        accounts: response.accounts.map((account) => toAccount(account, observedAt)),
        balances: response.accounts
          .map((account) => toBalanceObservation(account, observedAt))
          .filter((balance): balance is NormalizedBalanceObservation => balance !== null),
        syncStateAfter: { watermark },
      };

      yield page;
      accountToken = response.page.next_page_token ?? undefined;
    } while (accountToken);

    // Then transactions, ascending by `initiated_at` so the watermark only ever
    // moves forward as pages are consumed.
    let transactionToken: string | undefined;
    do {
      signal?.throwIfAborted();

      const response = await rho.listTransactions({
        pageSize: PAGE_SIZE,
        pageToken: transactionToken,
        // A page token is bound to the query that issued it, so the filter is
        // sent only on the first request and the token carries it thereafter.
        initiatedAfter: transactionToken ? undefined : initiatedAfter,
        sortBy: "initiated_at",
        order: "asc",
        signal,
      });

      for (const transaction of response.transactions) {
        // Compared as instants, not strings: Rho omits milliseconds where the
        // stored watermark (an ISO string from `toISOString`) carries them, and
        // lexicographic order gets that pair wrong.
        if (Date.parse(transaction.initiated_at) > Date.parse(watermark)) {
          watermark = transaction.initiated_at;
        }
      }

      yield {
        entries: response.transactions.map((transaction) =>
          toEntry(transaction, observedAt)
        ),
        // Rho never retracts a record, so this channel stays empty rather than
        // being simulated from absence - a transaction missing from a page
        // means it fell outside the query, not that it was withdrawn.
        retractions: [],
        syncStateAfter: { watermark },
      } satisfies SourceSyncPage;

      transactionToken = response.page.next_page_token ?? undefined;
    } while (transactionToken);
  },
});
