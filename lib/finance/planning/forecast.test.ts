import { describe, expect, it } from "vitest";
import { buildCashForecast } from "../forecast";
import { calculateForecastRunway, estimateFundraisingStartDate, forecastBurn, forecastCash,
  forecastRunwayThreshold, reachProfitability } from "./forecast";
import { sum } from "./math";
import { actuals, plan } from "./testing";

describe("integrated operating forecasts", () => {
  it("ties every operating component and financing event to the existing cash trajectory", () => {
    const result = forecastCash(actuals(), plan({ months: 2,
      employees: [{ id: "engineer", startDate: "2026-10-01", annualSalaryMinor: 1_200_000, payrollTaxBps: 1000,
        monthlyBenefitsMinor: 10_000, monthlyCommissionMinor: 10_000 }],
      expenses: [{ id: "software", category: "software", monthlyAmountMinor: 50_000, startDate: "2026-10-01" }],
      costOfRevenueBps: 2000,
      oneTimeCosts: [{ id: "launch", kind: "operating", date: "2026-10-15", amountMinor: 30_000 },
        { id: "equipment", kind: "capital", date: "2026-10-20", amountMinor: 40_000 }],
      raises: [{ id: "seed", date: "2026-10-20", amountMinor: 500_000, feesMinor: 20_000 }],
    }));
    expect(result.rows[0]).toMatchObject({ grossBurnMinor: 231_000, netBurnMinor: 131_000, financingMinor: 480_000,
      capitalSpendMinor: 40_000, operatingProfitMinor: -131_000 });
    expect(result.cash.trajectory.map(row => row.endingCashMinor)).toEqual([1_309_000, 1_208_000]);
    for (const [index, row] of result.rows.entries()) {
      expect(result.cash.trajectory[index].netChangeMinor).toBe(sum(-row.netBurnMinor, -row.capitalSpendMinor, row.financingMinor));
    }
    expect(forecastBurn(result).rows[0].netBurnMinor).toBe(131_000);
    expect(reachProfitability(result, 1).status).toBe("not_reached_within_horizon");
  });

  it("keeps missing observed cash unavailable but still models conditional operating costs", () => {
    const result = forecastCash(actuals(null), plan());
    expect(result.cash).toMatchObject({ status: "unavailable", trajectory: [], derived: null });
    expect(result.rows[0].netBurnMinor).toBe(50_000);
    expect(calculateForecastRunway(result.cash).status).toBe("unavailable");
  });

  it("keeps currencies isolated", () => {
    expect(() => forecastCash(actuals(), plan({ currency: "EUR" }))).toThrow("No observed eligible cash scope");
  });

  it("validates calendar months, exact money, identity, and financing fees", () => {
    expect(() => forecastCash(actuals(), plan({ startDate: "2026-10-15" }))).toThrow();
    expect(() => forecastCash(actuals(), plan({ months: 121 }))).toThrow();
    expect(() => forecastCash(actuals(), plan({ raises: [{ id: "bad", date: "2026-11-01", amountMinor: 100, feesMinor: 101 }] }))).toThrow();
    expect(() => forecastCash(actuals(), plan({ expenses: [plan().expenses[0], plan().expenses[0]] }))).toThrow();
    expect(() => forecastCash(actuals(), plan({ oneTimeCosts: [{ id: "past", kind: "operating", date: "2026-09-01", amountMinor: 100 }] }))).toThrow();
  });

  it("prorates an expense that begins and ends mid-month", () => {
    const result = forecastCash(actuals(), plan({ expenses: [{ id: "contractor", category: "contractor",
      monthlyAmountMinor: 31_000, startDate: "2026-10-11", endExclusive: "2026-10-21" }] }));
    expect(result.rows.map(row => row.operatingExpensesMinor)).toEqual([10_000, 0, 0, 0, 0, 0]);
  });

  it("does not call accrual operating profitability cash break-even when collections are delayed", () => {
    const input = plan({ expenses: [{ ...plan().expenses[0], monthlyAmountMinor: 50_000 }] });
    input.revenue.collectionLagMonths = 3;
    const result = forecastCash(actuals(), input);
    expect(result.rows[0]).toMatchObject({ operatingProfitMinor: 50_000, netBurnMinor: 50_000 });
    expect(reachProfitability(result)).toMatchObject({ status: "conditional", firstMonth: "2026-10-01" });
    expect(reachProfitability(result, 7).status).toBe("not_reached_within_horizon");
  });
});

describe("runway and fundraising dates", () => {
  it("derives zero cash, reserve and runway floors from one trajectory", () => {
    const forecast = forecastCash(actuals(300_000), plan()).cash;
    expect(calculateForecastRunway(forecast)).toMatchObject({ status: "projected_within_horizon", crossingDate: "2027-04-01" });
    expect(calculateForecastRunway(forecast, 100_000).crossingDate).toBe("2027-02-01");
    expect(forecastRunwayThreshold(forecast, 3).crossingDate).toBe("2027-01-01");
    expect(forecastRunwayThreshold(forecast, 9).crossingDate).toBe("2026-10-01");
    expect(estimateFundraisingStartDate(forecast, { desiredRunwayAtCloseMonths: 2, fundraisingDurationMonths: 3 }))
      .toMatchObject({ targetCloseDate: "2027-02-01", latestStartDate: "2026-11-01", recommendedStartDate: "2026-11-01", overdueAtForecastStart: false });
  });

  it("reports a missed fundraising deadline and an already breached cash floor", () => {
    const forecast = forecastCash(actuals(100_000), plan()).cash;
    expect(estimateFundraisingStartDate(forecast, { desiredRunwayAtCloseMonths: 2, fundraisingDurationMonths: 3 }))
      .toMatchObject({ latestStartDate: "2026-07-01", recommendedStartDate: "2026-10-01", overdueAtForecastStart: true });
    expect(calculateForecastRunway(forecast, 100_000)).toMatchObject({ months: 0, crossingDate: "2026-10-01" });
  });

  it("does not invent an infinite runway or fundraising date from a short horizon", () => {
    const forecast = forecastCash(actuals(), plan()).cash;
    expect(calculateForecastRunway(forecast)).toMatchObject({ status: "beyond_horizon", months: null });
    expect(forecastRunwayThreshold(forecast, 12).status).toBe("unavailable");
    expect(estimateFundraisingStartDate(forecast, { desiredRunwayAtCloseMonths: 6, fundraisingDurationMonths: 6 }).status).toBe("unavailable");
  });

  it("withholds runway when the legacy cash forecast omitted its baseline", () => {
    const forecast = buildCashForecast(actuals(), { startDate: "2026-10-01", currency: "USD",
      horizon: { periods: 6, granularity: "month" }, baseline: { method: "none" } });
    expect(calculateForecastRunway(forecast).status).toBe("unavailable");
  });
});
