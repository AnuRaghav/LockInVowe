import { describe, expect, it } from "vitest";
import { actuals, basis, plan } from "./testing";
import { canAffordHire, canAffordSpend, changeRaiseTiming, churnIncrease, compareScenarios, customerLoss,
  delayHiring, increaseMarketing, raiseRound, reduceBurn, revenueMiss, simulateHire, simulateSpendChange } from "./scenarios";

const hire = { id: "engineer", startDate: "2026-11-01", annualSalaryMinor: 120_000, payrollTaxBps: 0,
  monthlyBenefitsMinor: 0, monthlyCommissionMinor: 0 };

describe("operating scenarios", () => {
  it("models hires without inventing a revenue benefit or mutating the baseline", () => {
    const input = plan(); const before = structuredClone(input);
    const result = simulateHire(actuals(), input, { hires: [hire], basis });
    expect(result.difference.endingCashMinor).toBe(-50_000);
    expect(result.difference.rows.map(row => row.netBurnMinor)).toEqual([0, 10_000, 10_000, 10_000, 10_000, 10_000]);
    expect(result.difference.rows.every(row => row.revenueMinor === 0)).toBe(true);
    expect(input).toEqual(before);
    expect(simulateHire(actuals(), input, { hires: [hire], basis, revenue: { ...input.revenue, newMrrMinor: 5000 } })
      .difference.rows[0].revenueMinor).toBe(5000);
  });

  it("delays planned hires with month-end clamping, preserving existing employees", () => {
    const input = plan({ employees: [{ ...hire, startDate: "2027-01-31" }, { ...hire, id: "existing", startDate: "2020-01-01" }] });
    const result = delayHiring(actuals(), input, { employeeIds: [hire.id], months: 1, basis });
    expect(result.scenario.rows[4].payroll.costs.find(item => item.id === hire.id)?.activeDays).toBe(1);
    expect(result.scenario.rows[4].payroll.costs.find(item => item.id === "existing")?.activeDays).toBe(28);
    expect(() => delayHiring(actuals(), input, { employeeIds: ["existing"], months: 1, basis })).toThrow();
  });

  it("changes spend on its actual effective date and does not overstate a mid-month reduction", () => {
    const input = plan({ expenses: [{ ...plan().expenses[0], monthlyAmountMinor: 31_000 }] });
    const result = simulateSpendChange(actuals(), input, { expenseId: "marketing", monthlyAmountMinor: 0,
      effectiveDate: "2026-10-16", basis });
    expect(result.scenario.rows[0].operatingExpensesMinor).toBe(15_000);
    expect(result.difference.endingCashMinor).toBe(171_000);
    expect(() => simulateSpendChange(actuals(), input, { expenseId: "missing", monthlyAmountMinor: 0, effectiveDate: "2026-10-16", basis })).toThrow();
  });

  it("increases marketing without assuming a return, and reduces selected expense categories", () => {
    const input = plan();
    const increased = increaseMarketing(actuals(), input, { expenseId: "marketing", increaseMinor: 20_000, effectiveDate: "2026-10-01", basis });
    expect(increased.difference.endingCashMinor).toBe(-120_000);
    expect(increased.difference.rows.every(row => row.revenueMinor === 0)).toBe(true);
    const reduced = reduceBurn(actuals(), input, { expenseIds: ["marketing"], reductionBps: 2000, effectiveDate: "2026-10-01", basis });
    expect(reduced.difference.endingCashMinor).toBe(180_000);
  });

  it("keeps a zero spend change exact even when splitting a month would round up twice", () => {
    const input = plan({ expenses: [{ ...plan().expenses[0], monthlyAmountMinor: 1 }] });
    expect(simulateSpendChange(actuals(), input, { expenseId: "marketing", monthlyAmountMinor: 1,
      effectiveDate: "2026-11-16", basis }).difference.endingCashMinor).toBe(0);
  });

  it("reduces new sales from the requested month, including subsequent explicit overrides", () => {
    const input = plan();
    input.revenue.newMrrMinor = 10_000;
    input.revenue.changes = [{ month: 3, drivers: { newMrrMinor: 20_000 } }];
    const result = revenueMiss(actuals(), input, { fromMonth: 1, newSalesReductionBps: 5000, basis });
    expect(result.scenario.rows.map(row => row.revenue.newMrrMinor)).toEqual([10_000, 5000, 5000, 10_000, 10_000, 10_000]);
    expect(result.scenario.rows[1].revenue.mrrMinor).toBe(115_000);
    expect(result.difference.endingCashMinor).toBeLessThan(0);
  });

  it("applies additional churn persistently and respects existing future driver changes", () => {
    const input = plan();
    input.revenue.changes = [{ month: 2, drivers: { churnBps: 2000 } }];
    const result = churnIncrease(actuals(), input, { fromMonth: 1, additionalChurnBps: 1000, basis });
    expect(result.scenario.rows.slice(0, 3).map(row => row.revenue.churnedMrrMinor)).toEqual([0, 10_000, 27_000]);
    expect(() => churnIncrease(actuals(), input, { fromMonth: 0, additionalChurnBps: 9000, basis })).toThrow();
  });

  it("removes a customer once and carries the smaller MRR base forward", () => {
    const result = customerLoss(actuals(), plan(), { month: 1, mrrMinor: 20_000, basis });
    expect(result.scenario.rows.map(row => row.revenue.mrrMinor)).toEqual([100_000, 80_000, 80_000, 80_000, 80_000, 80_000]);
    expect(result.scenario.rows.map(row => row.revenue.churnedMrrMinor)).toEqual([0, 20_000, 0, 0, 0, 0]);
    expect(result.difference.endingCashMinor).toBe(-100_000);
  });

  it("adds net financing proceeds without changing revenue, burn or profit", () => {
    const result = raiseRound(actuals(), plan(), { id: "seed", date: "2026-11-15", amountMinor: 500_000, feesMinor: 20_000, basis });
    expect(result.difference.endingCashMinor).toBe(480_000);
    expect(result.difference.rows.every(row => row.revenueMinor === 0 && row.netBurnMinor === 0)).toBe(true);
    expect(result.scenario.rows[1].operatingProfitMinor).toBe(-50_000);
  });

  it("detects running out of cash before a delayed financing round, even if ending cash is positive", () => {
    const input = plan({ raises: [{ id: "seed", date: "2026-11-01", amountMinor: 500_000, feesMinor: 0 }] });
    const result = changeRaiseTiming(actuals(100_000), input, { raiseId: "seed", date: "2027-01-01", basis });
    expect(result.baseline.cash.derived?.zeroCash.status).toBe("not_crossed_within_horizon");
    expect(result.scenario.cash.derived?.zeroCash.crossingDate).toBe("2026-12-01");
    expect(result.scenario.cash.derived?.endingCashMinor).toBeGreaterThan(0);
    expect(result.difference.endingCashMinor).toBe(0);
    expect(changeRaiseTiming(actuals(), input, { raiseId: "seed", date: "2028-01-01", basis }).difference.endingCashMinor).toBe(-500_000);
  });

  it("compares base/bear/bull on a shared observed cash balance and horizon", () => {
    const input = plan();
    const bear = structuredClone(input); bear.revenue.churnBps = 1000;
    const bull = structuredClone(input); bull.revenue.newMrrMinor = 10_000;
    const result = compareScenarios(actuals(), input, [{ name: "base", plan: input }, { name: "bear", plan: bear }, { name: "bull", plan: bull }]);
    expect(result.scenarios[0].difference.endingCashMinor).toBe(0);
    expect(result.scenarios[1].difference.endingCashMinor).toBeLessThan(0);
    expect(result.scenarios[2].difference.endingCashMinor).toBeGreaterThan(0);
    expect(result.scenarios.every(item => item.scenario.cash.startingPosition.valueMinor === 1_000_000)).toBe(true);
    expect(() => compareScenarios(actuals(), input, [{ name: "other", plan: plan({ months: 12 }) }])).toThrow();
    expect(() => compareScenarios(actuals(), input, [{ name: "base", plan: input }, { name: " base ", plan: input }])).toThrow();
  });
});

describe("affordability decisions", () => {
  const policy = { minimumCashMinor: 100_000, minimumRunwayMonths: 3 };
  it("requires sufficient future coverage after the hire start date", () => {
    expect(canAffordHire(actuals(), plan(), { hires: [hire], basis, policy }).assessment.status).toBe("affordable_within_horizon");
    expect(canAffordHire(actuals(), plan(), { hires: [{ ...hire, startDate: "2027-03-01" }], basis, policy }).assessment.status).toBe("unavailable");
  });
  it("rejects a breached floor, including one caused by a late round", () => {
    expect(canAffordHire(actuals(200_000), plan(), { hires: [hire], basis, policy }).assessment.status).toBe("unaffordable");
    expect(canAffordHire(actuals(100_000), plan({ raises: [{ id: "seed", date: "2027-01-01", amountMinor: 500_000, feesMinor: 0 }] }),
      { hires: [hire], basis, policy: { ...policy, minimumCashMinor: 0 } }).assessment.status).toBe("unaffordable");
  });
  it("does not give an affordability answer without observed cash", () => {
    expect(canAffordHire(actuals(null), plan(), { hires: [hire], basis, policy }).assessment.status).toBe("unavailable");
  });
  it("assesses a spend increase against the supplied reserve policy", () => {
    expect(canAffordSpend(actuals(), plan(), { expenseId: "marketing", monthlyAmountMinor: 200_000,
      effectiveDate: "2026-10-01", basis, policy }).assessment.status).toBe("affordable_within_horizon");
    expect(canAffordSpend(actuals(), plan(), { expenseId: "marketing", monthlyAmountMinor: 400_000,
      effectiveDate: "2026-10-01", basis, policy }).assessment.status).toBe("unaffordable");
  });
});
