import { describe, expect, it } from "vitest";
import { toAccount, toEntry } from "@/lib/source/rho/map";
import type { RhoAccount, RhoTransaction } from "@/lib/source/rho/client";
import type { Json } from "@/lib/supabase/types";
import { reconcileFinancialActivity, type ReconciliationInput, type SourceAccount, type SourceEntry } from "./reconciliation";
import { analyzeCashPeriod, compareCashPeriods, deriveFinancialActuals, historicalWindows } from "./actuals";

const observedAt = "2026-09-13T12:00:00Z";
const period = { start: "2026-06-01", endExclusive: "2026-09-01" };
// Real provider mappers -> Tier 1 projection -> Phase 1 -> Phase 2, not preclassified activity mocks.
function account(id: string, kind: RhoAccount["account_type"] = "checking", currency = "USD"): SourceAccount {
  const a = toAccount({ id, account_type: kind, balance: { amount: 0, currency } }, observedAt);
  return { id, company_id: "company", connection_id: "connection", provider: "rho", kind: a.kind,
    provider_account_id: a.providerAccountId, currency: a.currency, name: a.name, mask: a.mask,
    provider_attributes: a.providerAttributes as Json, first_seen_at: observedAt, last_observed_at: observedAt,
    last_seen_sync_id: "sync", latest_raw_record_id: `raw-${id}` };
}
function entry(id: string, amount: number, accountId = "cash", date = "2026-06-15", patch: Partial<RhoTransaction> = {}): SourceEntry {
  const e = toEntry({ id, account_id: accountId, account_name: accountId, account_type: "checking", money_movement_id: id,
    amount: { amount, currency: "USD" }, status: "settled", transaction_type: "ach_debit", counterparty_name: "Counterparty",
    initiated_at: `${date}T12:00:00Z`, posted_at: `${date}T12:00:00Z`, ...patch }, observedAt);
  return { id, company_id: "company", connection_id: "connection", provider: "rho", account_id: e.providerAccountId,
    provider_entry_id: e.providerEntryId, movement_key: e.movementKey, amount_minor: e.amountMinor, currency: e.currency,
    status: e.status, posted_at: e.postedAt, initiated_at: e.initiatedAt, occurred_on: e.occurredOn,
    description: e.description, counterparty_name: e.counterpartyName, provider_attributes: e.providerAttributes as Json,
    provider_category: e.providerCategory as unknown as Json, supersedes_provider_entry_id: e.supersedesProviderEntryId,
    first_seen_at: observedAt, last_observed_at: observedAt, last_seen_sync_id: "sync", latest_raw_record_id: `raw-${id}`, withdrawn_at: null };
}
function input(entries: SourceEntry[] = []): ReconciliationInput {
  return { companyId: "company", accounts: [account("cash")], entries,
    balances: [{ id: "balance", company_id: "company", account_id: "cash", currency: "USD", current_minor: 100000,
      available_minor: 50000, observed_at: "2026-09-01T00:00:00Z", sync_id: "sync", raw_record_id: "balance-raw" }],
    connections: [{ id: "connection", company_id: "company", provider: "rho", status: "active", last_synced_at: observedAt, last_sync_error: null, updated_at: observedAt }],
    runs: [{ id: "sync", company_id: "company", connection_id: "connection", provider: "rho", status: "succeeded", started_at: observedAt, finished_at: observedAt, error: null }] };
}
const reconcile = (s: ReconciliationInput) => reconcileFinancialActivity(s, { now: new Date(observedAt), staleAfterMs: 86400000 });
const actuals = (s: ReconciliationInput) => deriveFinancialActuals(reconcile(s)).currencies[0];
const analyze = (s: ReconciliationInput) => analyzeCashPeriod(reconcile(s), "USD", period);

describe("deterministic financial actuals", () => {
  it("uses latest current, not available; carries value age separately from freshness", () => {
    const s = input(); s.balances.push({ ...s.balances[0], id: "older", current_minor: 200000, observed_at: "2026-08-01T00:00:00Z" });
    const cash = actuals(s).cash;
    expect(cash.valueMinor).toBe(100000);
    expect(cash.evidence[0]).toMatchObject({ id: "balance", raw_record_id: "balance-raw", observed_at: "2026-09-01T00:00:00Z" });
    expect(cash.freshness.connections[0]).toMatchObject({ stale: false, lastSuccessfulSyncAt: observedAt });
    expect(cash.coverage).toBe("unknown");
  });
  it("sums checking and savings by currency, excluding credit and investment", () => {
    const s = input(); s.accounts.push(account("savings", "savings"), account("credit", "credit"), account("investment", "investment"), account("eur", "checking", "EUR"));
    s.balances.push(...[{ id: "savings", current_minor: 20000 }, { id: "credit", current_minor: -6000 },
      { id: "investment", current_minor: 900000 }, { id: "eur", current_minor: 7000 }].map(b => ({ ...s.balances[0],
      ...b, account_id: b.id, currency: b.id === "eur" ? "EUR" : "USD" })));
    const states = deriveFinancialActuals(reconcile(s)).currencies;
    expect(states.map(c => [c.currency, c.cash.valueMinor])).toEqual([["EUR", 7000], ["USD", 120000]]);
    expect(states[1].creditPosition.valueMinor).toBe(-6000);
    expect(states[1].creditPosition.issues).toContain("rho_credit_balance_sign_unverified");
  });
  it("missing balance is unavailable, not zero or a silently partial cash total", () => {
    const s = input(); s.accounts.push(account("missing"));
    expect(actuals(s).cash).toMatchObject({ status: "unavailable", valueMinor: null, observedSubtotalMinor: 100000, missingAccountIds: ["missing"] });
    expect(actuals(s).runway.reasons).toContain("cash_position_unavailable");
  });
  it("preserves negative cash and zero credit without treating either as cash headroom", () => {
    const s = input(); s.balances[0].current_minor = -1;
    expect(actuals(s).cash.valueMinor).toBe(-1);
    expect(actuals(s).runway.reasons).toContain("negative_observed_cash");
  });
  it("chooses no arbitrary winner among conflicting same-instant balances", () => {
    const s = input(); s.balances.push({ ...s.balances[0], id: "conflict", current_minor: 100001 });
    expect(actuals(s).cash.valueMinor).toBeNull();
    expect(actuals(s).cash.issues).toContain("conflicting_latest_balances");
    s.balances[1].current_minor = 100000;
    expect(actuals(s).cash.valueMinor).toBe(100000);
    expect(actuals(s).cash.evidence).toHaveLength(2);
  });
  it("does not carry an older currency balance forward over a newer mismatch", () => {
    const s = input(); s.balances.push({ ...s.balances[0], id: "new", currency: "EUR", observed_at: "2026-09-12T00:00:00Z" });
    expect(actuals(s).cash.valueMinor).toBeNull();
    expect(actuals(s).cash.issues).toContain("latest_balance_currency_mismatch");
  });
  it("reported inflows may be financing, never revenue or operating cash by sign", () => {
    const state = analyze(input([entry("funding", 50000000), entry("debit", -10000)]));
    expect(state.recordedCashMovement).toMatchObject({ inflowsMinor: 50000000, outflowsMinor: 10000, netMinor: 49990000 });
    expect(state.externalCashMovement.value).toBeNull();
    expect(state.operatingBurn.netMinor).toBeNull();
    expect(state.unresolvedGrossMinor).toBe(50010000);
    expect(state.cashConsumption.valueMinor).toBe(10000);
  });
  it("unknown equal/opposite activity does not disappear through net cancellation", () => {
    const state = analyze(input([entry("a", 10000), entry("b", -10000)]));
    expect(state.recordedCashMovement?.netMinor).toBe(0);
    expect(state.unresolvedGrossMinor).toBe(20000);
    expect(state.externalCashMovement.status).toBe("unavailable");
  });
  it("removes proven cash transfers from consumption but preserves cross-boundary cash effects", () => {
    const s = input([entry("debit", -50000, "cash", "2026-08-31", { money_movement_id: "transfer" }),
      entry("credit", 50000, "savings", "2026-09-01", { money_movement_id: "transfer" })]);
    s.accounts.push(account("savings", "savings"));
    const state = analyze(s);
    expect(state.recordedCashMovement?.netMinor).toBe(-50000);
    expect(state.internalCashTransfers.netMinor).toBe(-50000);
    expect(state.cashConsumption.valueMinor).toBe(0);
    expect(state.externalCashMovement.value?.netMinor).toBe(0);
  });
  it("repayments reduce cash once, credit purchases never become a second cash debit", () => {
    const s = input([entry("repay-cash", -1750, "cash", "2026-06-15", { money_movement_id: "repay" }),
      entry("repay-credit", 1750, "credit", "2026-06-15", { money_movement_id: "repay" }), entry("purchase", -1750, "credit")]);
    s.accounts.push(account("credit", "credit"));
    const state = analyze(s);
    expect(state.recordedCashMovement?.netMinor).toBe(-1750);
    expect(state.internalNonCashMovements.outflowsMinor).toBe(1750);
    expect(state.cashConsumption.valueMinor).toBe(1750);
    expect(state.operatingBurn.unclassifiedCash.outflowsMinor).toBe(1750);
    expect(state.operatingBurn.netMinor).toBeNull();
  });
  it("excludes pending/failed/scheduled/withdrawn via Phase 1 and retains exclusion references", () => {
    const s = input([entry("posted", -100), entry("pending", -200, "cash", "2026-06-15", { status: "pending" }),
      entry("failed", -300, "cash", "2026-06-15", { status: "failed" }),
      entry("scheduled", -400, "cash", "2026-06-15", { status: "awaiting_approval" }), { ...entry("withdrawn", -500), withdrawn_at: observedAt }]);
    const state = analyze(s);
    expect(state.recordedCashMovement?.outflowsMinor).toBe(100);
    expect(state.exclusions.pendingEntryIds).toEqual(["pending"]);
    expect(state.exclusions.excludedEntries).toHaveLength(3);
    expect(state.evidence[0]).toMatchObject({ entryId: "posted", rawRecordId: "raw-posted", syncId: "sync", cashMinor: -100 });
  });
  it("uses half-open UTC day boundaries", () => {
    const s = input([entry("before", -100, "cash", "2026-05-31"), entry("first", -200, "cash", "2026-06-01"),
      entry("last", -300, "cash", "2026-08-31"), entry("after", -400, "cash", "2026-09-01")]);
    expect(analyze(s).recordedCashMovement?.outflowsMinor).toBe(500);
  });
  it("uses exact monthly fractions and compares equivalent trailing calendar windows", () => {
    const s = input([entry("current", -100, "cash", "2026-06-01"), entry("prior", -50, "cash", "2026-03-01")]);
    const state = actuals(s);
    expect(state.monthlyCashConsumption.value).toEqual({ numerator: 100, denominator: 3 });
    expect(state.comparison.cashConsumption).toEqual({ deltaMinor: 50, relativeChange: { numerator: 50, denominator: 50 } });
    expect(state.comparison.caveats).toContain("unresolved_activity_differs_between_windows");
    expect(state.runway.months).toBeNull();
  });
  it("zero prior baseline has no infinite percentage; no rows is not evidence of no burn", () => {
    const state = actuals(input());
    expect(state.comparison.cashConsumption.relativeChange).toBeNull();
    expect(state.monthlyCashConsumption.value).toEqual({ numerator: 0, denominator: 3 });
    expect(state.runway.status).toBe("unavailable");
    expect(state.comparison.current.operatingBurn.netMinor).toBeNull();
  });
  it("freshness, failures and duplicate coverage propagate without pretending stale values are current", () => {
    const s = input([entry("debit", -10)]); s.connections[0].last_synced_at = "2026-08-01T00:00:00Z";
    s.connections[0].status = "error"; s.runs[0].status = "failed";
    s.connections.push({ ...s.connections[0], id: "other" });
    const state = actuals(s);
    expect(state.cash.valueMinor).toBe(100000);
    expect(state.cash.caveats).toContain("source_stale_or_failed");
    expect(state.runway.reasons).toContain("possible_duplicate_account_coverage");
    expect(state.comparison.current.issues).toContain("source_observation_not_from_successful_sync");
  });
  it("integrity conflicts withhold economic totals but retain audit row subtotals", () => {
    const s = input([entry("bad-currency", -100, "cash", "2026-06-15", { amount: { amount: -100, currency: "EUR" } })]);
    const result = analyzeCashPeriod(reconcile(s), "EUR", period);
    expect(result.status).toBe("unavailable");
    expect(result.recordedCashMovement).toBeNull();
    expect(result.recordedRowSubtotal.outflowsMinor).toBe(100);
  });
  it("does not equate net recorded movement with balance-to-balance cash change", () => {
    const s = input([entry("debit", -100)]);
    s.balances.push({ ...s.balances[0], id: "old", current_minor: 90000, observed_at: "2026-06-01T00:00:00Z" });
    const state = actuals(s);
    expect(state.cash.valueMinor).toBe(100000);
    expect(state.comparison.current.recordedCashMovement?.netMinor).toBe(-100);
  });
  it("no accounts means no financial result, not zero company cash", () => {
    const s = input(); s.accounts = []; s.balances = [];
    expect(deriveFinancialActuals(reconcile(s)).currencies).toEqual([]);
    expect(analyze(s).status).toBe("unavailable");
  });
  it("rejects unsafe sums in positions and cash-flow aggregations", () => {
    const s = input(); s.accounts.push(account("savings", "savings")); s.balances[0].current_minor = Number.MAX_SAFE_INTEGER;
    s.balances.push({ ...s.balances[0], id: "savings", account_id: "savings", current_minor: 1 });
    expect(() => actuals(s)).toThrow("Unsafe monetary");
    expect(() => analyze(input([entry("a", Number.MAX_SAFE_INTEGER), entry("b", 1)]))).toThrow("Unsafe monetary");
  });
  it("calendar windows handle leap years and year rollover", () => {
    expect(historicalWindows("2024-03-01T00:00:00Z", 1).lastFullMonth).toEqual({ start: "2024-02-01", endExclusive: "2024-03-01" });
    expect(historicalWindows("2026-01-15T00:00:00Z").trailing).toEqual({ start: "2025-10-01", endExclusive: "2026-01-01" });
  });
  it("rejects invalid, partial-current-day and reversed requests", () => {
    for (const p of [{ start: "2026-02-30", endExclusive: "2026-03-01" },
      { start: "2026-09-01", endExclusive: "2026-09-14" }, { start: "2026-08-01", endExclusive: "2026-08-01" }])
      expect(() => analyzeCashPeriod(reconcile(input()), "USD", p)).toThrow();
    expect(() => historicalWindows(observedAt, 0)).toThrow();
  });
  it("arbitrary comparisons expose both windows and do not imply equal rates", () => {
    const s = input([entry("debit", -100)]);
    const result = compareCashPeriods(reconcile(s), "USD", period, { start: "2026-05-01", endExclusive: "2026-06-01" });
    expect(result.cashConsumption.deltaMinor).toBe(100);
    expect(result.caveats).toContain("arbitrary_period_lengths_may_differ_no_rate_normalization");
  });
  it("derivation is repeatable, JSON safe and never mutates Phase 1", () => {
    const state = reconcile(input([entry("one", -101)])); const before = JSON.stringify(state);
    expect(deriveFinancialActuals(state)).toEqual(deriveFinancialActuals(state));
    expect(JSON.stringify(state)).toBe(before);
    expect(() => JSON.stringify(deriveFinancialActuals(state))).not.toThrow();
  });
});
