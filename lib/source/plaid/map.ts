import type { AccountBase, RemovedTransaction, Transaction } from "plaid";

import {
  DEFAULT_CURRENCY,
  decimalToMinor,
  normalizeCurrency,
} from "@/lib/source/money";
import type {
  NormalizedAccount,
  NormalizedBalanceObservation,
  NormalizedEntry,
  NormalizedRetraction,
  ProviderCategory,
  SourceAccountKind,
} from "@/lib/source/types";

/**
 * Plaid -> Source Layer.
 *
 * Pure functions, no network and no database, so every convention Plaid holds
 * that this layer does not can be pinned down in a test.
 *
 * There are three such conventions, and they are the whole reason this file
 * exists rather than the mapping living inline in a route handler:
 *
 * 1. **Sign.** Plaid reports a positive amount for money leaving the account.
 *    This layer is the other way round, so amounts are inverted here.
 * 2. **Decimals.** Plaid reports `12.34`. This layer stores `1234`.
 * 3. **Credit balances.** Plaid reports a credit line's `current` as a positive
 *    amount owed. This layer states a signed position, so it is negated.
 *
 * Every one of those is a place a downstream `SUM()` would have been silently
 * wrong. None of them is visible above this file.
 */

/**
 * Plaid's `type`/`subtype` pair collapsed onto the shared account vocabulary.
 *
 * `depository` splits on subtype because the checking/savings distinction is
 * one both providers make. Everything else maps on `type` alone: Plaid's
 * subtypes below that level are far finer than Rho's, and inventing shared
 * meaning for them would be generalizing where the providers do not agree.
 */
export const toAccountKind = (
  type: string | null | undefined,
  subtype: string | null | undefined
): SourceAccountKind => {
  switch (type) {
    case "depository":
      return subtype === "savings" || subtype === "cd" || subtype === "money market"
        ? "savings"
        : "checking";
    case "credit":
      return "credit";
    case "investment":
    case "brokerage":
      return "investment";
    default:
      return "other";
  }
};

/** Accounts whose balance Plaid states as a positive amount owed. */
const isLiability = (kind: SourceAccountKind): boolean => kind === "credit";

export const toAccount = (
  account: AccountBase,
  observedAt: string
): NormalizedAccount => ({
  providerAccountId: account.account_id,
  kind: toAccountKind(account.type, account.subtype),
  name: account.official_name ?? account.name ?? null,
  mask: account.mask ?? null,
  currency: normalizeCurrency(account.balances?.iso_currency_code),
  providerAttributes: {
    type: account.type ?? null,
    subtype: account.subtype ?? null,
    name: account.name ?? null,
    officialName: account.official_name ?? null,
    // Retained because it is the only signal that `iso_currency_code` was null
    // for a real reason rather than an omission.
    unofficialCurrencyCode: account.balances?.unofficial_currency_code ?? null,
  },
  raw: {
    recordType: "account",
    providerRecordId: account.account_id,
    payload: account,
    observedAt,
  },
});

/**
 * Plaid's balance block as a signed position.
 *
 * `available` is dropped for credit lines. Plaid means "remaining headroom on
 * the line" there, which is not the same quantity as "spendable funds held" and
 * would be a lie in a column that means the latter. It stays in the raw record.
 */
export const toBalanceObservation = (
  account: AccountBase,
  observedAt: string
): NormalizedBalanceObservation | null => {
  const current = account.balances?.current;
  if (current === null || current === undefined) return null;

  const kind = toAccountKind(account.type, account.subtype);
  const currency = normalizeCurrency(account.balances?.iso_currency_code);
  const sign = isLiability(kind) ? -1 : 1;
  const available = account.balances?.available;

  return {
    providerAccountId: account.account_id,
    observedAt,
    currentMinor: sign * decimalToMinor(current, currency),
    availableMinor:
      isLiability(kind) || available === null || available === undefined
        ? null
        : decimalToMinor(available, currency),
    currency,
  };
};

/**
 * Plaid's classification, tagged with which of its two taxonomies it came from.
 *
 * The previous implementation coalesced `personal_finance_category.primary`
 * with the legacy `category[0]` into one column, which left no way to tell
 * which vocabulary a given row spoke. They are kept distinguishable instead.
 */
const toProviderCategory = (transaction: Transaction): ProviderCategory | null => {
  const pfc = transaction.personal_finance_category;
  if (pfc?.primary) {
    return {
      taxonomy: "plaid.personal_finance_category",
      value: pfc.primary,
      detail: pfc.detailed ?? undefined,
      confidence: pfc.confidence_level ?? undefined,
    };
  }

  const legacy = transaction.category?.[0];
  return legacy ? { taxonomy: "plaid.category", value: legacy } : null;
};

/** `YYYY-MM-DD` from Plaid's date-only fields, which are already in that shape. */
const toDateOnly = (value: string | null | undefined): string | null =>
  value ? value.slice(0, 10) : null;

/**
 * A Plaid transaction as a signed entry.
 *
 * `pending_transaction_id` is carried through as
 * {@link NormalizedEntry.supersedesProviderEntryId}. Plaid retires a pending
 * transaction and issues the posted one under a *new* id, so without that link
 * the same $4,200 charge appears twice with nothing to say they are the same
 * event. The previous schema dropped the field entirely.
 */
export const toEntry = (
  transaction: Transaction,
  observedAt: string
): NormalizedEntry => {
  const currency = normalizeCurrency(
    transaction.iso_currency_code,
    normalizeCurrency(transaction.unofficial_currency_code, DEFAULT_CURRENCY)
  );

  const postedOn = toDateOnly(transaction.date);
  const initiatedOn = toDateOnly(transaction.authorized_date);

  return {
    providerEntryId: transaction.transaction_id,
    providerAccountId: transaction.account_id,
    // Plaid exposes no cross-account movement identifier.
    movementKey: null,
    // The inversion: Plaid positive = money out, this layer negative = money out.
    amountMinor: -decimalToMinor(transaction.amount, currency),
    currency,
    status: transaction.pending ? "pending" : "posted",
    initiatedAt: transaction.authorized_datetime ?? dateOnlyToIso(initiatedOn),
    postedAt: transaction.pending
      ? null
      : (transaction.datetime ?? dateOnlyToIso(postedOn)),
    occurredOn: postedOn ?? initiatedOn ?? observedAt.slice(0, 10),
    description: transaction.name,
    counterpartyName: transaction.merchant_name ?? null,
    providerCategory: toProviderCategory(transaction),
    providerAttributes: {
      paymentChannel: transaction.payment_channel ?? null,
      transactionCode: transaction.transaction_code ?? null,
      authorizedDate: transaction.authorized_date ?? null,
      unofficialCurrencyCode: transaction.unofficial_currency_code ?? null,
    },
    supersedesProviderEntryId: transaction.pending_transaction_id ?? null,
    raw: {
      recordType: "transaction",
      providerRecordId: transaction.transaction_id,
      payload: transaction,
      observedAt,
    },
  };
};

/** Midnight UTC for a date-only field, so the timestamp columns stay populated. */
const dateOnlyToIso = (value: string | null): string | null =>
  value ? `${value}T00:00:00.000Z` : null;

export const toRetraction = (
  removed: RemovedTransaction,
  observedAt: string
): NormalizedRetraction => ({
  providerEntryId: removed.transaction_id,
  observedAt,
});
