import { normalizeCurrency } from "@/lib/source/money";
import type {
  RhoAccount,
  RhoAccountType,
  RhoTransaction,
  RhoTransactionStatus,
} from "@/lib/source/rho/client";
import type {
  NormalizedAccount,
  NormalizedBalanceObservation,
  NormalizedEntry,
  SourceAccountKind,
  SourceEntryStatus,
} from "@/lib/source/types";

/**
 * Rho -> Source Layer.
 *
 * Rho lands closer to this layer's conventions than Plaid does: amounts already
 * arrive as signed integer minor units with money leaving the account negative,
 * which is exactly what {@link NormalizedEntry.amountMinor} means. That is not a
 * coincidence worth congratulating ourselves for - it is why the neutral
 * convention was chosen this way round, since a signed ledger is the shape a
 * deterministic sum wants and Plaid's is the unusual one.
 *
 * What Rho brings that Plaid cannot is `money_movement_id`: a provider-native
 * link between the legs of one movement. A credit-card repayment arrives as
 * -1750 on the checking account and +1750 on the credit account under a single
 * movement id, so a transfer is *identifiable* rather than something downstream
 * code has to guess at with amount-and-date heuristics. That link is preserved
 * as {@link NormalizedEntry.movementKey}.
 */

/** Rho's account types are already the shared vocabulary, one for one. */
const ACCOUNT_KINDS: Record<RhoAccountType, SourceAccountKind> = {
  checking: "checking",
  savings: "savings",
  credit: "credit",
  investment: "investment",
  rewards: "rewards",
};

export const toAccountKind = (type: RhoAccountType): SourceAccountKind =>
  ACCOUNT_KINDS[type] ?? "other";

/**
 * Rho's four statuses onto the neutral four.
 *
 * `failed` and `awaiting_approval` have no Plaid equivalent, and that asymmetry
 * is the point: Rho reports attempted-and-rejected movements and unapproved
 * intents in the same feed as real ones. Collapsing them into "posted" would
 * have put money that never moved into a cash figure. Plaid simply never emits
 * these two.
 */
const ENTRY_STATUSES: Record<RhoTransactionStatus, SourceEntryStatus> = {
  pending: "pending",
  settled: "posted",
  failed: "failed",
  awaiting_approval: "scheduled",
};

export const toEntryStatus = (status: RhoTransactionStatus): SourceEntryStatus =>
  ENTRY_STATUSES[status] ?? "pending";

export const toAccount = (
  account: RhoAccount,
  observedAt: string
): NormalizedAccount => ({
  providerAccountId: account.id,
  kind: toAccountKind(account.account_type),
  name: account.account_name ?? null,
  mask: account.account_number_last_4 ?? null,
  currency: normalizeCurrency(account.balance?.currency),
  providerAttributes: {
    accountType: account.account_type,
    routingNumberLast4: account.routing_number_last_4 ?? null,
  },
  raw: {
    recordType: "account",
    providerRecordId: account.id,
    payload: account,
    observedAt,
  },
});

/**
 * Rho's balance as a signed position.
 *
 * Passed through unchanged, unlike Plaid's. Rho's ledger is signed throughout -
 * a card purchase on a credit account is reported negative - so its balances
 * already express the position convention this layer uses, and negating credit
 * balances the way the Plaid mapper does would invert a number that was already
 * right.
 *
 * This is an inference from Rho's transaction sign convention rather than
 * something the docs state outright, and the sandbox's credit accounts all sit
 * at zero, so it is asserted in a test to keep the assumption visible.
 *
 * `available_balance` is marked internal in Rho's OpenAPI document and is
 * absent from sandbox responses; it is read when present and left null
 * otherwise rather than being faked from `balance`.
 */
export const toBalanceObservation = (
  account: RhoAccount,
  observedAt: string
): NormalizedBalanceObservation | null => {
  if (!account.balance) return null;

  const currency = normalizeCurrency(account.balance.currency);

  return {
    providerAccountId: account.id,
    observedAt,
    currentMinor: account.balance.amount,
    availableMinor: account.available_balance?.amount ?? null,
    currency,
  };
};

/** `YYYY-MM-DD` in UTC from an ISO timestamp. */
const toDateOnly = (value: string): string => value.slice(0, 10);

export const toEntry = (
  transaction: RhoTransaction,
  observedAt: string
): NormalizedEntry => {
  const currency = normalizeCurrency(transaction.amount.currency);
  const status = toEntryStatus(transaction.status);

  // Rho populates `posted_at` on some pending rows, so status - not the
  // presence of a timestamp - decides whether this entry has posted. The
  // timestamp is still carried through for anything that wants it.
  const postedAt = status === "posted" ? (transaction.posted_at ?? null) : null;

  return {
    providerEntryId: transaction.id,
    providerAccountId: transaction.account_id,
    movementKey: transaction.money_movement_id,
    amountMinor: transaction.amount.amount,
    currency,
    status,
    initiatedAt: transaction.initiated_at,
    postedAt,
    occurredOn: toDateOnly(
      transaction.posted_at ?? transaction.initiated_at
    ),
    // `memo` is what arrived with the transaction from the bank or payment
    // provider; `note` is text a user typed into Rho afterwards. Only the
    // former describes what happened, so the latter stays in
    // `providerAttributes` rather than becoming the description - a user's
    // annotation is interpretation, and interpretation belongs above this layer.
    description: transaction.memo ?? transaction.counterparty_name,
    counterpartyName: transaction.counterparty_name,
    providerCategory: {
      taxonomy: "rho.transaction_type",
      value: transaction.transaction_type,
    },
    providerAttributes: {
      accountType: transaction.account_type,
      cardId: transaction.card_id ?? null,
      cardName: transaction.card_name ?? null,
      userId: transaction.user_id ?? null,
      userFullName: transaction.user_full_name ?? null,
      trackingNumber: transaction.tracking_number ?? null,
      memo: transaction.memo ?? null,
      note: transaction.note ?? null,
      rhoStatus: transaction.status,
      attachmentCount: transaction.attachments?.length ?? 0,
    },
    // Rho keeps one id across the whole lifecycle, so nothing is superseded.
    supersedesProviderEntryId: null,
    raw: {
      recordType: "transaction",
      providerRecordId: transaction.id,
      payload: transaction,
      observedAt,
    },
  };
};
