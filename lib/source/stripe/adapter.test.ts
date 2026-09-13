import { describe, expect, it } from "vitest";
import type Stripe from "stripe";

import {
  createStripeAdapter,
  INITIAL_LOOKBACK_SECONDS,
  resolveCreatedAfter,
  RESYNC_OVERLAP_SECONDS,
} from "@/lib/source/stripe/adapter";
import type { SourceConnectionHandle, SourceSyncPage } from "@/lib/source/types";

const NOW = new Date("2026-09-13T12:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

describe("resolveCreatedAfter", () => {
  it("looks back INITIAL_LOOKBACK_SECONDS with no prior watermark", () => {
    expect(resolveCreatedAfter({}, NOW)).toBe(NOW_SECONDS - INITIAL_LOOKBACK_SECONDS);
  });

  it("rewinds an existing watermark by RESYNC_OVERLAP_SECONDS", () => {
    const watermark = NOW_SECONDS - 1_000;
    expect(resolveCreatedAfter({ watermark }, NOW)).toBe(watermark - RESYNC_OVERLAP_SECONDS);
  });
});

const balanceTransaction = (id: string, created: number): Stripe.BalanceTransaction =>
  ({
    id,
    object: "balance_transaction",
    amount: 1_000,
    net: 1_000,
    fee: 0,
    currency: "usd",
    type: "charge",
    reporting_category: "charge",
    status: "available",
    created,
    available_on: created,
    description: null,
    source: null,
  }) as Stripe.BalanceTransaction;

describe("createStripeAdapter", () => {
  it("pages balance transactions and advances the watermark forward only", async () => {
    const pages = [
      [balanceTransaction("txn_1", NOW_SECONDS - 100), balanceTransaction("txn_2", NOW_SECONDS - 50)],
      [balanceTransaction("txn_3", NOW_SECONDS - 10)],
    ];
    let call = 0;

    const stubClient = {
      balance: {
        retrieve: async () =>
          ({
            object: "balance",
            available: [{ amount: 5_000, currency: "usd", source_types: {} }],
            pending: [],
          }) as unknown as Stripe.Balance,
      },
      balanceTransactions: {
        list: async () => {
          const data = pages[call];
          const hasMore = call < pages.length - 1;
          call += 1;
          return { data, has_more: hasMore };
        },
      },
    } as unknown as Stripe;

    const adapter = createStripeAdapter({ client: stubClient });
    const connection: SourceConnectionHandle = {
      id: "conn_1",
      companyId: "company_1",
      provider: "stripe",
      providerConnectionId: "acct_1",
      credentials: {},
      syncState: {},
    };

    const emitted: SourceSyncPage[] = [];
    for await (const page of adapter.pull({ connection, now: NOW })) {
      emitted.push(page);
    }

    // First page: the balance/account snapshot. Then one page per transaction batch.
    expect(emitted).toHaveLength(3);
    expect(emitted[0].accounts).toHaveLength(1);
    expect(emitted[1].entries?.map((e) => e.providerEntryId)).toEqual(["txn_1", "txn_2"]);
    expect(emitted[2].entries?.map((e) => e.providerEntryId)).toEqual(["txn_3"]);

    const finalWatermark = emitted.at(-1)?.syncStateAfter.watermark;
    expect(finalWatermark).toBe(NOW_SECONDS - 10);
  });
});
