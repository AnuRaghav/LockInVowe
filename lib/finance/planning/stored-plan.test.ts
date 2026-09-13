import { describe, expect, it } from "vitest";
import { deriveFinancialActuals } from "../actuals";
import { financialSourceFixture, reconcileFixture } from "../testing";
import { buildStoredCompanyPlan } from "./stored-plan";
import type { StoredPlanningRecords } from "./stored-source";

const actuals = (companyId: string) => deriveFinancialActuals(reconcileFixture(financialSourceFixture(companyId)));
const records = (companyId: string, overrides: Partial<StoredPlanningRecords> = {}): StoredPlanningRecords => ({
  companyId,
  assumptions: [
    { id: "mrr", company_id: companyId, key: "mrr_usd", value: 20_000, source: "onboarding", updated_at: "2026-09-13T12:00:00Z" },
    { id: "expenses", company_id: companyId, key: "monthly_expenses_usd", value: 70_000, source: "onboarding", updated_at: "2026-09-13T12:00:00Z" },
    { id: "hires", company_id: companyId, key: "planned_hires", value: [], source: "onboarding", updated_at: "2026-09-13T12:00:00Z" },
    { id: "team", company_id: companyId, key: "current_team", value: [], source: "onboarding", updated_at: "2026-09-13T12:00:00Z" },
    { id: "runway", company_id: companyId, key: "minimum_runway_months", value: 12, source: "onboarding", updated_at: "2026-09-13T12:00:00Z" },
    { id: "payroll", company_id: companyId, key: "monthly_payroll_cost_usd", value: 15_000, source: "derived", updated_at: "2026-09-13T12:00:00Z" },
  ],
  employees: [], payrollConnections: [], ...overrides,
});
const complete = { months: 3, assumptions: {
  label: "Demo operating plan", useStoredRevenueProxy: true,
  revenue: { newMrrMinor: 0, newSalesGrowthBps: 0, churnBps: 0, contractionBps: 0, expansionBps: 0 },
  collectionRateBps: 10_000, collectionLagMonths: 0, openingReceivableCollectionsMinor: [0, 0, 0],
  costOfRevenueBps: 0, expenseScope: "excludes_payroll_and_cogs" as const, oneTimeCosts: [], raises: [],
} };

describe("stored company planning adapter", () => {
  it("loads one company's assumptions and compiles them with observed source cash", () => {
    const result = buildStoredCompanyPlan("company-a", actuals("company-a"), records("company-a"), complete);
    expect(result.status).toBe("conditional");
    expect(result.plan?.currency).toBe("USD");
    expect(result.plan?.revenue.startingMrrMinor).toBe(2_000_000);
    expect(result.forecast?.cash.startingPosition.valueMinor).toBe(876_138);
    expect(result.missing).toEqual([]);
    expect(result.inputs.startingMrrMinor?.reference).toBe("company_assumptions:mrr");
  });

  it("returns explicit missing fields when Supabase has only the onboarding subset", () => {
    const result = buildStoredCompanyPlan("company-a", actuals("company-a"), records("company-a"), {});
    expect(result.status).toBe("needs_inputs");
    expect(result.plan).toBeNull();
    expect(result.missing.map(item => item.field)).toEqual(expect.arrayContaining([
      "assumptions.revenue", "assumptions.collectionRateBps", "assumptions.expenseScope",
    ]));
  });

  it("rejects cross-company actuals and stored rows", () => {
    expect(() => buildStoredCompanyPlan("company-b", actuals("company-a"), records("company-b"), complete)).toThrow("Actuals scope mismatch");
    expect(() => buildStoredCompanyPlan("company-a", actuals("company-a"), records("company-a", {
      assumptions: [{ ...records("company-a").assumptions[0], company_id: "company-b" }],
    }), complete)).toThrow("Planning data scope mismatch");
  });

  it("never replaces missing observed cash with the saved cash assumption", () => {
    const source = financialSourceFixture("company-a"); source.balances = [];
    const result = buildStoredCompanyPlan("company-a", deriveFinancialActuals(reconcileFixture(source)), records("company-a", {
      assumptions: [...records("company-a").assumptions, { id: "cash", company_id: "company-a", key: "cash_on_hand_usd", value: 999_999, source: "onboarding", updated_at: "2026-09-13T12:00:00Z" }],
    }), complete);
    expect(result.status).toBe("needs_inputs");
    expect(result.missing).toContainEqual({ field: "cash", reason: "observed_usd_cash_unavailable_saved_cash_cannot_replace_it" });
  });

  it("requires explicit acceptance before using a derived Stripe MRR proxy", () => {
    const derived = records("company-a", { assumptions: records("company-a").assumptions.map(row => row.key === "mrr_usd" ? { ...row, source: "derived" } : row) });
    const withoutProxyAcceptance = { ...complete, assumptions: { ...complete.assumptions, useStoredRevenueProxy: undefined } };
    expect(buildStoredCompanyPlan("company-a", actuals("company-a"), derived, withoutProxyAcceptance).missing).toContainEqual({
      field: "assumptions.useStoredRevenueProxy", reason: "explicit_acceptance_required_for_revenue_proxy",
    });
  });
});
