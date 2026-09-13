import { describe, expect, it } from "vitest";

import { calculateRunway } from "@/lib/finance/runway";

describe("calculateRunway", () => {
  it("derives burn, months, and zero-cash date from the inputs", () => {
    const result = calculateRunway({
      cashOnHandUsd: 600_000,
      monthlyRevenueUsd: 20_000,
      monthlyExpensesUsd: 70_000,
      asOf: new Date("2026-01-01T00:00:00Z"),
    });

    expect(result).toEqual({
      netMonthlyBurnUsd: 50_000,
      runwayMonths: 12,
      zeroCashDate: "2027-01-01",
      status: "healthy",
    });
  });

  it("flags a company with under three months of cash as critical", () => {
    const result = calculateRunway({
      cashOnHandUsd: 90_000,
      monthlyRevenueUsd: 0,
      monthlyExpensesUsd: 40_000,
      asOf: new Date("2026-01-01T00:00:00Z"),
    });

    expect(result.runwayMonths).toBe(2.3);
    expect(result.status).toBe("critical");
  });

  it("reports no runway limit when revenue covers expenses", () => {
    const result = calculateRunway({
      cashOnHandUsd: 250_000,
      monthlyRevenueUsd: 90_000,
      monthlyExpensesUsd: 70_000,
    });

    expect(result).toMatchObject({
      netMonthlyBurnUsd: -20_000,
      runwayMonths: null,
      zeroCashDate: null,
      status: "cash_flow_positive",
    });
  });

  it("rejects negative inputs instead of returning a nonsense number", () => {
    expect(() =>
      calculateRunway({
        cashOnHandUsd: -1,
        monthlyRevenueUsd: 0,
        monthlyExpensesUsd: 10,
      })
    ).toThrow(/cashOnHandUsd/);
  });
});
