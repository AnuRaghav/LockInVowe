import type Stripe from "stripe";

import type {
  NormalizedAccount,
  NormalizedBalanceObservation,
  NormalizedEntry,
  ProviderCategory,
  SourceAccountKind,
} from "@/lib/source/types";

/**
 * Stripe -> Source Layer.
 *
 * Stripe has no "bank account" concept of its own - money moves through one
 * balance per currency. So unlike Plaid/Rho, where a provider account maps
 * onto a real bank account, this layer synthesizes one {@link NormalizedAccount}
 * per currency Stripe reports a balance in, identified as `balance:<currency>`.
 * That is a faithful description of what Stripe actually tracks, not an
 * invented abstraction: Stripe's own Balance API is shaped the same way.
 *
 * The unit of money movement is Stripe's Balance Transaction - the ledger
 * entry every charge, refund, payout, and fee produces against that balance -
 * which maps directly onto {@link NormalizedEntry}. Stripe already reports
 * amounts in minor units, so unlike Plaid's mapper there is no decimal
 * conversion here, only the two conventions that do differ:
 *
 * 1. **Sign.** Stripe's balance transaction `net` is already signed the way
 *    this layer wants it: positive = money added to the balance, negative =
 *    money removed. No inversion needed.
 * 2. **Status.** Stripe's `status` is `available` | `pending`; this layer's
 *    vocabulary calls the settled state `posted`.
 */

export const STRIPE_ACCOUNT_KIND: SourceAccountKind = "other";

export const toBalanceProviderAccountId = (currency: string): string =>
  `balance:${currency.toLowerCase()}`;

export const toAccount = (
  currency: string,
  observedAt: string,
  raw: unknown
): NormalizedAccount => ({
  providerAccountId: toBalanceProviderAccountId(currency),
  kind: STRIPE_ACCOUNT_KIND,
  name: `Stripe balance (${currency.toUpperCase()})`,
  mask: null,
  currency: currency.toUpperCase(),
  providerAttributes: {},
  raw: {
    recordType: "account",
    providerRecordId: toBalanceProviderAccountId(currency),
    payload: raw,
    observedAt,
  },
});

/**
 * One {@link NormalizedAccount} + {@link NormalizedBalanceObservation} pair per
 * currency present in Stripe's balance response.
 *
 * `available` funds have cleared and can be paid out; `pending` funds belong
 * to the merchant but have not cleared yet - the same relationship Plaid's
 * `current`/`available` pair describes for a depository account, so `current`
 * here is the sum of both and `available` is Stripe's `available` alone.
 */
export const toAccountsAndBalances = (
  balance: Stripe.Balance,
  observedAt: string
): { accounts: NormalizedAccount[]; balances: NormalizedBalanceObservation[] } => {
  const pendingByCurrency = new Map(
    balance.pending.map((entry) => [entry.currency.toUpperCase(), entry.amount])
  );

  const accounts: NormalizedAccount[] = [];
  const balances: NormalizedBalanceObservation[] = [];

  for (const available of balance.available) {
    const currency = available.currency.toUpperCase();
    const pending = pendingByCurrency.get(currency) ?? 0;

    accounts.push(toAccount(currency, observedAt, balance));
    balances.push({
      providerAccountId: toBalanceProviderAccountId(currency),
      observedAt,
      currentMinor: available.amount + pending,
      availableMinor: available.amount,
      currency,
    });
  }

  return { accounts, balances };
};

const toProviderCategory = (
  transaction: Stripe.BalanceTransaction
): ProviderCategory => ({
  taxonomy: "stripe.reporting_category",
  value: transaction.reporting_category,
  detail: transaction.type,
});

/** `YYYY-MM-DD` from a Stripe Unix-seconds timestamp. */
const toDateOnly = (unixSeconds: number): string =>
  new Date(unixSeconds * 1000).toISOString().slice(0, 10);

const toIso = (unixSeconds: number | null | undefined): string | null =>
  unixSeconds ? new Date(unixSeconds * 1000).toISOString() : null;

/**
 * A Stripe balance transaction as a signed entry against its currency's
 * synthetic balance account.
 */
export const toEntry = (
  transaction: Stripe.BalanceTransaction,
  observedAt: string
): NormalizedEntry => {
  const currency = transaction.currency.toUpperCase();

  return {
    providerEntryId: transaction.id,
    providerAccountId: toBalanceProviderAccountId(currency),
    // Stripe exposes no cross-account movement identifier - every entry here
    // already targets the one balance it affected.
    movementKey: null,
    amountMinor: transaction.net,
    currency,
    status: transaction.status === "available" ? "posted" : "pending",
    initiatedAt: toIso(transaction.created),
    postedAt: transaction.status === "available" ? toIso(transaction.available_on) : null,
    occurredOn: toDateOnly(transaction.created),
    description: transaction.description ?? transaction.type,
    counterpartyName: null,
    providerCategory: toProviderCategory(transaction),
    providerAttributes: {
      type: transaction.type,
      feeMinor: transaction.fee,
      grossMinor: transaction.amount,
      source: typeof transaction.source === "string" ? transaction.source : (transaction.source?.id ?? null),
    },
    // Stripe never re-issues a balance transaction under a new id.
    supersedesProviderEntryId: null,
    raw: {
      recordType: "transaction",
      providerRecordId: transaction.id,
      payload: transaction,
      observedAt,
    },
  };
};
