import { describe, expect, it } from "vitest";
import { deriveFinancialActuals } from "./actuals";
import { buildCashForecast, compareCashScenarios, simulateCashScenario, type CashForecastInput, type ForecastBasis } from "./forecast";
import { financialSourceFixture, reconcileFixture } from "./testing";

const basis: ForecastBasis = { kind: "management_assumption", label: "Board-approved planning assumption", reference: "plan-2026" };

function actuals(currencies: Array<{ currency: string; cashMinor: number }> = [{ currency: "USD", cashMinor: 876_138 }]) {
  const source = financialSourceFixture("forecast-company");
  source.entries = [];
  source.accounts = [];
  source.balances = [];
  for (const item of currencies) {
    source.accounts.push({ ...financialSourceFixture().accounts[0], id: `cash-${item.currency}`, company_id: source.companyId,
      provider_account_id: `cash-${item.currency}`, currency: item.currency });
    source.balances.push({ ...financialSourceFixture().balances[0], id: `balance-${item.currency}`, company_id: source.companyId,
      account_id: `cash-${item.currency}`, currency: item.currency, current_minor: item.cashMinor });
  }
  return deriveFinancialActuals(reconcileFixture(source));
}

const base = (overrides: Partial<CashForecastInput> = {}): CashForecastInput => ({
  currency: "USD",
  startDate: "2026-10-01",
  horizon: { periods: 6, granularity: "month" },
  baseline: { method: "explicit_periodic", inflowsMinor: 50_000, outflowsMinor: 100_000, basis },
  ...overrides,
});

describe("deterministic cash forecasting", () => {
  it("builds a baseline cash trajectory from observed starting cash and an explicit periodic assumption", () => {
    const result = buildCashForecast(actuals(), base({ horizon: { periods: 3, granularity: "month" } }));
    expect(result.startingPosition.valueMinor).toBe(876_138);
    expect(result.trajectory.map(row => ({ opening: row.openingCashMinor, inflows: row.inflowsMinor,
      outflows: row.outflowsMinor, net: row.netChangeMinor, ending: row.endingCashMinor }))).toEqual([
      { opening: 876_138, inflows: 50_000, outflows: 100_000, net: -50_000, ending: 826_138 },
      { opening: 826_138, inflows: 50_000, outflows: 100_000, net: -50_000, ending: 776_138 },
      { opening: 776_138, inflows: 50_000, outflows: 100_000, net: -50_000, ending: 726_138 },
    ]);
    expect(result.baseline).toMatchObject({ status: "conditional", basis });
  });

  it("applies recurring outflow increases and decreases on their explicit cadence and dates", () => {
    const increase = buildCashForecast(actuals(), base({ recurringDeltas: [{ id: "hire", label: "Two planned hires", startDate: "2026-11-01",
      endExclusive: "2027-02-01", cadence: "month", driver: "outflow", change: "increase", amountMinor: 34_000,
      basis: { kind: "scenario_override", label: "Two hires at assumed monthly cost" } }] }));
    expect(increase.trajectory.map(row => row.netChangeMinor)).toEqual([-50_000, -84_000, -84_000, -84_000, -50_000, -50_000]);

    const decrease = buildCashForecast(actuals(), base({ horizon: { periods: 2, granularity: "month" }, recurringDeltas: [{
      id: "aws", label: "Reduce AWS", startDate: "2026-10-01", cadence: "month", driver: "outflow", change: "decrease",
      amountMinor: 20_000, basis: { kind: "management_assumption", label: "Infrastructure reduction plan" },
    }] }));
    expect(decrease.trajectory.map(row => ({ reduction: row.outflowReductionsMinor, net: row.netChangeMinor })))
      .toEqual([{ reduction: 20_000, net: -30_000 }, { reduction: 20_000, net: -30_000 }]);
  });

  it("models one-time expenditure and future financing only as explicit scenario events", () => {
    const result = buildCashForecast(actuals(), base({ horizon: { periods: 2, granularity: "month" }, events: [
      { id: "purchase", label: "Equipment purchase", date: "2026-10-15", driver: "outflow", change: "increase", amountMinor: 120_000,
        basis: { kind: "scenario_override", label: "Proposed purchase" } },
      { id: "financing", label: "Assumed financing close", date: "2026-11-20", driver: "inflow", change: "increase", amountMinor: 500_000,
        basis: { kind: "management_assumption", label: "Financing timing assumption" } },
    ] }));
    expect(result.trajectory.map(row => row.netChangeMinor)).toEqual([-170_000, 450_000]);
    expect(result.events.map(event => event.basis.label)).toEqual(["Proposed purchase", "Financing timing assumption"]);
  });

  it("derives zero-cash and runway-floor threshold crossings from the same trajectory", () => {
    const result = buildCashForecast(actuals([{ currency: "USD", cashMinor: 876_138 }]), base({
      horizon: { periods: 8, granularity: "month" }, baseline: { method: "explicit_periodic", inflowsMinor: 0, outflowsMinor: 200_000, basis },
      thresholds: { reserveMinor: 100_000, runwayMonths: 3 },
    }));
    expect(result.derived).toMatchObject({
      zeroCash: { status: "crossed", crossingDate: "2027-03-01" },
      reserveThreshold: { status: "crossed", crossingDate: "2027-02-01", amountMinor: 100_000 },
      runwayThreshold: { status: "crossed", months: 3, crossingDate: "2026-12-01", zeroCashDate: "2027-03-01" },
    });
  });

  it("compares arbitrary scenarios against one shared baseline", () => {
    const input = base({ horizon: { periods: 3, granularity: "month" } });
    const result = compareCashScenarios(actuals(), input, [
      { name: "higher spend", recurringDeltas: [{ id: "spend-up", label: "Spend increase", startDate: "2026-10-01", cadence: "month",
        driver: "outflow", change: "increase", amountMinor: 10_000, basis } ] },
      { name: "lower spend", recurringDeltas: [{ id: "spend-down", label: "Spend reduction", startDate: "2026-10-01", cadence: "month",
        driver: "outflow", change: "decrease", amountMinor: 10_000, basis } ] },
    ]);
    expect(result.scenarios.map(item => [item.name, item.difference?.endingCashMinor])).toEqual([
      ["higher spend", -30_000], ["lower spend", 30_000],
    ]);
  });

  it("keeps currencies separate", () => {
    const state = actuals([{ currency: "USD", cashMinor: 100_000 }, { currency: "EUR", cashMinor: 200_000 }]);
    expect(buildCashForecast(state, base({ currency: "USD", horizon: { periods: 1, granularity: "month" } })).startingPosition.valueMinor).toBe(100_000);
    expect(buildCashForecast(state, base({ currency: "EUR", horizon: { periods: 1, granularity: "month" } })).startingPosition.valueMinor).toBe(200_000);
  });

  it("withholds the trajectory when connected starting cash is unavailable", () => {
    const source = financialSourceFixture("forecast-company");
    source.balances = [];
    const result = buildCashForecast(deriveFinancialActuals(reconcileFixture(source)), base());
    expect(result).toMatchObject({ status: "unavailable", trajectory: [], derived: null,
      startingPosition: { status: "unavailable", valueMinor: null } });
    expect(result.qualifications).toContain("starting_cash_position_unavailable");
  });

  it("marks the historical baseline unavailable and preserves explicit assumptions without pretending they are actuals", () => {
    const input = base({ baseline: { method: "historical_recorded_average", lookbackMonths: 3 }, assumptions: [{
      id: "collections", description: "Assume collections grow 10% monthly", basis: { kind: "management_assumption", label: "Founder scenario" },
    }] });
    const result = buildCashForecast(actuals(), input);
    expect(result.baseline).toMatchObject({ status: "unavailable", reasons: expect.arrayContaining(["history_completeness_unknown"]) });
    expect(result.qualifications).toContain("trajectory_omits_unmodeled_baseline_activity");
    expect(result.assumptions).toEqual(input.assumptions);
    expect(result.trajectory.every(row => row.baselineInflowsMinor === 0 && row.baselineOutflowsMinor === 0)).toBe(true);
  });

  it("uses scenario arithmetic from deterministic code", () => {
    const result = simulateCashScenario(actuals(), base({ horizon: { periods: 2, granularity: "month" } }), {
      name: "hire", recurringDeltas: [{ id: "hire-cost", label: "Planned engineers", startDate: "2026-10-01", cadence: "month",
        driver: "outflow", change: "increase", amountMinor: 34_000, basis }],
    });
    expect(result.difference).toEqual({ endingCashMinor: -68_000, minimumCashMinor: -68_000, cumulativeIncrementalCashImpactMinor: -68_000 });
  });
});
