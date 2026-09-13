import { describe, expect, it } from "vitest";
import { forecastHeadcountCost } from "./headcount";
import { forecastRevenue, type RevenuePlan } from "./revenue";
import { calculateSaasMetrics, type MonthlyMetricInputs } from "./metrics";
import { multiply, sum } from "./math";

const basis = { kind: "management_assumption" as const, label: "Founder planning inputs" };
const revenue = (overrides: Partial<RevenuePlan> = {}): RevenuePlan => ({
  startingMrrMinor: 100_000, newMrrMinor: 20_000, newSalesGrowthBps: 1000,
  churnBps: 1000, contractionBps: 500, expansionBps: 1000,
  collectionRateBps: 8000, collectionLagMonths: 1, openingReceivableCollectionsMinor: [40_000, 0], ...overrides,
});

describe("revenue drivers and collections", () => {
  it("rolls forward cohorts, compounds new sales, and keeps collections separate from revenue", () => {
    const result = forecastRevenue({ startDate: "2026-10-01", months: 2 }, revenue());
    expect(result.rows[0]).toMatchObject({ openingMrrMinor: 100_000, newMrrMinor: 20_000,
      churnedMrrMinor: 10_000, contractedMrrMinor: 5000, expansionMrrMinor: 8500,
      mrrMinor: 113_500, arrMinor: 1_362_000, collectionsMinor: 40_000,
      netRevenueRetention: 0.935, grossRevenueRetention: 0.85, mrrGrowthRate: 0.135 });
    expect(result.rows[1]).toMatchObject({ newMrrMinor: 22_000, mrrMinor: 128_123, collectionsMinor: 90_800 });
    expect(result.pendingCollectionsMinor).toBe(102_498);
    expect(sum(...result.rows.map(row => row.collectionsMinor), result.pendingCollectionsMinor))
      .toBe(sum(40_000, ...result.rows.map(row => row.revenueMinor - row.uncollectibleMinor)));
  });

  it("applies persistent driver overrides at the requested month", () => {
    const result = forecastRevenue({ startDate: "2026-10-01", months: 3 }, revenue({
      openingReceivableCollectionsMinor: [0, 0, 0], changes: [{ month: 1, drivers: { newMrrMinor: 10_000, newSalesGrowthBps: 0 } }],
    }));
    expect(result.rows.map(row => row.newMrrMinor)).toEqual([20_000, 10_000, 10_000]);
  });

  it("handles a zero customer base and explicitly zero collections", () => {
    const result = forecastRevenue({ startDate: "2026-10-01", months: 2 }, revenue({ startingMrrMinor: 0,
      newMrrMinor: 0, collectionRateBps: 0, openingReceivableCollectionsMinor: [0, 0] }));
    expect(result.rows.every(row => row.mrrMinor === 0 && row.collectionsMinor === 0 && row.netRevenueRetention === null)).toBe(true);
  });

  it("does not create negative MRR from rounding valid 100% losses", () => {
    const result = forecastRevenue({ startDate: "2026-10-01", months: 2 }, revenue({ startingMrrMinor: 1,
      churnBps: 5000, contractionBps: 5000, newMrrMinor: 0 }));
    expect(result.rows[0].mrrMinor).toBe(0);
  });

  it.each([
    { churnBps: 10_001 }, { churnBps: 8000, contractionBps: 3000 }, { collectionRateBps: -1 },
    { startingMrrMinor: NaN }, { newMrrMinor: 0.5 }, { collectionLagMonths: 0.5 },
    { openingReceivableCollectionsMinor: [] }, { customerLosses: [{ month: 0, mrrMinor: 100_001 }] },
    { changes: [{ month: 2, drivers: {} }] }, { changes: [{ month: 1, drivers: {} }, { month: 1, drivers: {} }] },
  ])("rejects invalid or incomplete revenue inputs %j", overrides => {
    expect(() => forecastRevenue({ startDate: "2026-10-01", months: 2 }, revenue(overrides))).toThrow();
  });

  it("rejects unsafe aggregates and rounds exact half cents consistently", () => {
    expect(multiply(1, 5000)).toBe(1);
    expect(multiply(-1, 5000)).toBe(-1);
    expect(multiply(Number.MAX_SAFE_INTEGER, 10_000)).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => sum(Number.MAX_SAFE_INTEGER, 1)).toThrow();
    expect(() => forecastRevenue({ startDate: "2026-10-01", months: 2 }, revenue({ startingMrrMinor: Number.MAX_SAFE_INTEGER }))).toThrow();
  });
});

describe("fully loaded staffing", () => {
  const employee = { id: "engineer", startDate: "2028-02-15", endExclusive: "2028-03-01",
    annualSalaryMinor: 348_000, payrollTaxBps: 1000, monthlyBenefitsMinor: 2900, monthlyCommissionMinor: 5800 };
  it("prorates salary, benefits and commissions across leap-year start and end dates", () => {
    const result = forecastHeadcountCost({ startDate: "2028-02-01", months: 2 }, [employee]);
    expect(result[0].costs[0]).toMatchObject({ activeDays: 15, salaryMinor: 15_000, commissionMinor: 3000,
      benefitsMinor: 1500, payrollTaxMinor: 1800, totalMinor: 21_300 });
    expect(result[0].averageHeadcount).toBe(15 / 29);
    expect(result[1]).toMatchObject({ headcount: 0, totalMinor: 0 });
  });
  it("includes existing employees for full months", () => {
    expect(forecastHeadcountCost({ startDate: "2028-01-01", months: 1 }, [
      { ...employee, startDate: "2020-01-01", endExclusive: undefined },
    ])[0]).toMatchObject({ headcount: 1, averageHeadcount: 1, totalMinor: 41_180 });
  });
  it("rejects duplicate people, impossible dates and reversed employment", () => {
    expect(() => forecastHeadcountCost({ startDate: "2028-02-01", months: 1 }, [employee, employee])).toThrow();
    expect(() => forecastHeadcountCost({ startDate: "2028-02-01", months: 1 }, [{ ...employee, startDate: "2027-02-29" }])).toThrow();
    expect(() => forecastHeadcountCost({ startDate: "2028-02-01", months: 1 }, [{ ...employee, endExclusive: "2028-02-14" }])).toThrow();
  });
});

describe("monthly SaaS metrics", () => {
  const input: MonthlyMetricInputs = { currency: "USD", month: "2026-10-01", basis,
    openingMrrMinor: 100_000, newMrrMinor: 20_000, expansionMrrMinor: 10_000, churnedMrrMinor: 5000, contractedMrrMinor: 5000,
    revenueMinor: 120_000, costOfRevenueMinor: 24_000, acquisitionSpendMinor: 30_000, newCustomers: 3, activeCustomers: 12,
    customerChurnBps: 1000, netOperatingBurnMinor: 60_000, averageEmployees: 6, collectionsMinor: 90_000 };
  it("calculates retention and unit economics using matching monthly inputs", () => {
    const { metrics } = calculateSaasMetrics(input);
    expect(Object.fromEntries(Object.entries(metrics).map(([key, value]) => [key, value.value]))).toEqual({
      mrr: 120_000, arr: 1_440_000, mrrGrowthRate: 0.2, newMrr: 20_000, expansionMrr: 10_000, churnedMrr: 5000,
      netRevenueRetention: 1, grossRevenueRetention: 0.9, grossMargin: 0.8, cac: 10_000, ltv: 80_000,
      cacPaybackMonths: 1.25, burnMultiple: 0.25, revenuePerEmployee: 20_000, cashConversion: 0.75, collections: 90_000,
    });
  });
  it("withholds missing inputs instead of turning them into zeros", () => {
    expect(Object.values(calculateSaasMetrics({ currency: "USD", month: "2026-10-01", basis }).metrics)
      .every(value => value.status === "unavailable" && value.value === null)).toBe(true);
    expect(calculateSaasMetrics({ ...input, contractedMrrMinor: undefined }).metrics.mrr.value).toBeNull();
  });
  it("withholds undefined unit economics and negative-growth burn multiples", () => {
    const { metrics } = calculateSaasMetrics({ ...input, newCustomers: 0, customerChurnBps: 0,
      newMrrMinor: 0, expansionMrrMinor: 0, averageEmployees: 0 });
    for (const key of ["cac", "ltv", "burnMultiple", "revenuePerEmployee"] as const) expect(metrics[key].value).toBeNull();
    expect(calculateSaasMetrics({ ...input, costOfRevenueMinor: 200_000 }).metrics.cacPaybackMonths.value).toBeNull();
    expect(calculateSaasMetrics({ ...input, costOfRevenueMinor: 200_000 }).metrics.ltv.value).toBeNull();
  });
  it("does not confuse zero burn with missing burn or collections with MRR", () => {
    const { metrics } = calculateSaasMetrics({ ...input, netOperatingBurnMinor: -500, collectionsMinor: 240_000 });
    expect(metrics.burnMultiple.value).toBe(0);
    expect(metrics.cashConversion.value).toBe(2);
    expect(metrics.mrr.value).toBe(120_000);
  });
  it("rejects non-finite values and invalid cohort losses", () => {
    expect(() => calculateSaasMetrics({ ...input, averageEmployees: Infinity })).toThrow();
    expect(() => calculateSaasMetrics({ ...input, churnedMrrMinor: 200_000 })).toThrow();
  });
});
