import type { AccountBase, Transaction } from "plaid";
import { describe, expect, it } from "vitest";

import {
  toAccount,
  toAccountKind,
  toBalanceObservation,
  toEntry,
} from "@/lib/source/plaid/map";

const OBSERVED_AT = "2026-09-13T12:00:00.000Z";

const checking = {
  account_id: "acc_checking",
  name: "Plaid Checking",
  official_name: "Plaid Gold Standard 0% Interest Checking",
  type: "depository",
  subtype: "checking",
  mask: "0000",
  balances: {
    available: 100.5,
    current: 110.25,
    iso_currency_code: "USD",
    unofficial_currency_code: null,
    limit: null,
  },
} as unknown as AccountBase;

const creditCard = {
  account_id: "acc_credit",
  name: "Plaid Credit Card",
  official_name: null,
  type: "credit",
  subtype: "credit card",
  mask: "3333",
  balances: {
    // Plaid states a credit line's current balance as a positive amount owed,
    // and `available` as remaining headroom on the line.
    available: 4700,
    current: 300,
    iso_currency_code: "USD",
    unofficial_currency_code: null,
    limit: 5000,
  },
} as unknown as AccountBase;

const purchase = {
  transaction_id: "txn_posted",
  account_id: "acc_checking",
  // Plaid's convention: a positive amount is money LEAVING the account.
  amount: 89.4,
  iso_currency_code: "USD",
  unofficial_currency_code: null,
  date: "2026-09-10",
  authorized_date: "2026-09-09",
  datetime: null,
  authorized_datetime: null,
  name: "AWS EMEA",
  merchant_name: "Amazon Web Services",
  pending: false,
  pending_transaction_id: null,
  payment_channel: "online",
  transaction_code: null,
  personal_finance_category: {
    primary: "GENERAL_SERVICES",
    detailed: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
    confidence_level: "HIGH",
  },
  category: ["Service", "Computers"],
} as unknown as Transaction;

describe("toAccountKind", () => {
  it("splits depository on the distinction Rho also makes", () => {
    expect(toAccountKind("depository", "checking")).toBe("checking");
    expect(toAccountKind("depository", "savings")).toBe("savings");
    expect(toAccountKind("depository", "money market")).toBe("savings");
  });

  it("maps the remaining types onto the shared vocabulary", () => {
    expect(toAccountKind("credit", "credit card")).toBe("credit");
    expect(toAccountKind("investment", "brokerage")).toBe("investment");
    expect(toAccountKind("loan", "student")).toBe("other");
  });
});

describe("toAccount", () => {
  it("keeps Plaid's own vocabulary rather than losing it to the mapping", () => {
    expect(toAccount(checking, OBSERVED_AT)).toMatchObject({
      providerAccountId: "acc_checking",
      kind: "checking",
      mask: "0000",
      currency: "USD",
      providerAttributes: { type: "depository", subtype: "checking" },
      raw: { recordType: "account", providerRecordId: "acc_checking" },
    });
  });
});

describe("toBalanceObservation", () => {
  it("passes an asset balance through as a positive position", () => {
    expect(toBalanceObservation(checking, OBSERVED_AT)).toEqual({
      providerAccountId: "acc_checking",
      observedAt: OBSERVED_AT,
      currentMinor: 11025,
      availableMinor: 10050,
      currency: "USD",
    });
  });

  it("states a credit balance as a negative position and drops Plaid's headroom", () => {
    // $300 owed is -30000 minor as a position, and the $4,700 of remaining
    // credit is not a spendable balance of held funds, so it is not reported
    // as one. Summing these naively as cash was the bug this prevents.
    expect(toBalanceObservation(creditCard, OBSERVED_AT)).toEqual({
      providerAccountId: "acc_credit",
      observedAt: OBSERVED_AT,
      currentMinor: -30000,
      availableMinor: null,
      currency: "USD",
    });
  });

  it("reports nothing rather than zero when Plaid has no balance", () => {
    const noBalance = {
      ...checking,
      balances: { ...checking.balances, current: null },
    } as unknown as AccountBase;

    expect(toBalanceObservation(noBalance, OBSERVED_AT)).toBeNull();
  });
});

describe("toEntry", () => {
  it("inverts Plaid's sign so money out is negative", () => {
    const entry = toEntry(purchase, OBSERVED_AT);

    expect(entry.amountMinor).toBe(-8940);
    expect(entry.currency).toBe("USD");
    expect(entry.status).toBe("posted");
    expect(entry.occurredOn).toBe("2026-09-10");
    expect(entry.counterpartyName).toBe("Amazon Web Services");
  });

  it("tags which of Plaid's two taxonomies the category came from", () => {
    expect(toEntry(purchase, OBSERVED_AT).providerCategory).toEqual({
      taxonomy: "plaid.personal_finance_category",
      value: "GENERAL_SERVICES",
      detail: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
      confidence: "HIGH",
    });

    const legacyOnly = {
      ...purchase,
      personal_finance_category: null,
    } as unknown as Transaction;

    expect(toEntry(legacyOnly, OBSERVED_AT).providerCategory).toEqual({
      taxonomy: "plaid.category",
      value: "Service",
    });
  });

  it("leaves a pending entry without a posted timestamp", () => {
    const pending = {
      ...purchase,
      transaction_id: "txn_pending",
      pending: true,
      date: "2026-09-09",
    } as unknown as Transaction;

    const entry = toEntry(pending, OBSERVED_AT);

    expect(entry.status).toBe("pending");
    expect(entry.postedAt).toBeNull();
    expect(entry.occurredOn).toBe("2026-09-09");
  });

  it("carries the link from a posted entry back to the pending one it replaces", () => {
    // Plaid retires the pending transaction and issues the posted one under a
    // new id. Without this link the same charge looks like two.
    const settled = {
      ...purchase,
      transaction_id: "txn_settled",
      pending_transaction_id: "txn_pending",
    } as unknown as Transaction;

    expect(toEntry(settled, OBSERVED_AT).supersedesProviderEntryId).toBe("txn_pending");
  });

  it("reports no movement key, because Plaid exposes none", () => {
    expect(toEntry(purchase, OBSERVED_AT).movementKey).toBeNull();
  });
});
