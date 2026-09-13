import type { AccountBase, Transaction } from "plaid";
import { describe, expect, it } from "vitest";

import * as plaid from "@/lib/source/plaid/map";
import type { RhoAccount, RhoTransaction } from "@/lib/source/rho/client";
import * as rho from "@/lib/source/rho/map";

/**
 * The convergence test.
 *
 * Everything else checks each provider against its own conventions. This checks
 * the thing the Source Layer actually exists to guarantee: that the *same real
 * event*, reported by two providers that describe it completely differently,
 * arrives downstream as the same numbers.
 *
 * If this file ever needs a `provider === "plaid"` branch, the abstraction has
 * failed and something above this layer is about to learn a provider's name.
 */

const OBSERVED_AT = "2026-09-13T12:00:00.000Z";

/** The event: $89.40 leaves the operating checking account, posted 10 Sep. */
const plaidVersion = {
  transaction_id: "plaid_txn",
  account_id: "plaid_acct",
  // Plaid: positive means money out. Decimal major units.
  amount: 89.4,
  iso_currency_code: "USD",
  date: "2026-09-10",
  authorized_date: "2026-09-09",
  datetime: null,
  authorized_datetime: null,
  name: "STRIPE PAYMENT",
  merchant_name: "Stripe",
  pending: false,
  pending_transaction_id: null,
  personal_finance_category: { primary: "GENERAL_SERVICES", detailed: null, confidence_level: null },
  category: null,
} as unknown as Transaction;

const rhoVersion: RhoTransaction = {
  id: "rho_txn",
  money_movement_id: "rho_movement",
  account_id: "rho_acct",
  account_name: "Cash (Checking)",
  account_type: "checking",
  // Rho: negative means money out. Integer minor units.
  amount: { amount: -8940, currency: "USD" },
  status: "settled",
  transaction_type: "ach_debit",
  counterparty_name: "Stripe",
  initiated_at: "2026-09-09T10:00:00Z",
  posted_at: "2026-09-10T10:00:00Z",
};

describe("cross-provider normalization", () => {
  it("reports the same signed minor amount for the same outflow", () => {
    const fromPlaid = plaid.toEntry(plaidVersion, OBSERVED_AT);
    const fromRho = rho.toEntry(rhoVersion, OBSERVED_AT);

    expect(fromPlaid.amountMinor).toBe(-8940);
    expect(fromRho.amountMinor).toBe(-8940);
    expect(fromPlaid.currency).toBe(fromRho.currency);
  });

  it("agrees on lifecycle, date, and counterparty", () => {
    const fromPlaid = plaid.toEntry(plaidVersion, OBSERVED_AT);
    const fromRho = rho.toEntry(rhoVersion, OBSERVED_AT);

    expect(fromPlaid.status).toBe("posted");
    expect(fromRho.status).toBe("posted");
    expect(fromPlaid.occurredOn).toBe("2026-09-10");
    expect(fromRho.occurredOn).toBe("2026-09-10");
    expect(fromPlaid.counterpartyName).toBe("Stripe");
    expect(fromRho.counterpartyName).toBe("Stripe");
  });

  it("keeps each provider's taxonomy distinguishable rather than merging them", () => {
    // Both classify the same event, and neither classification is translated
    // into the other's vocabulary - a shared `category` column would have had
    // to pick one and silently misrepresent the other.
    expect(plaid.toEntry(plaidVersion, OBSERVED_AT).providerCategory?.taxonomy).toBe(
      "plaid.personal_finance_category"
    );
    expect(rho.toEntry(rhoVersion, OBSERVED_AT).providerCategory?.taxonomy).toBe(
      "rho.transaction_type"
    );
  });

  it("reports a $300 credit-card debt as a negative position from either provider", () => {
    const plaidCard = {
      account_id: "plaid_card",
      name: "Card",
      type: "credit",
      subtype: "credit card",
      balances: { current: 300, available: 4700, iso_currency_code: "USD" },
    } as unknown as AccountBase;

    const rhoCard: RhoAccount = {
      id: "rho_card",
      account_type: "credit",
      account_name: "Credit Account",
      balance: { amount: -30000, currency: "USD" },
    };

    expect(plaid.toBalanceObservation(plaidCard, OBSERVED_AT)?.currentMinor).toBe(-30000);
    expect(rho.toBalanceObservation(rhoCard, OBSERVED_AT)?.currentMinor).toBe(-30000);
  });

  it("agrees that both accounts are the same kind despite different vocabularies", () => {
    const plaidChecking = {
      account_id: "a",
      name: "Checking",
      type: "depository",
      subtype: "checking",
      balances: { current: 1, iso_currency_code: "USD" },
    } as unknown as AccountBase;

    expect(plaid.toAccount(plaidChecking, OBSERVED_AT).kind).toBe("checking");
    expect(
      rho.toAccount(
        {
          id: "b",
          account_type: "checking",
          balance: { amount: 1, currency: "USD" },
        },
        OBSERVED_AT
      ).kind
    ).toBe("checking");
  });

  it("only Rho can link the legs of a movement, and says so honestly", () => {
    // Not a shortcoming to paper over: `null` means "this provider does not
    // tell us", which is a different claim from "this entry stands alone".
    expect(plaid.toEntry(plaidVersion, OBSERVED_AT).movementKey).toBeNull();
    expect(rho.toEntry(rhoVersion, OBSERVED_AT).movementKey).toBe("rho_movement");
  });
});
