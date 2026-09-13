import { describe, expect, it } from "vitest";

import {
  operatingHeadline,
  projectOperatingState,
  type OperatingRecords,
} from "@/lib/company/operating";

/**
 * The company-plan projection.
 *
 * What is being defended here is access with honesty attached: the stored plan
 * reaches Sam, every field says where it came from, nothing absent is reported
 * as zero, and two things never travel - employee names, and a founder-entered
 * cash figure that would compete with the Numerical Model.
 */

const COMPANY = "company_operating_test";

const assumption = (key: string, value: unknown, source = "onboarding") => ({
  company_id: COMPANY,
  id: `assumption_${key}`,
  key,
  value: value as never,
  source,
  updated_at: "2026-09-01T09:00:00Z",
});

const CONNECTION = {
  company_id: COMPANY,
  id: "payroll_connection_1",
  status: "active",
  last_synced_at: "2026-09-12T08:00:00Z",
  updated_at: "2026-09-12T08:00:00Z",
};

const employee = (overrides: Partial<OperatingRecords["employees"][number]> = {}) => ({
  company_id: COMPANY,
  id: `employee_${Math.random().toString(36).slice(2, 8)}`,
  payroll_connection_id: CONNECTION.id,
  annual_salary_usd: 180000,
  hourly_rate_usd: null,
  payment_unit: "year",
  start_date: "2025-04-01",
  termination_date: null,
  employment_status: "active",
  updated_at: "2026-09-12T08:00:00Z",
  ...overrides,
});

const records = (overrides: Partial<OperatingRecords> = {}): OperatingRecords => ({
  companyId: COMPANY,
  assumptions: [
    assumption("minimum_runway_months", 12),
    assumption("monthly_growth_target_pct", 7),
    assumption("mrr_usd", 170000),
    assumption("monthly_expenses_usd", 210000),
    assumption("planned_hires", [
      { title: "Platform engineer", startDate: "2026-11-01", monthlyCostUsd: 17083.33 },
      { title: "Platform engineer", startDate: "2026-12-01", monthlyCostUsd: 17083.33 },
    ]),
    assumption("current_team", [
      { name: "Dana Reeve", title: "Founder", startDate: "2025-01-01", monthlyCostUsd: 12000 },
      { name: "Sam Okafor", title: "Engineer", startDate: "2025-06-01", monthlyCostUsd: 15000 },
    ]),
  ],
  employees: [employee(), employee({ annual_salary_usd: 150000 })],
  payrollConnections: [CONNECTION],
  payrollRuns: [
    {
      company_id: COMPANY,
      id: "run_1",
      check_date: "2026-08-15",
      pay_period_start: "2026-08-01",
      pay_period_end: "2026-08-15",
      total_gross_pay_usd: 52000,
      total_employer_cost_usd: 61500,
      processed: true,
    },
    {
      company_id: COMPANY,
      id: "run_2",
      check_date: "2026-08-31",
      pay_period_start: "2026-08-16",
      pay_period_end: "2026-08-31",
      total_gross_pay_usd: 52000,
      total_employer_cost_usd: 62000,
      processed: true,
    },
  ],
  ...overrides,
});

describe("projectOperatingState", () => {
  it("makes the runway floor and the planned hires reachable with provenance", () => {
    const state = projectOperatingState(COMPANY, records());

    expect(state.status).toBe("available");
    expect(state.plan.minimumRunwayMonths).toEqual({
      value: 12,
      provenance: {
        source: "onboarding",
        reference: "company_assumptions:minimum_runway_months",
        updatedAt: "2026-09-01T09:00:00Z",
      },
    });

    // The two figures "can we afford the planned hires?" actually needs.
    expect(state.plan.plannedHires).toMatchObject({
      count: 2,
      earliestStartDate: "2026-11-01",
      totalMonthlyCost: { display: "USD 34166.66" },
    });
    expect(state.plan.plannedHires?.hires[0]).toEqual({
      title: "Platform engineer",
      startDate: "2026-11-01",
      monthlyCost: { usd: 17083.33, display: "USD 17083.33" },
    });
  });

  it("never projects an employee's name", () => {
    const state = projectOperatingState(COMPANY, records());
    const serialized = JSON.stringify(state);

    expect(serialized).not.toContain("Dana Reeve");
    expect(serialized).not.toContain("Sam Okafor");
    // Roles do travel - they are what a hiring question is about.
    expect(state.plan.team?.roles).toEqual(["Founder", "Engineer"]);
    expect(state.plan.team?.headcount).toBe(2);
  });

  it("reports the payroll provider's observed employer cost, and only that", () => {
    const state = projectOperatingState(COMPANY, records());

    expect(state.payroll).toMatchObject({
      class: "source_evidence",
      connected: true,
      activeEmployeeCount: 2,
      // Latest *processed* run, by check date.
      lastProcessedRun: {
        checkDate: "2026-08-31",
        totalEmployerCost: { display: "USD 62000.00" },
      },
    });

    // A sum of stored base salaries, labelled as such - nothing here divides a
    // salary into a monthly burn or adds an assumed tax rate.
    expect(state.payroll.totalAnnualBaseSalary?.display).toBe("USD 330000.00");
    expect(state.caveats).toContain(
      "annual_base_salary_total_excludes_taxes_benefits_and_hourly_staff"
    );
  });

  it("excludes terminated and inactive employees from the roster", () => {
    const state = projectOperatingState(
      COMPANY,
      records({
        employees: [
          employee(),
          employee({ termination_date: "2026-07-01" }),
          employee({ employment_status: "terminated" }),
        ],
      })
    );

    expect(state.payroll.activeEmployeeCount).toBe(1);
  });

  it("counts hourly staff apart rather than guessing their annual cost", () => {
    const state = projectOperatingState(
      COMPANY,
      records({
        employees: [
          employee(),
          employee({ payment_unit: "hour", hourly_rate_usd: 85, annual_salary_usd: null }),
        ],
      })
    );

    expect(state.payroll.hourlyEmployeeCount).toBe(1);
    expect(state.payroll.totalAnnualBaseSalary?.display).toBe("USD 180000.00");
  });

  it("reports an unrecorded field as missing, never as zero", () => {
    const state = projectOperatingState(
      COMPANY,
      records({ assumptions: [assumption("minimum_runway_months", 12)] })
    );

    expect(state.plan.mrr).toBeNull();
    expect(state.plan.plannedHires).toBeNull();
    expect(state.missing).toEqual(
      expect.arrayContaining([
        { field: "mrr_usd", reason: "not_recorded" },
        { field: "planned_hires", reason: "not_recorded" },
      ])
    );
  });

  it("reports an unusable stored value as invalid rather than parsing around it", () => {
    const state = projectOperatingState(
      COMPANY,
      records({
        assumptions: [
          assumption("minimum_runway_months", "twelve"),
          assumption("planned_hires", [{ title: "Engineer", monthlyCostUsd: -5 }]),
        ],
      })
    );

    expect(state.plan.minimumRunwayMonths).toBeNull();
    expect(state.missing).toEqual(
      expect.arrayContaining([
        { field: "minimum_runway_months", reason: "invalid_stored_value" },
        { field: "planned_hires", reason: "invalid_stored_value" },
      ])
    );
  });

  it("says the payroll provider is absent instead of reporting zero headcount", () => {
    const state = projectOperatingState(
      COMPANY,
      records({ employees: [], payrollConnections: [], payrollRuns: [] })
    );

    expect(state.payroll.connected).toBe(false);
    expect(state.payroll.lastProcessedRun).toBeNull();
    expect(state.missing).toEqual(
      expect.arrayContaining([{ field: "payroll", reason: "no_payroll_connection" }])
    );
  });

  it("does not expose a founder-entered cash figure that would rival the Numerical Model", () => {
    const state = projectOperatingState(
      COMPANY,
      records({ assumptions: [assumption("cash_on_hand_usd", 1800000, "derived")] })
    );

    expect(JSON.stringify(state)).not.toContain("1800000");
    expect(state.caveats).toContain(
      "cash_is_established_only_by_the_numerical_model_never_by_this_plan"
    );
  });

  it("keeps the two epistemic classes inside it apart", () => {
    const state = projectOperatingState(COMPANY, records());

    expect(state.plan.class).toBe("management_context");
    expect(state.payroll.class).toBe("source_evidence");
  });

  it("is empty rather than available for a company with nothing on file", () => {
    const state = projectOperatingState(COMPANY, {
      companyId: COMPANY,
      assumptions: [],
      employees: [],
      payrollConnections: [],
      payrollRuns: [],
    });

    expect(state.status).toBe("empty");
  });

  it("refuses records from another company", () => {
    expect(() =>
      projectOperatingState("company_other", records())
    ).toThrow(/scope/i);
  });
});

describe("operatingHeadline", () => {
  it("carries the constraints and costs, and names what is missing", () => {
    const headline = operatingHeadline(projectOperatingState(COMPANY, records()));

    expect(headline).toMatchObject({
      status: "available",
      class: "management_context",
      runwayFloorMonths: 12,
      monthlyGrowthTargetPct: 7,
      plannedHires: {
        count: 2,
        totalMonthlyCost: "USD 34166.66",
        earliestStartDate: "2026-11-01",
      },
      team: { headcount: 2 },
      payroll: { connected: true, activeEmployeeCount: 2 },
    });

    // Display strings, not raw numbers for Sam to reformat.
    expect(headline).toMatchObject({ mrr: "USD 170000.00" });
    expect(headline).toHaveProperty("more");
  });

  it("lists missing fields so a partial plan cannot read as a complete one", () => {
    const headline = operatingHeadline(
      projectOperatingState(COMPANY, { ...records(), assumptions: [] })
    );

    expect(headline).toMatchObject({
      runwayFloorMonths: null,
      plannedHires: null,
      missingFields: expect.arrayContaining(["minimum_runway_months", "planned_hires"]),
    });
  });

  it("passes an unavailable plan through untouched", () => {
    expect(operatingHeadline({ status: "unavailable", reason: "not_configured" })).toEqual({
      status: "unavailable",
      reason: "not_configured",
    });
  });

  it("stays small enough to belong in every prompt", () => {
    const headline = operatingHeadline(projectOperatingState(COMPANY, records()));

    // Paid for on every run, so its size is a standing cost like the brief's.
    expect(JSON.stringify(headline).length).toBeLessThan(1000);
  });
});
