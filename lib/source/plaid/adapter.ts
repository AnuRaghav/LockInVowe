import type { PlaidApi } from "plaid";

import { getPlaidClient } from "@/lib/plaid/client";
import {
  toAccount,
  toBalanceObservation,
  toEntry,
  toRetraction,
} from "@/lib/source/plaid/map";
import type {
  NormalizedBalanceObservation,
  SourceProviderAdapter,
  SourcePullContext,
  SourceSyncPage,
} from "@/lib/source/types";

/**
 * The Plaid adapter.
 *
 * Plaid's `/transactions/sync` is a diff stream: each call returns what changed
 * since a cursor, as `added` / `modified` / `removed`. The adapter keeps that
 * efficiency but does not export the shape - `added` and `modified` are both
 * just observations to upsert, and only `removed` carries information the
 * neutral model needs a separate channel for.
 *
 * One page is yielded per Plaid page, so a large backfill streams rather than
 * accumulating every transaction in memory the way the previous route did.
 */

const readAccessToken = (credentials: Record<string, unknown>): string => {
  const token = credentials.access_token;
  if (typeof token !== "string" || !token) {
    throw new Error("Plaid connection is missing an access_token credential.");
  }
  return token;
};

export interface PlaidAdapterOptions {
  /** Injectable for tests; defaults to the shared client. */
  client?: PlaidApi;
}

export const createPlaidAdapter = ({
  client,
}: PlaidAdapterOptions = {}): SourceProviderAdapter => ({
  provider: "plaid",

  async *pull({ connection, now, signal }: SourcePullContext) {
    const plaid = client ?? getPlaidClient();
    const accessToken = readAccessToken(connection.credentials);
    const observedAt = now.toISOString();

    const stateCursor = connection.syncState.cursor;
    let cursor: string | undefined =
      typeof stateCursor === "string" && stateCursor ? stateCursor : undefined;
    let hasMore = true;
    // Accounts and balances ride along on every page of the diff stream, but
    // they describe the same accounts each time. Only the first page's copy is
    // emitted, so one sync produces one balance observation per account rather
    // than one per page.
    let accountsEmitted = false;

    while (hasMore) {
      signal?.throwIfAborted();

      const response = await plaid.transactionsSync({
        access_token: accessToken,
        cursor,
      });
      const data = response.data;

      const page: SourceSyncPage = {
        entries: [...data.added, ...data.modified].map((transaction) =>
          toEntry(transaction, observedAt)
        ),
        retractions: data.removed.map((removed) => toRetraction(removed, observedAt)),
        syncStateAfter: { cursor: data.next_cursor },
      };

      if (!accountsEmitted) {
        page.accounts = data.accounts.map((account) => toAccount(account, observedAt));
        page.balances = data.accounts
          .map((account) => toBalanceObservation(account, observedAt))
          .filter((balance): balance is NormalizedBalanceObservation => balance !== null);
        accountsEmitted = true;
      }

      yield page;

      hasMore = data.has_more;
      cursor = data.next_cursor;
    }
  },
});
