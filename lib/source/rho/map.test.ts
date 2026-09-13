import { describe, expect, it } from "vitest";

import type { RhoAccount, RhoTransaction } from "@/lib/source/rho/client";
import {
  toAccount,
  toBalanceObservation,
  toEntry,
  toEntryStatus,
} from "@/lib/source/rho/map";

/**
 * Fixtures are real payloads captured from https://rhoapi-sandbox.rho.co,
 * trimmed only of fields this layer does not read.
 */

const OBSERVED_AT = "2026-09-13T12:00:00.000Z";

const checking: RhoAccount = {
  id: "30000000-0000-4000-8000-000000000002",
  account_type: "checking",
  account_name: "Cash (Checking)",
  account_number_last_4: "9508",
  routing_number_last_4: "0089",
  balance: { amount: 876138, currency: "USD" },
};

const creditAccount: RhoAccount = {
  id: "30000000-0000-4000-8000-000000000007",
  account_type: "credit",
  account_name: "Credit Account",
  balance: { amount: 0, currency: "USD" },
};

/** The two legs of one credit-card repayment, linked by money_movement_id. */
const repaymentFromChecking: RhoTransaction = {
  id: "019f0143-3ea0-7000-8000-000000000002",
  money_movement_id: "40000000-0000-4000-8000-000000000002",
  account_id: "30000000-0000-4000-8000-000000000002",
  account_name: "Cash (Checking)",
  account_type: "checking",
  amount: { amount: -1750, currency: "USD" },
  status: "settled",
  transaction_type: "credit_repayment",
  counterparty_name: "Credit Account",
  initiated_at: "2026-06-26T00:10:12Z",
  posted_at: "2026-06-26T00:10:12Z",
  memo: "Daily credit repayment for date 2026/06/24",
  note: "Daily credit repayment for date 2026/06/24",
};

const repaymentToCredit: RhoTransaction = {
  ...repaymentFromChecking,
  id: "019f0143-3ea0-7000-8000-000000000003",
  account_id: "30000000-0000-4000-8000-000000000007",
  account_name: "Credit Account",
  account_type: "credit",
  amount: { amount: 1750, currency: "USD" },
  counterparty_name: "Cash (Checking)",
};

const failedRent: RhoTransaction = {
  id: "019eda73-2218-7000-8000-000000000012",
  money_movement_id: "40000000-0000-4000-8000-000000000015",
  account_id: "30000000-0000-4000-8000-000000000002",
  account_name: "Cash (Checking)",
  account_type: "checking",
  amount: { amount: -339100, currency: "USD" },
  status: "failed",
  transaction_type: "check_payment",
  counterparty_name: "Crescent Property Group",
  initiated_at: "2026-06-18T11:17:19Z",
  // Rho populates posted_at even on rows that never posted.
  posted_at: "2026-06-18T11:17:19Z",
  memo: "Monthly office rent",
  note: "Monthly office rent",
};

const unapprovedFreight: RhoTransaction = {
  id: "019d3e86-4482-7000-8000-000000000048",
  money_movement_id: "40000000-0000-4000-8000-000000000065",
  account_id: "30000000-0000-4000-8000-000000000002",
  account_name: "Cash (Checking)",
  account_type: "checking",
  amount: { amount: -1250000, currency: "USD" },
  status: "awaiting_approval",
  transaction_type: "ach_debit",
  counterparty_name: "Harborline Logistics",
  initiated_at: "2026-03-30T11:36:00Z",
  posted_at: null,
  memo: "Q3 freight invoice",
  note: "Q3 freight invoice",
};

describe("toEntryStatus", () => {
  it("maps Rho's four statuses onto the neutral four", () => {
    expect(toEntryStatus("pending")).toBe("pending");
    expect(toEntryStatus("settled")).toBe("posted");
    // Neither of these has a Plaid equivalent, and collapsing them into
    // "posted" would put money that never moved into a cash figure.
    expect(toEntryStatus("failed")).toBe("failed");
    expect(toEntryStatus("awaiting_approval")).toBe("scheduled");
  });
});

describe("toAccount", () => {
  it("maps Rho's account types straight onto the shared vocabulary", () => {
    expect(toAccount(checking, OBSERVED_AT)).toMatchObject({
      providerAccountId: "30000000-0000-4000-8000-000000000002",
      kind: "checking",
      name: "Cash (Checking)",
      mask: "9508",
      currency: "USD",
      providerAttributes: { accountType: "checking", routingNumberLast4: "0089" },
    });
  });
});

describe("toBalanceObservation", () => {
  it("passes Rho's already-signed balance through unchanged", () => {
    expect(toBalanceObservation(checking, OBSERVED_AT)).toEqual({
      providerAccountId: "30000000-0000-4000-8000-000000000002",
      observedAt: OBSERVED_AT,
      currentMinor: 876138,
      availableMinor: null,
      currency: "USD",
    });
  });

  it("does not negate a credit balance the way the Plaid mapper does", () => {
    // Rho's ledger is signed throughout, so its credit balances already express
    // the position convention this layer uses. Pinned here because the sandbox
    // has only zero-balance credit accounts, which cannot show the difference,
    // and because inverting it later would silently flip a real number.
    expect(toBalanceObservation(creditAccount, OBSERVED_AT)?.currentMinor).toBe(0);
    expect(
      toBalanceObservation(
        { ...creditAccount, balance: { amount: -30000, currency: "USD" } },
        OBSERVED_AT
      )?.currentMinor
    ).toBe(-30000);
  });
});

describe("toEntry", () => {
  it("passes Rho's signed minor units straight through", () => {
    const entry = toEntry(repaymentFromChecking, OBSERVED_AT);

    expect(entry.amountMinor).toBe(-1750);
    expect(entry.currency).toBe("USD");
    expect(entry.status).toBe("posted");
    expect(entry.occurredOn).toBe("2026-06-26");
  });

  it("preserves the movement link between the two legs of a transfer", () => {
    // This is the thing Plaid cannot express. Both legs of one repayment carry
    // the same movement key, so downstream code can recognise an internal
    // transfer instead of counting it as both an inflow and an outflow.
    const out = toEntry(repaymentFromChecking, OBSERVED_AT);
    const into = toEntry(repaymentToCredit, OBSERVED_AT);

    expect(out.movementKey).toBe("40000000-0000-4000-8000-000000000002");
    expect(into.movementKey).toBe(out.movementKey);
    expect(out.amountMinor + into.amountMinor).toBe(0);
  });

  it("keeps a failed movement, marked, rather than dropping or posting it", () => {
    const entry = toEntry(failedRent, OBSERVED_AT);

    expect(entry.status).toBe("failed");
    // Rho sent a posted_at, but the money did not move, so no posted timestamp
    // is asserted. Status is the authority, not the presence of the field.
    expect(entry.postedAt).toBeNull();
    expect(entry.amountMinor).toBe(-339100);
  });

  it("represents an unapproved payment as intent, not money", () => {
    const entry = toEntry(unapprovedFreight, OBSERVED_AT);

    expect(entry.status).toBe("scheduled");
    expect(entry.postedAt).toBeNull();
    expect(entry.occurredOn).toBe("2026-03-30");
  });

  it("describes the entry with the bank's memo, not a user's note", () => {
    // `note` is editable text a user typed into Rho. In the sandbox it carries
    // commentary the bank never sent, so treating it as the description would
    // let interpretation leak into the Source Layer.
    const annotated = {
      ...failedRent,
      memo: "[INVALID_ROUTING] Payroll cycle",
      note: "[INVALID_ROUTING] Payroll cycle, Error: Invalid receiving routing number.",
    };

    const entry = toEntry(annotated, OBSERVED_AT);

    expect(entry.description).toBe("[INVALID_ROUTING] Payroll cycle");
    expect(entry.providerAttributes.note).toBe(annotated.note);
  });

  it("falls back to the counterparty when there is no memo", () => {
    expect(
      toEntry({ ...repaymentFromChecking, memo: null }, OBSERVED_AT).description
    ).toBe("Credit Account");
  });

  it("tags the category with Rho's vocabulary rather than a shared one", () => {
    expect(toEntry(repaymentFromChecking, OBSERVED_AT).providerCategory).toEqual({
      taxonomy: "rho.transaction_type",
      value: "credit_repayment",
    });
  });

  it("never claims an entry supersedes another, because Rho keeps one id", () => {
    expect(toEntry(repaymentFromChecking, OBSERVED_AT).supersedesProviderEntryId).toBeNull();
  });
});
