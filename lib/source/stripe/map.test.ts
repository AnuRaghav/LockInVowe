import { describe, expect, it } from "vitest";
import type Stripe from "stripe";

import { toAccountsAndBalances, toBalanceProviderAccountId, toEntry } from "@/lib/source/stripe/map";

const NOW = "2026-09-13T12:00:00.000Z";

const balance = (overrides: Partial<Stripe.Balance> = {}): Stripe.Balance =>
  ({
    object: "balance",
    livemode: false,
    available: [{ amount: 10_000, currency: "usd", source_types: {} }],
    pending: [{ amount: 2_500, currency: "usd", source_types: {} }],
    ...overrides,
  }) as Stripe.Balance;

const balanceTransaction = (
  overrides: Partial<Stripe.BalanceTransaction> = {}
): Stripe.BalanceTransaction =>
  ({
    id: "txn_1",
    object: "balance_transaction",
    amount: 5_000,
    net: 4_800,
    fee: 200,
    currency: "usd",
    type: "charge",
    reporting_category: "charge",
    status: "available",
    created: 1_757_764_800, // 2025-09-13T12:00:00Z
    available_on: 1_757_851_200,
    description: "Invoice #123",
    source: "ch_1",
    ...overrides,
  }) as Stripe.BalanceTransaction;

describe("toAccountsAndBalances", () => {
  it("synthesizes one account per currency, current = available + pending", () => {
    const { accounts, balances } = toAccountsAndBalances(balance(), NOW);

    expect(accounts).toHaveLength(1);
    expect(accounts[0].providerAccountId).toBe(toBalanceProviderAccountId("usd"));
    expect(accounts[0].kind).toBe("other");

    expect(balances).toHaveLength(1);
    expect(balances[0]).toMatchObject({
      currentMinor: 12_500,
      availableMinor: 10_000,
      currency: "USD",
    });
  });

  it("treats a currency with no pending funds as zero pending", () => {
    const { balances } = toAccountsAndBalances(
      balance({ pending: [{ amount: 0, currency: "eur", source_types: {} }] as never }),
      NOW
    );

    expect(balances[0].currentMinor).toBe(10_000);
  });
});

describe("toEntry", () => {
  it("carries Stripe's already-signed net amount through unchanged", () => {
    const entry = toEntry(balanceTransaction(), NOW);

    expect(entry.amountMinor).toBe(4_800);
    expect(entry.currency).toBe("USD");
    expect(entry.providerAccountId).toBe(toBalanceProviderAccountId("usd"));
    expect(entry.status).toBe("posted");
    expect(entry.occurredOn).toBe("2025-09-13");
    expect(entry.providerCategory).toEqual({
      taxonomy: "stripe.reporting_category",
      value: "charge",
      detail: "charge",
    });
  });

  it("maps a pending transaction to pending status with no posted date", () => {
    const entry = toEntry(balanceTransaction({ status: "pending" }), NOW);

    expect(entry.status).toBe("pending");
    expect(entry.postedAt).toBeNull();
  });

  it("never claims a superseded entry - Stripe reissues nothing", () => {
    const entry = toEntry(balanceTransaction(), NOW);
    expect(entry.supersedesProviderEntryId).toBeNull();
  });
});
