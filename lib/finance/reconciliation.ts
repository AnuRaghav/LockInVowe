import type { Database } from "@/lib/supabase/types";

type Row<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export type SourceAccount = Row<"source_accounts">;
export type SourceEntry = Row<"source_entries">;
export type SourceBalance = Row<"source_balance_observations">;
export type SourceConnection = Pick<Row<"source_connections">,
  "id" | "company_id" | "provider" | "status" | "last_synced_at" | "last_sync_error" | "updated_at">;
export type SourceRun = Pick<Row<"source_sync_runs">,
  "id" | "company_id" | "connection_id" | "provider" | "status" | "started_at" | "finished_at" | "error">;

/** Complete current Tier 1 population, NOT a date-filtered query or historical snapshot. */
export interface ReconciliationInput {
  companyId: string;
  accounts: SourceAccount[];
  entries: SourceEntry[];
  balances: SourceBalance[];
  connections: SourceConnection[];
  runs: SourceRun[];
}

export interface ActivityEffect {
  source: SourceEntry;
  accountId: string;
  occurredOn: string;
  amountMinor: number;
  /** Signed change in eligible cash; never suppressed for a credit repayment. */
  cashMinor: number;
  /** Signed credit position change. Positive reduces debt; NOT positive liability incurred. */
  creditPositionMinor: number;
  /** Positive increases liability, negative reduces it, under Source's signed convention. */
  liabilityMinor: number;
}
export interface FinancialActivity {
  id: string;
  currency: string;
  relationship: "internal" | "unresolved";
  kind: "cash_transfer" | "credit_repayment" | "internal_other" | "unresolved";
  evidence: "rho_movement_key" | null;
  effects: ActivityEffect[];
  cashMinor: number;
  creditPositionMinor: number;
  liabilityMinor: number;
  /** Null is unknown, not zero. No accounting/operating meaning is inferred. */
  spendMinor: number | null;
  unresolved: string[];
}

export const isEligibleCashAccount = (account: SourceAccount): boolean =>
  account.kind === "checking" || account.kind === "savings";

function integer(value: number): number {
  if (!Number.isSafeInteger(value)) throw new Error("Unsafe monetary minor-unit value");
  return value;
}
function sum(values: number[]): number {
  // BigInt intermediate avoids order-dependent overflow/cancellation and rounding.
  const total = values.reduce((n, value) => n + BigInt(integer(value)), BigInt(0));
  return integer(Number(total));
}
const key = (...parts: string[]) => JSON.stringify(parts);
const sorted = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));

/** Pure, versioned financial-integrity boundary. Does not mutate or classify Source records. */
export function reconcileFinancialActivity(input: ReconciliationInput, options: {
  now: Date;
  /** Explicit caller policy, not an implicit claim about provider freshness. */
  staleAfterMs: number;
}) {
  if (!Number.isFinite(options.now.getTime()) || !Number.isFinite(options.staleAfterMs) || options.staleAfterMs < 0)
    throw new Error("Invalid freshness policy");
  for (const rows of [input.accounts, input.entries, input.balances, input.connections, input.runs]) {
    const ids = new Set<string>();
    for (const row of rows) {
      if (row.company_id !== input.companyId) throw new Error("Cross-company Source snapshot");
      if (ids.has(row.id)) throw new Error("Duplicate Source row");
      ids.add(row.id);
    }
  }
  const connections = new Map(input.connections.map(c => [c.id, c]));
  const accounts = new Map(input.accounts.map(a => [a.id, a]));
  const runs = new Map(input.runs.map(r => [r.id, r]));
  const naturalKeys = new Set<string>();
  for (const row of [...input.accounts, ...input.entries, ...input.runs]) {
    if (connections.get(row.connection_id)?.provider !== row.provider)
      throw new Error("Invalid Source connection reference");
  }
  for (const entry of input.entries) {
    const account = accounts.get(entry.account_id);
    if (!account || account.connection_id !== entry.connection_id) throw new Error("Invalid Source account reference");
    integer(entry.amount_minor);
    const id = key(entry.connection_id, entry.provider_entry_id);
    if (naturalKeys.has(id)) throw new Error("Duplicate Source entry identity");
    naturalKeys.add(id);
  }
  for (const balance of input.balances) {
    if (!accounts.has(balance.account_id)) throw new Error("Invalid balance account reference");
    integer(balance.current_minor);
    if (balance.available_minor !== null) integer(balance.available_minor);
  }

  // A posted replacement retires its pending predecessor even if the replacement
  // is later withdrawn. Retraction must not resurrect an obsolete pending charge.
  const superseded = new Map<string, string[]>();
  for (const entry of sorted(input.entries)) {
    if (entry.provider === "plaid" && entry.status === "posted" && entry.supersedes_provider_entry_id) {
      const id = key(entry.connection_id, entry.supersedes_provider_entry_id);
      superseded.set(id, [...(superseded.get(id) ?? []), entry.id]);
    }
  }
  const pending: SourceEntry[] = [];
  const excluded: { source: SourceEntry; reason: string; replacedBy: string[] }[] = [];
  const groups = new Map<string, SourceEntry[]>();
  for (const entry of sorted(input.entries)) {
    const replacedBy = superseded.get(key(entry.connection_id, entry.provider_entry_id)) ?? [];
    const reason = entry.withdrawn_at ? "withdrawn" : replacedBy.length && entry.status === "pending" ? "superseded" :
      entry.status === "failed" || entry.status === "scheduled" ? entry.status : null;
    if (reason) { excluded.push({ source: entry, reason, replacedBy }); continue; }
    if (entry.status === "pending") { pending.push(entry); continue; }
    const id = entry.provider === "rho" && entry.movement_key !== null
      ? key("rho", entry.connection_id, entry.movement_key)
      : key("entry", entry.id);
    groups.set(id, [...(groups.get(id) ?? []), entry]);
  }
  const activities: FinancialActivity[] = [];
  for (const [id, entries] of groups) {
    const currencies = [...new Set(entries.map(e => e.currency))].sort();
    const rhoGroup = entries[0].provider === "rho" && entries[0].movement_key !== null;
    const related = rhoGroup ? input.entries.filter(e => e.connection_id === entries[0].connection_id && e.movement_key === entries[0].movement_key) : entries;
    const completeLifecycle = related.every(e => e.status === "posted" && !e.withdrawn_at);
    for (const currency of currencies) {
      const legs = entries.filter(e => e.currency === currency);
      const mismatch = legs.some(e => accounts.get(e.account_id)!.currency !== currency);
      const internal = rhoGroup && completeLifecycle && currencies.length === 1 && !mismatch &&
        new Set(legs.map(e => e.account_id)).size > 1 && legs.some(e => e.amount_minor < 0) &&
        legs.some(e => e.amount_minor > 0) && sum(legs.map(e => e.amount_minor)) === 0;
      const effects = legs.map(source => {
        const account = accounts.get(source.account_id)!;
        const creditPositionMinor = account.kind === "credit" ? source.amount_minor : 0;
        return { source, accountId: account.id, occurredOn: source.occurred_on, amountMinor: source.amount_minor,
          cashMinor: isEligibleCashAccount(account) ? source.amount_minor : 0,
          creditPositionMinor, liabilityMinor: -creditPositionMinor };
      });
      const cashMinor = sum(effects.map(e => e.cashMinor));
      const creditPositionMinor = sum(effects.map(e => e.creditPositionMinor));
      const cashOnly = legs.every(e => isEligibleCashAccount(accounts.get(e.account_id)!));
      const repayment = internal && cashMinor < 0 && creditPositionMinor > 0 && legs.every(e => {
        const a = accounts.get(e.account_id)!;
        return (isEligibleCashAccount(a) && e.amount_minor < 0) || (a.kind === "credit" && e.amount_minor > 0);
      });
      const unresolved: string[] = [];
      if (legs.some(e => !e.latest_raw_record_id)) unresolved.push("source_provenance_missing");
      if (legs.some(e => !e.last_seen_sync_id || runs.get(e.last_seen_sync_id)?.status !== "succeeded"))
        unresolved.push("source_observation_not_from_successful_sync");
      if (!internal) unresolved.push("internal_or_external_unknown", "spend_and_operating_meaning_unknown");
      if (rhoGroup && !internal) unresolved.push("rho_group_incomplete_or_unbalanced");
      if (currencies.length > 1) unresolved.push("cross_currency_group");
      if (mismatch) unresolved.push("account_currency_mismatch");
      if (legs.some(e => !isEligibleCashAccount(accounts.get(e.account_id)!) && accounts.get(e.account_id)!.kind !== "credit"))
        unresolved.push("non_cash_account_semantics_unsupported");
      if (legs.some(e => (superseded.get(key(e.connection_id, e.supersedes_provider_entry_id ?? ""))?.length ?? 0) > 1))
        unresolved.push("conflicting_supersession");
      activities.push({ id: key(id, currency), currency, relationship: internal ? "internal" : "unresolved",
        kind: internal ? cashOnly ? "cash_transfer" : repayment ? "credit_repayment" : "internal_other" : "unresolved",
        evidence: rhoGroup ? "rho_movement_key" : null, effects, cashMinor, creditPositionMinor,
        liabilityMinor: -creditPositionMinor, spendMinor: internal ? 0 : null, unresolved });
    }
  }
  const accountScope = sorted(input.accounts).map(account => ({
    source: account,
    eligibleCash: isEligibleCashAccount(account),
    balances: sorted(input.balances.filter(b => b.account_id === account.id)),
    firstObservedActivityOn: input.entries.filter(e => e.account_id === account.id).map(e => e.occurred_on).sort()[0] ?? null,
    // No claim of continuous history or latest balance based on first-seen timestamps.
    historyCompleteness: "unknown" as const,
    caveats: [
      ...(account.provider === "rho" && account.kind === "credit" ? ["rho_credit_balance_sign_unverified"] : []),
      ...(!input.balances.some(b => b.account_id === account.id) ? ["balance_unavailable"] : []),
      ...(input.balances.some(b => b.account_id === account.id && b.currency !== account.currency) ? ["balance_account_currency_mismatch"] : []),
      ...(!account.latest_raw_record_id ? ["source_provenance_missing"] : []),
    ],
  }));
  return {
    version: "phase1-v1" as const,
    companyId: input.companyId,
    evaluatedAt: options.now.toISOString(),
    activities, pending, excluded, accounts: accountScope,
    health: {
      coverage: "unknown" as const,
      duplicateAccountRisk: input.connections.length > 1 ? "possible_multiple_connections" : "not_assessed",
      staleAfterMs: options.staleAfterMs,
      connections: sorted(input.connections).map(connection => ({
        ...connection,
        stale: !connection.last_synced_at || !Number.isFinite(Date.parse(connection.last_synced_at)) ||
          options.now.getTime() - Date.parse(connection.last_synced_at) > options.staleAfterMs,
        runs: sorted(input.runs.filter(r => r.connection_id === connection.id)),
        caveats: connection.provider === "rho" ? ["initial_history_180_days", "lifecycle_updates_outside_14_day_lookback_may_be_missing"] : [],
      })),
      caveats: ["linked_accounts_not_all_company_accounts", "history_continuity_unknown", "source_currency_normalization_may_default_to_usd",
        "balance_observed_at_is_value_change_not_last_check", "failed_sync_may_have_persisted_partial_observations"],
    },
  };
}
export type ReconciledFinancialState = ReturnType<typeof reconcileFinancialActivity>;
