import { analyzeCashPeriod, compareCashPeriods, deriveFinancialActuals, type CashPeriodAnalysis, type FinancialActuals, type Period } from "./actuals";
import type { ReconciledFinancialState } from "./reconciliation";
import { minorToDecimalString } from "@/lib/source/money";
import { FinancialDataUnavailable, type FinancialSession } from "./session";

/** Presentation only: exact monetary formatting is done here, never delegated to Sam. */
const money = (minor: number | null, currency: string) => ({ minor, display: minor === null ? "unavailable" : `${currency} ${minorToDecimalString(minor, currency)}` });
const flow = (value: { inflowsMinor: number; outflowsMinor: number; netMinor: number } | null, currency: string) => value === null ? null : ({
  inflows: money(value.inflowsMinor, currency), outflows: money(value.outflowsMinor, currency), net: money(value.netMinor, currency),
});
type Position = FinancialActuals["currencies"][number]["cash"];
function qualification(value: Position | CashPeriodAnalysis) {
  const checks = value.freshness.connections.map(c => c.lastSuccessfulSyncAt).filter((x): x is string => x !== null).sort();
  return {
    currency: value.currency, evaluatedAt: value.evaluatedAt, accountCount: value.accountIds.length,
    scope: "eligible_linked_accounts_only_not_all_company_accounts", coverage: value.coverage,
    duplicateAccountRisk: value.duplicateAccountRisk,
    freshness: { staleAfterMs: value.freshness.staleAfterMs,
      connectionCount: value.freshness.connections.length,
      staleConnections: value.freshness.connections.filter(c => c.stale).length,
      failedOrRevokedConnections: value.freshness.connections.filter(c => c.status !== "active").length,
      neverSyncedConnections: value.freshness.connections.filter(c => c.lastSuccessfulSyncAt === null).length,
      oldestSuccessfulSyncAt: checks[0] ?? null, newestSuccessfulSyncAt: checks.at(-1) ?? null,
      accountsNotRecentlyObserved: value.freshness.accounts.filter(a => !Number.isFinite(Date.parse(a.lastObservedAt)) ||
        Date.parse(value.evaluatedAt) - Date.parse(a.lastObservedAt) > value.freshness.staleAfterMs).length },
    caveats: value.caveats, issues: value.issues,
  };
}
export function summarizePosition(value: Position) {
  return { status: value.status, nature: value.nature, method: value.method,
    value: money(value.valueMinor, value.currency), observedSubtotal: money(value.observedSubtotalMinor, value.currency),
    missingAccountCount: value.missingAccountIds.length, qualification: qualification(value),
    trace: { tool: "explain_financial_number", metric: value.method.startsWith("latest_current") ? "cash" : "credit_position", currency: value.currency } };
}
export function summarizeCashPeriod(value: CashPeriodAnalysis) {
  return { status: value.status, nature: value.nature, period: value.period, method: value.method,
    qualification: qualification(value),
    recordedCashMovement: flow(value.recordedCashMovement, value.currency),
    internalCashTransfers: flow(value.internalCashTransfers, value.currency),
    internalNonCashMovements: flow(value.internalNonCashMovements, value.currency),
    unresolvedRelationship: flow(value.unresolvedRelationship, value.currency),
    unresolvedGross: money(value.unresolvedGrossMinor, value.currency),
    externalCashMovement: { ...value.externalCashMovement, value: flow(value.externalCashMovement.value, value.currency) },
    cashConsumption: { status: value.cashConsumption.status, value: money(value.cashConsumption.valueMinor, value.currency),
      method: value.cashConsumption.method, caveats: value.cashConsumption.caveats },
    operatingBurn: { status: value.operatingBurn.status, grossMinor: value.operatingBurn.grossMinor, netMinor: value.operatingBurn.netMinor,
      method: value.operatingBurn.method, reasons: value.operatingBurn.reasons, unclassifiedCash: flow(value.operatingBurn.unclassifiedCash, value.currency) },
    exclusions: { pendingEntries: value.exclusions.pendingEntryIds.length, otherExcludedEntries: value.exclusions.excludedEntries.length },
    trace: { tool: "explain_financial_number", metric: "cash_movement", currency: value.currency, period: value.period },
  };
}
function currencyState(actuals: FinancialActuals, currency: string) {
  const state = actuals.currencies.find(c => c.currency === currency);
  if (!state) throw new Error("No observed eligible cash/credit scope for that currency. Do not treat missing scope as zero.");
  return state;
}
export function financialPosition(actuals: FinancialActuals, currency: string) {
  const state = currencyState(actuals, currency);
  return { companyId: actuals.companyId, evaluatedAt: actuals.evaluatedAt, currency,
    cash: summarizePosition(state.cash), creditPosition: summarizePosition(state.creditPosition) };
}
export function financialBurnRunway(actuals: FinancialActuals, currency: string) {
  const state = currencyState(actuals, currency);
  return { companyId: actuals.companyId, currency, evaluatedAt: actuals.evaluatedAt,
    qualification: qualification(state.cash), cash: money(state.cash.valueMinor, currency),
    period: state.comparison.current.period,
    operatingBurn: { status: state.comparison.current.operatingBurn.status, reasons: state.comparison.current.operatingBurn.reasons },
    burnTrend: state.comparison.operatingBurnTrend,
    monthlyRecordedCashConsumption: { ...state.monthlyCashConsumption,
      display: state.monthlyCashConsumption.value ? `${money(state.monthlyCashConsumption.value.numerator, currency).display} / ${state.monthlyCashConsumption.value.denominator} calendar months` : "unavailable" },
    cashConsumptionComparison: {
      current: money(state.comparison.current.cashConsumption.valueMinor, currency), prior: money(state.comparison.prior.cashConsumption.valueMinor, currency),
      delta: money(state.comparison.cashConsumption.deltaMinor, currency),
      currentPeriod: state.comparison.current.period, priorPeriod: state.comparison.prior.period,
      caveats: state.comparison.caveats,
    },
    unresolvedGross: { current: money(state.comparison.current.unresolvedGrossMinor, currency), prior: money(state.comparison.prior.unresolvedGrossMinor, currency) },
    runway: state.runway,
  };
}
export function financialComparison(reconciled: ReconciledFinancialState, currency: string, current: Period, prior: Period) {
  const result = compareCashPeriods(reconciled, currency, current, prior);
  return { companyId: reconciled.companyId, currency, method: result.method,
    current: summarizeCashPeriod(result.current), prior: summarizeCashPeriod(result.prior),
    cashConsumptionDelta: money(result.cashConsumption.deltaMinor, currency),
    netCashMovementDelta: money(result.netCashMovement.deltaMinor, currency),
    operatingBurnTrend: result.operatingBurnTrend, caveats: result.caveats };
}

/** A bounded company brief, never a ledger or raw provider content in the system prompt. */
export function financialSnapshot(actuals: FinancialActuals) {
  return { status: actuals.currencies.length ? "qualified" as const : "no_eligible_accounts" as const,
    evaluatedAt: actuals.evaluatedAt, coverage: actuals.health.coverage,
    sourceConnections: actuals.health.connections.length,
    unhealthyConnections: actuals.health.connections.filter(c => c.stale || c.status !== "active").length,
    duplicateAccountRisk: actuals.health.duplicateAccountRisk,
    currenciesOmitted: Math.max(0, actuals.currencies.length - 2),
    currencies: actuals.currencies.slice(0, 2).map(state => ({
      currency: state.currency,
      cash: { status: state.cash.status, value: money(state.cash.valueMinor, state.currency), accounts: state.cash.accountIds.length,
        missingBalances: state.cash.missingAccountIds.length, issues: state.cash.issues, freshness: qualification(state.cash).freshness },
      creditPosition: { status: state.creditPosition.status, value: money(state.creditPosition.valueMinor, state.currency), issues: state.creditPosition.issues },
      lastFullMonth: { period: state.lastFullMonth.period, status: state.lastFullMonth.status,
        recordedCashMovement: flow(state.lastFullMonth.recordedCashMovement, state.currency),
        unresolvedGross: money(state.lastFullMonth.unresolvedGrossMinor, state.currency),
        externalStatus: state.lastFullMonth.externalCashMovement.status, issues: state.lastFullMonth.issues },
      operatingBurn: { status: state.comparison.current.operatingBurn.status, reasons: state.comparison.current.operatingBurn.reasons },
      runway: { status: state.runway.status, months: state.runway.months, reasons: state.runway.reasons },
    })),
    caveats: ["observed_linked_accounts_not_complete_company_coverage", "recorded_cash_movement_not_operating_burn_or_balance_change",
      "balance_value_change_time_not_last_check", "no_fx_conversion", "no_future_commitments_modeled",
      "Rho_lifecycle_changes_outside_14_day_lookback_may_be_missing", "history_completeness_unknown", "source_currency_may_default_to_USD"],
    more: "Use financial_position for a currency, financial_cash_flow for completed-day periods, financial_burn_runway for burn/runway basis, compare_financial_periods for change, explain_financial_number for evidence.",
  };
}
export type FinancialSnapshot = ReturnType<typeof financialSnapshot> | { status: "unavailable"; reason: string };
export async function loadFinancialSnapshot(session: FinancialSession): Promise<FinancialSnapshot> {
  try { return financialSnapshot((await session.read()).actuals); }
  catch (error) { return { status: "unavailable", reason: error instanceof FinancialDataUnavailable ? error.code : "source_unavailable" }; }
}

export type FinancialTraceMetric = "cash" | "credit_position" | "cash_movement" | "cash_consumption";
/** Pagination applies only to evidence, never to totals. No arbitrary raw-record/company IDs. */
export function explainFinancialNumber(reconciled: ReconciledFinancialState, actuals: FinancialActuals, input: {
  currency: string; metric: FinancialTraceMetric; period?: Period; offset: number; limit: number;
}) {
  let basis: unknown;
  let evidence: unknown[];
  if (input.metric === "cash" || input.metric === "credit_position") {
    if (input.period) throw new Error("Position is a current observation, not a historical as-of query. Omit period.");
    const state = currencyState(actuals, input.currency);
    const value = input.metric === "cash" ? state.cash : state.creditPosition;
    basis = summarizePosition(value);
    evidence = value.accountIds.flatMap(accountId => {
      const scope = reconciled.accounts.find(a => a.source.id === accountId)!;
      const balances = value.evidence.filter(b => b.account_id === accountId);
      return [{ accountId, kind: scope.source.kind, provider: scope.source.provider,
        accountRawRecordId: scope.source.latest_raw_record_id,
        missing: value.missingAccountIds.includes(accountId),
        balances: balances.map(b => ({ balanceId: b.id, current: money(b.current_minor, b.currency), currency: b.currency,
          valueObservedAt: b.observed_at, rawRecordId: b.raw_record_id, syncId: b.sync_id })) }];
    });
  } else {
    if (!input.period) throw new Error("A completed-day period is required for cash-flow evidence.");
    const result = analyzeCashPeriod(reconciled, input.currency, input.period);
    basis = summarizeCashPeriod(result);
    const included = input.metric === "cash_consumption" ? new Set(result.cashConsumption.entryIds) : null;
    evidence = result.evidence.filter(e => !included || included.has(e.entryId)).map(e => ({ ...e,
      display: money(e.cashMinor, input.currency).display,
      reconciliation: result.reconciliationEvidence.find(r => r.activityId === e.activityId) }));
  }
  return { companyId: actuals.companyId, evaluatedAt: actuals.evaluatedAt, metric: input.metric, currency: input.currency,
    basis, evidence: evidence.slice(input.offset, input.offset + input.limit),
    pagination: { offset: input.offset, total: evidence.length,
      nextOffset: input.offset + input.limit < evidence.length ? input.offset + input.limit : null },
    caveat: "Evidence pages are partial; the basis totals cover the complete requested recorded population. Do not sum pages yourself." };
}
export { analyzeCashPeriod, deriveFinancialActuals };
