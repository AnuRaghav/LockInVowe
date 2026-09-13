import { describe, expect, it } from "vitest";

import {
  createRhoAdapter,
  deriveConnectionId,
  INITIAL_LOOKBACK_DAYS,
  RESYNC_OVERLAP_DAYS,
  resolveInitiatedAfter,
} from "@/lib/source/rho/adapter";
import type {
  RhoClient,
  RhoListAccountsResponse,
  RhoListTransactionsResponse,
  RhoTransaction,
} from "@/lib/source/rho/client";
import type { SourceConnectionHandle, SourceSyncPage } from "@/lib/source/types";

const NOW = new Date("2026-09-13T12:00:00.000Z");

const daysBefore = (from: Date, days: number) =>
  new Date(from.getTime() - days * 86_400_000).toISOString();

const transaction = (id: string, initiatedAt: string): RhoTransaction => ({
  id,
  money_movement_id: `mm_${id}`,
  account_id: "acct_1",
  account_name: "Cash (Checking)",
  account_type: "checking",
  amount: { amount: -1000, currency: "USD" },
  status: "settled",
  transaction_type: "ach_debit",
  counterparty_name: "Someone",
  initiated_at: initiatedAt,
  posted_at: initiatedAt,
});

interface StubCalls {
  transactionQueries: Array<{ pageToken?: string; initiatedAfter?: string }>;
}

const createStubClient = (
  pages: RhoTransaction[][],
  calls: StubCalls
): RhoClient => ({
  async listAccounts(): Promise<RhoListAccountsResponse> {
    return {
      accounts: [
        {
          id: "acct_1",
          account_type: "checking",
          account_name: "Cash (Checking)",
          balance: { amount: 500_00, currency: "USD" },
        },
      ],
      page: { next_page_token: null },
    };
  },
  async listTransactions({ pageToken, initiatedAfter } = {}): Promise<RhoListTransactionsResponse> {
    calls.transactionQueries.push({ pageToken, initiatedAfter });
    const index = pageToken ? Number(pageToken) : 0;

    return {
      transactions: pages[index] ?? [],
      page: {
        next_page_token: index + 1 < pages.length ? String(index + 1) : null,
      },
    };
  },
});

const connection = (syncState: Record<string, unknown>): SourceConnectionHandle => ({
  id: "conn_rho",
  companyId: "company_1",
  provider: "rho",
  providerConnectionId: "rho_abc",
  credentials: { api_token: "rhobat_test" },
  syncState,
});

describe("resolveInitiatedAfter", () => {
  it("reaches back a bounded window on a first sync", () => {
    expect(resolveInitiatedAfter({}, NOW)).toBe(daysBefore(NOW, INITIAL_LOOKBACK_DAYS));
  });

  it("rewinds the watermark so status changes on known entries are re-read", () => {
    // Rho has no diff endpoint, and a transaction's initiated_at never moves
    // even though its status does. A strict watermark would leave a pending
    // entry pending forever.
    const watermark = "2026-09-01T00:00:00.000Z";

    expect(resolveInitiatedAfter({ watermark }, NOW)).toBe(
      daysBefore(new Date(watermark), RESYNC_OVERLAP_DAYS)
    );
  });

  it("ignores an unusable watermark rather than sending garbage to Rho", () => {
    expect(resolveInitiatedAfter({ watermark: "not-a-date" }, NOW)).toBe(
      daysBefore(NOW, INITIAL_LOOKBACK_DAYS)
    );
  });
});

describe("deriveConnectionId", () => {
  it("is stable per token and reveals nothing about it", () => {
    const id = deriveConnectionId("rhobat_secret");

    expect(id).toBe(deriveConnectionId("rhobat_secret"));
    expect(id).not.toContain("secret");
    expect(id).not.toBe(deriveConnectionId("rhobat_other"));
  });
});

describe("createRhoAdapter", () => {
  const drain = async (pages: AsyncIterable<SourceSyncPage>) => {
    const collected: SourceSyncPage[] = [];
    for await (const page of pages) collected.push(page);
    return collected;
  };

  it("emits accounts and balances before entries", async () => {
    const calls: StubCalls = { transactionQueries: [] };
    const adapter = createRhoAdapter({
      client: createStubClient([[transaction("t1", "2026-09-10T00:00:00Z")]], calls),
    });

    const pages = await drain(
      adapter.pull({ connection: connection({}), now: NOW })
    );

    expect(pages[0].accounts).toHaveLength(1);
    expect(pages[0].balances?.[0].currentMinor).toBe(50_000);
    expect(pages[1].entries).toHaveLength(1);
  });

  it("sends the filter once and then lets the page token carry it", async () => {
    // A Rho page_token is bound to the query that issued it, so resending
    // filters alongside a token is not allowed.
    const calls: StubCalls = { transactionQueries: [] };
    const adapter = createRhoAdapter({
      client: createStubClient(
        [
          [transaction("t1", "2026-09-10T00:00:00Z")],
          [transaction("t2", "2026-09-11T00:00:00Z")],
        ],
        calls
      ),
    });

    await drain(adapter.pull({ connection: connection({}), now: NOW }));

    expect(calls.transactionQueries).toEqual([
      { pageToken: undefined, initiatedAfter: daysBefore(NOW, INITIAL_LOOKBACK_DAYS) },
      { pageToken: "1", initiatedAfter: undefined },
    ]);
  });

  it("advances the watermark only as far as the entries it has yielded", async () => {
    const calls: StubCalls = { transactionQueries: [] };
    const adapter = createRhoAdapter({
      client: createStubClient(
        [
          [transaction("t1", "2026-09-10T00:00:00Z")],
          [transaction("t2", "2026-09-11T00:00:00Z")],
        ],
        calls
      ),
    });

    const pages = await drain(
      adapter.pull({ connection: connection({}), now: NOW })
    );

    const entryPages = pages.filter((page) => page.entries?.length);
    expect(entryPages[0].syncStateAfter).toEqual({ watermark: "2026-09-10T00:00:00Z" });
    expect(entryPages[1].syncStateAfter).toEqual({ watermark: "2026-09-11T00:00:00Z" });
  });

  it("never reports a retraction, because Rho cannot express one", async () => {
    const calls: StubCalls = { transactionQueries: [] };
    const adapter = createRhoAdapter({
      client: createStubClient([[transaction("t1", "2026-09-10T00:00:00Z")]], calls),
    });

    const pages = await drain(
      adapter.pull({ connection: connection({}), now: NOW })
    );

    // Absence from a window means "outside the query", never "withdrawn".
    for (const page of pages) expect(page.retractions ?? []).toHaveLength(0);
  });
});
