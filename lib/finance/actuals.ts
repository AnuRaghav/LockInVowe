import type { ActivityEffect, FinancialActivity, ReconciledFinancialState, SourceBalance } from "./reconciliation";

export interface Period { start: string; endExclusive: string }
export interface ExactRatio { numerator: number; denominator: number }
export interface CashFlows { inflowsMinor: number; outflowsMinor: number; netMinor: number }
type Status = "qualified" | "unavailable";
const unique = (values: string[]) => [...new Set(values)].sort();
function exact(value: number) {
  if (!Number.isSafeInteger(value)) throw new Error("Unsafe monetary value or aggregate");
  return value === 0 ? 0 : value;
}
function sum(values: number[]) {
  return exact(Number(values.reduce((total, value) => total + BigInt(exact(value)), BigInt(0))));
}
function day(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString().slice(0, 10) !== value) throw new Error("Invalid UTC date");
  return value;
}
function monthStart(date: Date, offset: number) {
  const d = new Date(date); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + offset);
  return d.toISOString().slice(0, 10);
}
/** Full calendar months only; never annualizes a partial month or uses 30-day months. */
export function historicalWindows(evaluatedAt: string, months = 3) {
  if (!Number.isSafeInteger(months) || months < 1 || months > 120) throw new Error("Invalid month window");
  const date = new Date(evaluatedAt);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid evaluation time");
  return {
    lastFullMonth: { start: monthStart(date, -1), endExclusive: monthStart(date, 0) },
    trailing: { start: monthStart(date, -months), endExclusive: monthStart(date, 0) },
    prior: { start: monthStart(date, -2 * months), endExclusive: monthStart(date, -months) },
    months,
  };
}
const within = (date: string, period: Period) => date >= period.start && date < period.endExclusive;

/** Shared qualification is part of every result bundle, not optional UI decoration. */
function context(state: ReconciledFinancialState, currency: string, accountIds: string[]) {
  const accounts = state.accounts.filter(a => accountIds.includes(a.source.id));
  const connectionIds = unique(accounts.map(a => a.source.connection_id));
  const connections = state.health.connections.filter(c => connectionIds.includes(c.id));
  return {
    currency, evaluatedAt: state.evaluatedAt, accountIds: unique(accountIds),
    coverage: state.health.coverage, duplicateAccountRisk: state.health.duplicateAccountRisk,
    freshness: { staleAfterMs: state.health.staleAfterMs,
      connections: connections.map(c => ({ id: c.id, lastSuccessfulSyncAt: c.last_synced_at,
        status: c.status, stale: c.stale, lastSyncError: c.last_sync_error,
        runs: c.runs, caveats: c.caveats })),
      accounts: accounts.map(a => ({ accountId: a.source.id, lastObservedAt: a.source.last_observed_at,
        syncId: a.source.last_seen_sync_id, rawRecordId: a.source.latest_raw_record_id,
        firstObservedActivityOn: a.firstObservedActivityOn, historyCompleteness: a.historyCompleteness })),
    },
    caveats: unique([...state.health.caveats, ...accounts.flatMap(a => a.caveats),
      ...connections.flatMap(c => c.caveats),
      ...connections.filter(c => c.stale || c.status !== "active").map(() => "source_stale_or_failed"),
      ...(state.health.duplicateAccountRisk === "possible_multiple_connections" ? ["possible_duplicate_account_coverage"] : [])]),
  };
}

function position(state: ReconciledFinancialState, currency: string, kind: "cash" | "credit") {
  const accounts = state.accounts.filter(a => a.source.currency === currency &&
    (kind === "cash" ? a.eligibleCash : a.source.kind === "credit"));
  const evidence: SourceBalance[] = [];
  const missingAccountIds: string[] = [];
  const issues: string[] = [];
  for (const account of accounts) {
    // A balance observation is when a value changed; never require today's row.
    const balances = [...account.balances].filter(b => Date.parse(b.observed_at) <= Date.parse(state.evaluatedAt))
      .sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at) || a.id.localeCompare(b.id));
    const latest = balances[0];
    if (!latest || latest.currency !== currency) {
      missingAccountIds.push(account.source.id);
      issues.push(latest ? "latest_balance_currency_mismatch" : "balance_missing");
      continue;
    }
    const tied = balances.filter(b => Date.parse(b.observed_at) === Date.parse(latest.observed_at));
    if (tied.some(b => b.current_minor !== latest.current_minor || b.currency !== latest.currency || b.available_minor !== latest.available_minor)) {
      missingAccountIds.push(account.source.id); issues.push("conflicting_latest_balances"); continue;
    }
    evidence.push(...tied);
  }
  // Identical tied observations count once, but all evidence survives.
  const selected = [...new Map(evidence.map(b => [b.account_id, b])).values()];
  const subtotal = sum(selected.map(b => b.current_minor));
  const unavailable = !accounts.length || missingAccountIds.length > 0;
  return {
    ...context(state, currency, accounts.map(a => a.source.id)),
    status: (unavailable ? "unavailable" : "qualified") as Status,
    nature: "observed" as const,
    method: kind === "cash" ? "latest_current_balances_of_eligible_cash_accounts" : "latest_signed_credit_positions_not_cash",
    valueMinor: unavailable ? null : subtotal,
    observedSubtotalMinor: selected.length ? subtotal : null,
    missingAccountIds: unique(missingAccountIds),
    issues: unique([...issues, ...(!accounts.length ? ["no_eligible_accounts"] : []),
      ...(kind === "credit" && accounts.some(a => a.source.provider === "rho") ? ["rho_credit_balance_sign_unverified"] : []),
      ...(selected.some(b => !b.raw_record_id) ? ["balance_provenance_missing"] : [])]),
    // Mixed observation/check times are explicit; evaluatedAt is NOT a common balance instant.
    evidence: evidence.map(b => ({ ...b })),
  };
}

function flows(effects: ActivityEffect[]): CashFlows {
  return { inflowsMinor: sum(effects.filter(e => e.cashMinor > 0).map(e => e.cashMinor)),
    outflowsMinor: sum(effects.filter(e => e.cashMinor < 0).map(e => -e.cashMinor)),
    netMinor: sum(effects.map(e => e.cashMinor)) };
}
interface Selected { activity: FinancialActivity; effect: ActivityEffect }
function bucket(rows: Selected[]) {
  return { ...flows(rows.map(r => r.effect)), entryIds: unique(rows.map(r => r.effect.source.id)),
    activityIds: unique(rows.map(r => r.activity.id)) };
}

/** Requested periods are half-open UTC days ending no later than today (completed days).
 * Totals describe recorded reconciled activity, NOT balance-to-balance cash change.
 */
export function analyzeCashPeriod(state: ReconciledFinancialState, currency: string, period: Period) {
  day(period.start); day(period.endExclusive);
  if (period.start >= period.endExclusive || period.endExclusive > state.evaluatedAt.slice(0, 10))
    throw new Error("Period must contain completed UTC days");
  const accountIds = state.accounts.filter(a => a.eligibleCash && a.source.currency === currency).map(a => a.source.id);
  const selected = state.activities.filter(a => a.currency === currency).flatMap(activity => activity.effects
    .filter(effect => effect.cashMinor !== 0 && within(effect.occurredOn, period))
    .map(effect => ({ activity, effect })));
  const internalTransfers = selected.filter(r => r.activity.kind === "cash_transfer");
  const internalOther = selected.filter(r => r.activity.relationship === "internal" && r.activity.kind !== "cash_transfer");
  const unresolved = selected.filter(r => r.activity.relationship === "unresolved");
  const consumption = selected.filter(r => r.activity.kind !== "cash_transfer");
  const problems = unique(selected.flatMap(r => r.activity.unresolved));
  const integrityBlocked = problems.some(p => ["conflicting_supersession", "account_currency_mismatch", "cross_currency_group"].includes(p));
  const unavailable = !accountIds.length || integrityBlocked;
  const unresolvedFlows = bucket(unresolved);
  const noExternalProof = unresolved.length > 0;
  const recorded = bucket(selected);
  return {
    ...context(state, currency, unique([...accountIds, ...selected.map(r => r.effect.accountId)])),
    status: (unavailable ? "unavailable" : "qualified") as Status,
    nature: "derived" as const, period: { ...period },
    method: "sum_reconciled_cash_effects_by_leg_date",
    recordedCashMovement: unavailable ? null : { ...recorded },
    // Audit subtotal is not a trustworthy economic total when integrity is blocked.
    recordedRowSubtotal: recorded,
    internalCashTransfers: bucket(internalTransfers),
    internalNonCashMovements: bucket(internalOther),
    unresolvedRelationship: unresolvedFlows,
    unresolvedGrossMinor: sum([unresolvedFlows.inflowsMinor, unresolvedFlows.outflowsMinor]),
    externalCashMovement: { status: (unavailable || noExternalProof ? "unavailable" : "qualified") as Status,
      value: unavailable || noExternalProof ? null : { inflowsMinor: 0, outflowsMinor: 0, netMinor: 0 },
      method: "only_deterministically_external_cash_effects",
      reasons: unique([...(noExternalProof ? ["external_relationships_unresolved"] : []),
        ...(unavailable ? ["cash_scope_or_integrity_unavailable"] : [])]),
      caveat: "zero_only_describes_recorded_population_not_complete_period_history" },
    cashConsumption: {
      status: (unavailable ? "unavailable" : "qualified") as Status,
      valueMinor: unavailable ? null : flows(consumption.map(r => r.effect)).outflowsMinor,
      method: "recorded_cash_debits_excluding_proven_cash_to_cash_transfers",
      entryIds: unique(consumption.filter(r => r.effect.cashMinor < 0).map(r => r.effect.source.id)),
      caveats: ["not_external_consumption_or_operating_burn", "includes_credit_repayments", "may_include_unproven_transfers_and_non_operating_activity"],
    },
    operatingBurn: {
      status: "unavailable" as const, grossMinor: null, netMinor: null,
      method: "operating_cash_outflows_minus_operating_cash_inflows",
      identifiedOperatingInflowsMinor: 0, identifiedOperatingOutflowsMinor: 0,
      // Spend=0 on a repayment does NOT establish the operating nature of its cash flow.
      unclassifiedCash: bucket(consumption),
      reasons: ["phase1_has_no_operating_classification_evidence", "history_completeness_unknown"],
    },
    issues: unique([...problems, ...(!accountIds.length ? ["no_eligible_cash_accounts"] : []),
      ...(integrityBlocked ? ["financial_activity_integrity_unresolved"] : [])]),
    exclusions: { pendingEntryIds: state.pending.filter(e => e.currency === currency && accountIds.includes(e.account_id) && within(e.occurred_on, period)).map(e => e.id).sort(),
      excludedEntries: state.excluded.filter(e => e.source.currency === currency && accountIds.includes(e.source.account_id) && within(e.source.occurred_on, period))
        .map(e => ({ entryId: e.source.id, reason: e.reason, rawRecordId: e.source.latest_raw_record_id, syncId: e.source.last_seen_sync_id })) },
    // Include all grouping legs, even non-cash or outside-period legs that prove an exclusion.
    reconciliationEvidence: [...new Map(selected.map(r => [r.activity.id, r.activity])).values()].map(activity => ({
      activityId: activity.id, rule: activity.evidence, kind: activity.kind, relationship: activity.relationship,
      legs: activity.effects.map(e => ({ entryId: e.source.id, accountId: e.accountId, currency: activity.currency,
        amountMinor: e.amountMinor, occurredOn: e.occurredOn, rawRecordId: e.source.latest_raw_record_id,
        syncId: e.source.last_seen_sync_id })),
    })),
    evidence: selected.map(({ activity, effect }) => ({ activityId: activity.id, entryId: effect.source.id,
      accountId: effect.accountId, occurredOn: effect.occurredOn, cashMinor: effect.cashMinor,
      rawRecordId: effect.source.latest_raw_record_id, syncId: effect.source.last_seen_sync_id,
      lastObservedAt: effect.source.last_observed_at, provider: effect.source.provider,
      providerEntryId: effect.source.provider_entry_id, relationship: activity.relationship, kind: activity.kind })),
  };
}
export type CashPeriodAnalysis = ReturnType<typeof analyzeCashPeriod>;

/** Compare totals, not differently-sized monthly rates. Each basis retains its period/scope. */
export function compareCashPeriods(state: ReconciledFinancialState, currency: string, currentPeriod: Period, priorPeriod: Period) {
  const current = analyzeCashPeriod(state, currency, currentPeriod);
  const prior = analyzeCashPeriod(state, currency, priorPeriod);
  function delta(a: number | null, b: number | null) {
    if (a === null || b === null) return { deltaMinor: null, relativeChange: null };
    const difference = sum([a, -b]);
    return { deltaMinor: difference,
      relativeChange: b === 0 ? null : { numerator: difference, denominator: Math.abs(b) } as ExactRatio };
  }
  return { currency, nature: "derived" as const, method: "current_recorded_total_minus_prior_recorded_total",
    current, prior,
    cashConsumption: delta(current.cashConsumption.valueMinor, prior.cashConsumption.valueMinor),
    netCashMovement: delta(current.recordedCashMovement?.netMinor ?? null, prior.recordedCashMovement?.netMinor ?? null),
    operatingBurnTrend: { status: "unavailable" as const, deltaMinor: null, relativeChange: null,
      reasons: ["comparable_operating_burn_unavailable"] },
    caveats: ["comparison_of_recorded_totals_not_operating_burn", "history_completeness_unknown",
      "relative_change_uses_absolute_prior_total_zero_baseline_unavailable",
      "arbitrary_period_lengths_may_differ_no_rate_normalization",
      ...(current.unresolvedGrossMinor !== prior.unresolvedGrossMinor ? ["unresolved_activity_differs_between_windows"] : [])],
  };
}

/** On-demand deterministic derivation, no cache/materialized financial facts or LLM inputs. */
export function deriveFinancialActuals(state: ReconciledFinancialState, options: { trailingMonths?: number } = {}) {
  const windows = historicalWindows(state.evaluatedAt, options.trailingMonths);
  const currencies = unique([...state.accounts.filter(a => a.eligibleCash || a.source.kind === "credit").map(a => a.source.currency),
    ...state.activities.filter(a => a.effects.some(e => e.cashMinor !== 0)).map(a => a.currency)]);
  return {
    version: "phase2-v1" as const, sourceVersion: state.version, companyId: state.companyId,
    evaluatedAt: state.evaluatedAt, windows,
    health: state.health,
    currencies: currencies.map(currency => {
      const cash = position(state, currency, "cash");
      const creditPosition = position(state, currency, "credit");
      const comparison = compareCashPeriods(state, currency, windows.trailing, windows.prior);
      const consumption = comparison.current.cashConsumption.valueMinor;
      const monthlyCashConsumption: ExactRatio | null = consumption === null ? null : { numerator: consumption, denominator: windows.months };
      return { currency, cash, creditPosition,
        lastFullMonth: analyzeCashPeriod(state, currency, windows.lastFullMonth),
        comparison, monthlyCashConsumption: {
          status: consumption === null ? "unavailable" as const : "qualified" as const,
          value: monthlyCashConsumption, unit: "minor_units_per_calendar_month",
          method: "trailing_recorded_cash_consumption_divided_by_full_calendar_months",
          basis: "comparison.current.cashConsumption", period: windows.trailing,
          caveats: ["not_operating_burn", "history_completeness_unknown_no_activity_does_not_prove_zero_consumption"],
        },
        runway: {
          status: "unavailable" as const, months: null, nature: "projected" as const,
          method: "eligible_observed_cash_divided_by_defensible_trailing_monthly_net_operating_burn",
          cashMinor: cash.valueMinor, burnMinorPerMonth: null, burnWindow: windows.trailing,
          accountIds: cash.accountIds, coverage: cash.coverage,
          reasons: unique(["operating_burn_unavailable", "history_completeness_unknown",
            ...(cash.valueMinor === null ? ["cash_position_unavailable"] : []),
            ...(cash.valueMinor !== null && cash.valueMinor < 0 ? ["negative_observed_cash"] : []),
            ...cash.freshness.connections.filter(c => c.stale || c.status !== "active").map(() => "source_stale_or_failed"),
            ...(state.health.duplicateAccountRisk === "possible_multiple_connections" ? ["possible_duplicate_account_coverage"] : [])]),
          basis: { cash: "cash", burn: "comparison.current.operatingBurn" },
          assumptions: ["historical_burn_continues", "no_future_commitments_plans_fundraising_or_operational_changes_modeled"],
          exclusions: ["credit_balances_not_subtracted_from_cash", "no_fx_conversion", "no_normalization_adjustments"],
        },
      };
    }),
  };
}
export type FinancialActuals = ReturnType<typeof deriveFinancialActuals>;
