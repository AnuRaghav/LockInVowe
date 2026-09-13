import { deriveFinancialActuals } from "../actuals";
import { financialSourceFixture, reconcileFixture } from "../testing";
import type { OperatingPlan } from "./forecast";

export const basis = { kind: "management_assumption" as const, label: "Founder-approved monthly demo plan" };
export function actuals(cashMinor: number | null = 1_000_000) {
  const source = financialSourceFixture();
  source.entries = [];
  if (cashMinor === null) source.balances = [];
  else source.balances.find(item => item.account_id === "cash")!.current_minor = cashMinor;
  return deriveFinancialActuals(reconcileFixture(source));
}
export function plan(overrides: Partial<OperatingPlan> = {}): OperatingPlan {
  const months = overrides.months ?? 6;
  return { currency: "USD", startDate: "2026-10-01", months, basis,
    revenue: { startingMrrMinor: 100_000, newMrrMinor: 0, newSalesGrowthBps: 0, churnBps: 0, contractionBps: 0, expansionBps: 0,
      collectionRateBps: 10_000, collectionLagMonths: 0, openingReceivableCollectionsMinor: Array(months).fill(0) },
    employees: [], expenses: [{ id: "marketing", category: "marketing", monthlyAmountMinor: 150_000, startDate: "2026-10-01" }],
    costOfRevenueBps: 0, oneTimeCosts: [], raises: [], ...overrides };
}

