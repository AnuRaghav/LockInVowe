/**
 * The Source Layer's vocabulary.
 *
 * These types describe external financial reality in terms that are true of
 * every provider we integrate, and nothing more. Two tests decide whether a
 * concept belongs here:
 *
 * 1. Do Plaid and Rho genuinely mean the same thing by it? A "posted amount"
 *    passes. A "category" does not - Plaid's personal-finance taxonomy and
 *    Rho's `transaction_type` are different vocabularies describing different
 *    things, so both are carried as tagged provider payloads instead.
 * 2. Is it a statement about what happened, rather than what it means? "This
 *    account is a credit line" passes. "This spend is discretionary" does not:
 *    that is interpretation, and it belongs above this layer.
 *
 * Nothing here computes cash, burn, or runway. This layer says what happened;
 * the Numerical Model says what the numbers mean.
 */

/** Every provider that can feed the layer. Matches the `source_provider` enum. */
export type SourceProviderId = "plaid" | "rho";

/** Which Tier 0 payload shape a raw record holds. */
export type SourceRecordType = "account" | "transaction";

/**
 * What kind of account this is, in terms both providers share.
 *
 * Rho states this directly. Plaid's `type`/`subtype` pair is mapped onto it.
 * The mapping is lossy on purpose, and the provider's own words survive in
 * {@link NormalizedAccount.providerAttributes}.
 */
export type SourceAccountKind =
  | "checking"
  | "savings"
  | "credit"
  | "investment"
  | "rewards"
  | "other";

/**
 * Where an entry sits in its provider's lifecycle.
 *
 * - `pending` - money is moving; amount or timing not final.
 * - `posted` - final; the money moved.
 * - `failed` - attempted; the money did not move.
 * - `scheduled` - recorded intent; no money has moved and it may never.
 *
 * Plaid only produces `pending` and `posted`. Rho produces all four. Which of
 * them count toward a cash figure is deliberately not decided here.
 */
export type SourceEntryStatus = "pending" | "posted" | "failed" | "scheduled";

/**
 * One provider payload, captured verbatim.
 *
 * Every normalized record carries the raw observation it was projected from, so
 * Tier 1 can always be re-derived from Tier 0 without re-contacting the
 * provider - which is what lets the mapping change without a full backfill.
 */
export interface RawObservation {
  recordType: SourceRecordType;
  /** The provider's identifier for this record, as the provider spells it. */
  providerRecordId: string;
  /** The payload exactly as received. Never trimmed to the fields we use today. */
  payload: unknown;
  /** ISO timestamp this layer received it. Not a provider field. */
  observedAt: string;
}

/** An account as the Source Layer understands it. */
export interface NormalizedAccount {
  providerAccountId: string;
  kind: SourceAccountKind;
  name: string | null;
  /** Last few digits, where the provider exposes them. */
  mask: string | null;
  currency: string;
  /** The provider's own account vocabulary, kept so the mapping loses nothing. */
  providerAttributes: Record<string, unknown>;
  raw: RawObservation;
}

/**
 * A balance, true as of an instant.
 *
 * Balances are observations, not properties. Storing them as rows rather than
 * columns is what makes historical cash position answerable at all.
 */
export interface NormalizedBalanceObservation {
  providerAccountId: string;
  observedAt: string;
  /**
   * Signed position in minor units: positive = the company holds value,
   * negative = it owes. Providers disagree here, so adapters normalize onto
   * this convention rather than passing their own through.
   */
  currentMinor: number;
  /**
   * Spendable balance of funds actually held, where the provider means that.
   * Null when it has no such concept for the account - Plaid's `available` on a
   * credit line is remaining headroom, which is a different quantity and is
   * left to the raw record rather than coerced into this field.
   */
  availableMinor: number | null;
  currency: string;
}

/**
 * The provider's own classification, tagged with which vocabulary it speaks.
 *
 * Never flattened into a shared category string. Two providers' taxonomies can
 * be carried side by side honestly; merged, they are quietly wrong.
 */
export interface ProviderCategory {
  /** e.g. `plaid.personal_finance_category`, `rho.transaction_type`. */
  taxonomy: string;
  value: string;
  detail?: string;
  confidence?: string;
}

/**
 * One movement's effect on one account.
 *
 * The unit is an *entry*, not a "transaction". Rho returns one row per account
 * leg and links them with `money_movement_id`; Plaid returns one row per
 * account with no link. "Entry" is a true description of both, where
 * "transaction" would quietly imply Plaid's shape and make Rho's transfers
 * look like unrelated pairs.
 */
export interface NormalizedEntry {
  providerEntryId: string;
  providerAccountId: string;
  /**
   * Groups the legs of one movement. Populated from Rho's `money_movement_id`.
   * Null for Plaid, which exposes no such link - meaning "this provider does
   * not tell us", never "this entry stands alone".
   */
  movementKey: string | null;
  /** Signed minor units: positive = into this account, negative = out of it. */
  amountMinor: number;
  currency: string;
  status: SourceEntryStatus;
  initiatedAt: string | null;
  postedAt: string | null;
  /** `YYYY-MM-DD`. The posted date when there is one, else the initiated date. */
  occurredOn: string;
  description: string;
  counterpartyName: string | null;
  providerCategory: ProviderCategory | null;
  providerAttributes: Record<string, unknown>;
  /**
   * The pending entry this one replaces. Plaid re-issues a posted transaction
   * under a fresh id and retracts the pending one; without this link the pair
   * is indistinguishable from two real charges.
   */
  supersedesProviderEntryId: string | null;
  raw: RawObservation;
}

/**
 * A provider withdrawing a record it previously reported.
 *
 * Modelled as a tombstone rather than a delete: the entry stays, marked, so a
 * number produced yesterday can still be explained today.
 */
export interface NormalizedRetraction {
  providerEntryId: string;
  observedAt: string;
}

/** One page of observations from a provider, plus the sync state it leaves behind. */
export interface SourceSyncPage {
  accounts?: NormalizedAccount[];
  balances?: NormalizedBalanceObservation[];
  entries?: NormalizedEntry[];
  retractions?: NormalizedRetraction[];
  /**
   * Provider-shaped bookkeeping to resume from, valid as of this page. Opaque
   * to everything but the adapter that produced it: Plaid stores a diff cursor,
   * Rho a time watermark, and the layer above never learns which.
   */
  syncStateAfter: Record<string, unknown>;
}

/** A connection as an adapter sees it. */
export interface SourceConnectionHandle {
  id: string;
  companyId: string;
  provider: SourceProviderId;
  providerConnectionId: string;
  credentials: Record<string, unknown>;
  syncState: Record<string, unknown>;
}

export interface SourcePullContext {
  connection: SourceConnectionHandle;
  /** Injected rather than read from the clock, so syncs are testable. */
  now: Date;
  signal?: AbortSignal;
}

/**
 * What a provider integration must implement.
 *
 * Deliberately one method. An adapter's whole job is to turn its provider's
 * transport, pagination, and vocabulary into pages of neutral observations; it
 * owns nothing about storage, scheduling, or what the numbers mean.
 *
 * Note the shape it does *not* have: no `added`/`modified`/`removed` triple.
 * That is Plaid's diff model, and forcing Rho - which has no diff endpoint - to
 * pretend it produces diffs was the trap. The neutral concept is an
 * *observation*, upserted by natural key, which describes Plaid's `added` and
 * `modified` and Rho's plain re-reads identically. Only retraction, which one
 * provider has and the other genuinely does not, stays a separate channel.
 */
export interface SourceProviderAdapter {
  readonly provider: SourceProviderId;
  pull(context: SourcePullContext): AsyncIterable<SourceSyncPage>;
}
