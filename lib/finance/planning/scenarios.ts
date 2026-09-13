import type { FinancialActuals } from "../actuals";
import type { ForecastBasis } from "../forecast";
import { calculateForecastRunway, forecastCash, type OperatingForecast, type OperatingPlan, type PlannedRaise } from "./forecast";
import type { PlannedEmployee } from "./headcount";
import { addMonths, date, integer, multiply, sum } from "./math";
import { forecastRevenue, type RevenueDrivers, type RevenuePlan } from "./revenue";

function compare(base: OperatingForecast, scenario: OperatingForecast) {
  const baseRunway = calculateForecastRunway(base.cash);
  const scenarioRunway = calculateForecastRunway(scenario.cash);
  return { baseline: base, scenario, difference: {
    endingCashMinor: base.cash.derived && scenario.cash.derived ? sum(scenario.cash.derived.endingCashMinor, -base.cash.derived.endingCashMinor) : null,
    minimumCashMinor: base.cash.derived && scenario.cash.derived ? sum(scenario.cash.derived.minimumCashMinor, -base.cash.derived.minimumCashMinor) : null,
    runwayMonths: baseRunway.months !== null && scenarioRunway.months !== null ? scenarioRunway.months - baseRunway.months : null,
    rows: scenario.rows.map((row, index) => ({ start: row.start,
      revenueMinor: sum(row.revenue.revenueMinor, -base.rows[index].revenue.revenueMinor),
      grossBurnMinor: sum(row.grossBurnMinor, -base.rows[index].grossBurnMinor),
      netBurnMinor: sum(row.netBurnMinor, -base.rows[index].netBurnMinor),
      endingCashMinor: base.cash.trajectory[index] && scenario.cash.trajectory[index]
        ? sum(scenario.cash.trajectory[index].endingCashMinor, -base.cash.trajectory[index].endingCashMinor) : null,
    })),
  }, runway: { baseline: baseRunway, scenario: scenarioRunway } };
}

export function compareScenarios(actuals: FinancialActuals, base: OperatingPlan, scenarios: Array<{ name: string; plan: OperatingPlan }>) {
  integer(scenarios.length, "scenario count", 1, 8);
  const names = scenarios.map(item => item.name.trim());
  if (names.some(name => !name) || new Set(names).size !== names.length) throw new Error("Scenario names must be unique and non-empty");
  const baseline = forecastCash(actuals, base);
  return { baseline, scenarios: scenarios.map(item => {
    if (item.plan.currency !== base.currency || item.plan.startDate !== base.startDate || item.plan.months !== base.months)
      throw new Error("Scenarios must share currency, start date and horizon");
    return { name: item.name, ...compare(baseline, forecastCash(actuals, item.plan)) };
  }) };
}

function simulate(actuals: FinancialActuals, plan: OperatingPlan, name: string, basis: ForecastBasis, change: (draft: OperatingPlan) => void) {
  const draft = structuredClone(plan);
  draft.basis = basis;
  change(draft);
  return compareScenarios(actuals, plan, [{ name, plan: draft }]).scenarios[0];
}

function inHorizon(plan: OperatingPlan, value: string) {
  date(value);
  if (value < plan.startDate || value >= addMonths(plan.startDate, plan.months)) throw new Error("Scenario effective date must be within the forecast horizon");
}

export function simulateHire(actuals: FinancialActuals, plan: OperatingPlan, options: {
  hires: PlannedEmployee[]; basis: ForecastBasis; revenue?: RevenuePlan;
}) {
  if (!options.hires.length) throw new Error("Supply at least one hire");
  options.hires.forEach(hire => inHorizon(plan, hire.startDate));
  return simulate(actuals, plan, "hire", options.basis, draft => {
    draft.employees.push(...structuredClone(options.hires));
    if (options.revenue) draft.revenue = structuredClone(options.revenue);
  });
}

export interface SpendChange { expenseId: string; monthlyAmountMinor: number; effectiveDate: string; basis: ForecastBasis }
function applySpendChange(draft: OperatingPlan, options: Omit<SpendChange, "basis">) {
  inHorizon(draft, options.effectiveDate); integer(options.monthlyAmountMinor, "changed expense");
  const expense = draft.expenses.find(item => item.id === options.expenseId);
  if (!expense) throw new Error("Unknown expense id");
  if (options.effectiveDate < expense.startDate || (expense.endExclusive && options.effectiveDate >= expense.endExclusive))
    throw new Error("Expense must be active on the change date");
  if (options.monthlyAmountMinor === expense.monthlyAmountMinor) return;
  if (options.effectiveDate === expense.startDate) expense.monthlyAmountMinor = options.monthlyAmountMinor;
  else {
    draft.expenses.push({ ...expense, id: `${expense.id}:changed:${options.effectiveDate}`,
      startDate: options.effectiveDate, monthlyAmountMinor: options.monthlyAmountMinor });
    expense.endExclusive = options.effectiveDate;
  }
}

export function simulateSpendChange(actuals: FinancialActuals, plan: OperatingPlan, options: SpendChange) {
  return simulate(actuals, plan, "spend change", options.basis, draft => applySpendChange(draft, options));
}

export function delayHiring(actuals: FinancialActuals, plan: OperatingPlan, options: {
  employeeIds: string[]; months: number; basis: ForecastBasis;
}) {
  integer(options.months, "hiring delay", 1, 120);
  return simulate(actuals, plan, "delay hiring", options.basis, draft => {
    if (!options.employeeIds.length || new Set(options.employeeIds).size !== options.employeeIds.length) throw new Error("Supply unique employee ids");
    for (const id of options.employeeIds) {
      const employee = draft.employees.find(item => item.id === id);
      if (!employee) throw new Error("Unknown employee id");
      inHorizon(plan, employee.startDate);
      employee.startDate = addMonths(employee.startDate, options.months);
      if (employee.endExclusive) employee.endExclusive = addMonths(employee.endExclusive, options.months);
    }
  });
}

export function increaseMarketing(actuals: FinancialActuals, plan: OperatingPlan, options: {
  expenseId: string; increaseMinor: number; effectiveDate: string; basis: ForecastBasis; revenue?: RevenuePlan;
}) {
  integer(options.increaseMinor, "marketing increase");
  const expense = plan.expenses.find(item => item.id === options.expenseId);
  if (!expense) throw new Error("Unknown marketing expense id");
  return simulate(actuals, plan, "increase marketing", options.basis, draft => {
    applySpendChange(draft, { ...options, monthlyAmountMinor: sum(expense.monthlyAmountMinor, options.increaseMinor) });
    if (options.revenue) draft.revenue = structuredClone(options.revenue);
  });
}

function revenueChangeAt(plan: OperatingPlan, month: number, drivers: Partial<RevenueDrivers>) {
  integer(month, "revenue change month", 0, plan.months - 1);
  const changes = plan.revenue.changes ??= [];
  const existing = changes.find(item => item.month === month);
  if (existing) existing.drivers = { ...existing.drivers, ...drivers };
  else changes.push({ month, drivers });
}

/** Reduces new-sales MRR from a selected month onward, not already retained subscriptions. */
export function revenueMiss(actuals: FinancialActuals, plan: OperatingPlan, options: {
  fromMonth: number; newSalesReductionBps: number; basis: ForecastBasis;
}) {
  integer(options.fromMonth, "revenue miss month", 0, plan.months - 1);
  integer(options.newSalesReductionBps, "new sales miss", 0, 10_000);
  const newMrr = forecastRevenue(plan, plan.revenue).rows[options.fromMonth].newMrrMinor;
  return simulate(actuals, plan, "revenue miss", options.basis, draft => {
    for (const change of draft.revenue.changes ?? []) {
      if (change.month > options.fromMonth && change.drivers.newMrrMinor !== undefined)
        change.drivers.newMrrMinor = multiply(change.drivers.newMrrMinor, 10_000 - options.newSalesReductionBps);
    }
    revenueChangeAt(draft, options.fromMonth, { newMrrMinor: multiply(newMrr, 10_000 - options.newSalesReductionBps) });
  });
}

export function churnIncrease(actuals: FinancialActuals, plan: OperatingPlan, options: {
  fromMonth: number; additionalChurnBps: number; basis: ForecastBasis;
}) {
  integer(options.fromMonth, "churn increase month", 0, plan.months - 1);
  integer(options.additionalChurnBps, "additional churn", 0, 10_000);
  let churn = plan.revenue.churnBps;
  for (const change of [...(plan.revenue.changes ?? [])].sort((a, b) => a.month - b.month))
    if (change.month <= options.fromMonth && change.drivers.churnBps !== undefined) churn = change.drivers.churnBps;
  return simulate(actuals, plan, "churn increase", options.basis, draft => {
    for (const change of draft.revenue.changes ?? [])
      if (change.month > options.fromMonth && change.drivers.churnBps !== undefined) change.drivers.churnBps += options.additionalChurnBps;
    revenueChangeAt(draft, options.fromMonth, { churnBps: churn + options.additionalChurnBps });
  });
}

export function customerLoss(actuals: FinancialActuals, plan: OperatingPlan, options: {
  month: number; mrrMinor: number; basis: ForecastBasis;
}) {
  return simulate(actuals, plan, "customer loss", options.basis, draft => {
    (draft.revenue.customerLosses ??= []).push({ month: options.month, mrrMinor: options.mrrMinor });
  });
}

export function raiseRound(actuals: FinancialActuals, plan: OperatingPlan, options: PlannedRaise & { basis: ForecastBasis }) {
  inHorizon(plan, options.date);
  return simulate(actuals, plan, "raise round", options.basis, draft => {
    draft.raises.push({ id: options.id, date: options.date, amountMinor: options.amountMinor, feesMinor: options.feesMinor });
  });
}

export function changeRaiseTiming(actuals: FinancialActuals, plan: OperatingPlan, options: { raiseId: string; date: string; basis: ForecastBasis }) {
  date(options.date);
  return simulate(actuals, plan, "change raise timing", options.basis, draft => {
    const raise = draft.raises.find(item => item.id === options.raiseId);
    if (!raise) throw new Error("Unknown financing id");
    raise.date = options.date;
  });
}

/** Reduces only explicitly selected non-payroll expenses; never invents layoffs. */
export function reduceBurn(actuals: FinancialActuals, plan: OperatingPlan, options: {
  expenseIds: string[]; reductionBps: number; effectiveDate: string; basis: ForecastBasis;
}) {
  integer(options.reductionBps, "expense reduction", 0, 10_000);
  if (!options.expenseIds.length || new Set(options.expenseIds).size !== options.expenseIds.length) throw new Error("Supply unique expense ids");
  return simulate(actuals, plan, "reduce burn", options.basis, draft => {
    for (const id of options.expenseIds) {
      const expense = draft.expenses.find(item => item.id === id);
      if (!expense) throw new Error("Unknown expense id");
      applySpendChange(draft, { expenseId: id, effectiveDate: options.effectiveDate,
        monthlyAmountMinor: multiply(expense.monthlyAmountMinor, 10_000 - options.reductionBps) });
    }
  });
}

export interface AffordabilityPolicy { minimumCashMinor: number; minimumRunwayMonths: number }
function affordability(forecast: OperatingForecast, policy: AffordabilityPolicy, decisionDate: string) {
  integer(policy.minimumCashMinor, "affordability cash floor"); integer(policy.minimumRunwayMonths, "affordability runway", 1, 120);
  const cash = forecast.cash;
  if (!cash.derived) return { status: "unavailable" as const, reason: "starting_cash_unavailable" };
  if (cash.derived.minimumCashMinor <= policy.minimumCashMinor)
    return { status: "unaffordable" as const, reason: "cash_floor_breached_within_horizon" };
  if (cash.trajectory.at(-1)!.endExclusive < addMonths(decisionDate, policy.minimumRunwayMonths))
    return { status: "unavailable" as const, reason: "horizon_too_short_to_verify_required_runway" };
  return { status: "affordable_within_horizon" as const, reason: "cash_floor_preserved_for_entire_modeled_horizon" };
}

export function canAffordHire(actuals: FinancialActuals, plan: OperatingPlan,
  options: Parameters<typeof simulateHire>[2] & { policy: AffordabilityPolicy }) {
  const result = simulateHire(actuals, plan, options);
  const decisionDate = options.hires.map(hire => hire.startDate).sort().at(-1)!;
  return { ...result, assessment: affordability(result.scenario, options.policy, decisionDate), policy: options.policy };
}

export function canAffordSpend(actuals: FinancialActuals, plan: OperatingPlan, options: SpendChange & { policy: AffordabilityPolicy }) {
  const result = simulateSpendChange(actuals, plan, options);
  return { ...result, assessment: affordability(result.scenario, options.policy, options.effectiveDate), policy: options.policy };
}
