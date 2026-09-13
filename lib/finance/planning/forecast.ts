import type { FinancialActuals } from "../actuals";
import { buildCashForecast, type CashForecast, type ForecastBasis, type ForecastCashEvent } from "../forecast";
import { forecastHeadcountCost, type PlannedEmployee } from "./headcount";
import { addMonths, date, daysBetween, integer, multiply, periods, sum, uniqueIds, type MonthlyWindow } from "./math";
import { forecastRevenue, type RevenuePlan } from "./revenue";

export interface PlannedExpense {
  id: string;
  category: string;
  monthlyAmountMinor: number;
  startDate: string;
  endExclusive?: string;
}
export interface PlannedOneTimeCost { id: string; date: string; amountMinor: number; kind: "operating" | "capital" }
export interface PlannedRaise { id: string; date: string; amountMinor: number; feesMinor: number }
export interface OperatingPlan extends MonthlyWindow {
  currency: string;
  basis: ForecastBasis;
  revenue: RevenuePlan;
  employees: PlannedEmployee[];
  /** All non-payroll operating expenses, excluding cost of revenue and one-time costs. */
  expenses: PlannedExpense[];
  costOfRevenueBps: number;
  oneTimeCosts: PlannedOneTimeCost[];
  raises: PlannedRaise[];
  reserveMinor?: number;
}

export type OperatingForecast = ReturnType<typeof forecastCash>;

/** All operating components compile into the existing source-cash forecast engine. */
export function forecastCash(actuals: FinancialActuals, plan: OperatingPlan) {
  const timeline = periods(plan);
  integer(plan.costOfRevenueBps, "cost of revenue rate", 0, 100_000);
  uniqueIds(plan.expenses); uniqueIds(plan.oneTimeCosts); uniqueIds(plan.raises);
  for (const expense of plan.expenses) {
    integer(expense.monthlyAmountMinor, "monthly expense"); date(expense.startDate);
    if (!expense.category.trim()) throw new Error("Expense category is required");
    if (expense.endExclusive && date(expense.endExclusive) <= expense.startDate) throw new Error("Expense end must follow start");
  }
  for (const event of [...plan.oneTimeCosts, ...plan.raises]) {
    if (date(event.date) < plan.startDate) throw new Error("Future cash events cannot precede the plan");
    integer(event.amountMinor, "cash event amount");
    if ("feesMinor" in event) {
      integer(event.feesMinor, "fundraising fees");
      if (event.feesMinor > event.amountMinor) throw new Error("Fundraising fees exceed proceeds");
    } else if (event.kind !== "operating" && event.kind !== "capital") throw new Error("Invalid one-time cost kind");
  }
  const revenue = forecastRevenue(plan, plan.revenue);
  const headcount = forecastHeadcountCost(plan, plan.employees);
  const rows = timeline.map(period => {
    const sales = revenue.rows[period.index];
    const payroll = headcount[period.index];
    const costs = plan.expenses.map(expense => {
      const start = expense.startDate > period.start ? expense.startDate : period.start;
      const end = expense.endExclusive && expense.endExclusive < period.endExclusive ? expense.endExclusive : period.endExclusive;
      return { id: expense.id, category: expense.category,
        amountMinor: multiply(expense.monthlyAmountMinor, Math.max(0, daysBetween(start, end)), daysBetween(period.start, period.endExclusive)) };
    });
    const operatingExpensesMinor = sum(...costs.map(item => item.amountMinor));
    const costOfRevenueMinor = multiply(sales.revenueMinor, plan.costOfRevenueBps);
    const oneTime = plan.oneTimeCosts.filter(item => item.date >= period.start && item.date < period.endExclusive);
    const oneTimeOperatingMinor = sum(...oneTime.filter(item => item.kind === "operating").map(item => item.amountMinor));
    const capitalSpendMinor = sum(...oneTime.filter(item => item.kind === "capital").map(item => item.amountMinor));
    const raises = plan.raises.filter(item => item.date >= period.start && item.date < period.endExclusive);
    const financingMinor = sum(...raises.map(item => sum(item.amountMinor, -item.feesMinor)));
    const grossBurnMinor = sum(payroll.totalMinor, operatingExpensesMinor, costOfRevenueMinor, oneTimeOperatingMinor);
    return { ...period, revenue: sales, payroll, expenses: costs, operatingExpensesMinor, costOfRevenueMinor,
      oneTimeOperatingMinor, capitalSpendMinor, financingMinor, grossBurnMinor,
      netBurnMinor: sum(grossBurnMinor, -sales.collectionsMinor),
      operatingProfitMinor: sum(sales.revenueMinor, -grossBurnMinor) };
  });
  const events: ForecastCashEvent[] = rows.flatMap(row => [
    { id: `operations:collections:${row.index}`, label: "Projected customer collections", date: row.start, driver: "inflow" as const,
      change: "increase" as const, amountMinor: row.revenue.collectionsMinor, basis: plan.basis },
    { id: `operations:costs:${row.index}`, label: "Projected payroll, operating expenses and cost of revenue", date: row.start, driver: "outflow" as const,
      change: "increase" as const, amountMinor: sum(row.grossBurnMinor, -row.oneTimeOperatingMinor), basis: plan.basis },
  ]);
  for (const item of plan.oneTimeCosts) events.push({ id: `cost:${item.id}`, label: `${item.kind} one-time cost: ${item.id}`,
    date: item.date, driver: "outflow", change: "increase", amountMinor: item.amountMinor, basis: plan.basis });
  for (const item of plan.raises) {
    events.push({ id: `raise:${item.id}`, label: `Assumed financing: ${item.id}`, date: item.date, driver: "inflow",
      change: "increase", amountMinor: item.amountMinor, basis: plan.basis });
    events.push({ id: `raise-fees:${item.id}`, label: `Assumed financing fees: ${item.id}`, date: item.date, driver: "outflow",
      change: "increase", amountMinor: item.feesMinor, basis: plan.basis });
  }
  const cash = buildCashForecast(actuals, { currency: plan.currency, startDate: plan.startDate,
    horizon: { periods: plan.months, granularity: "month" },
    baseline: { method: "explicit_periodic", inflowsMinor: 0, outflowsMinor: 0, basis: plan.basis },
    events, thresholds: { reserveMinor: plan.reserveMinor },
    assumptions: [{ id: "operating-plan", description: "Complete supplied monthly operating plan; zero baseline prevents double-counting component flows", basis: plan.basis }],
  });
  return { version: "operating-plan-v1" as const, status: cash.status, currency: plan.currency, basis: plan.basis,
    cash, rows, pendingCollectionsMinor: revenue.pendingCollectionsMinor,
    qualifications: [...cash.qualifications, ...revenue.qualifications, "payroll_and_expenses_prorated_by_calendar_days",
      "payroll_tax_on_salary_and_commissions_benefits_untaxed", "operating_costs_paid_in_month_incurred",
      "financing_and_capital_spend_excluded_from_operating_burn", "operating_profit_excludes_depreciation_interest_and_income_tax",
      ...(plan.startDate > actuals.evaluatedAt.slice(0, 10) ? ["activity_between_cash_observation_and_plan_start_is_not_modeled"] : [])] };
}

export function forecastBurn(forecast: OperatingForecast) {
  return { status: "conditional" as const, currency: forecast.currency, basis: forecast.basis,
    rows: forecast.rows.map(row => ({ start: row.start, endExclusive: row.endExclusive,
      grossBurnMinor: row.grossBurnMinor, netBurnMinor: row.netBurnMinor, collectionsMinor: row.revenue.collectionsMinor })),
    qualifications: forecast.qualifications };
}

/** Period-boundary resolution; never extrapolates beyond the modeled horizon. */
export function calculateForecastRunway(forecast: CashForecast, minimumCashMinor = 0) {
  integer(minimumCashMinor, "minimum cash");
  if (!forecast.derived || forecast.baseline.status === "unavailable") return {
    status: "unavailable" as const, crossingDate: null, months: null, atLeastMonths: null, minimumCashMinor,
  };
  const points = [{ date: forecast.startDate, cash: forecast.startingPosition.valueMinor! },
    ...forecast.trajectory.map(row => ({ date: row.endExclusive, cash: row.endingCashMinor }))];
  const crossing = points.find(point => point.cash <= minimumCashMinor);
  const elapsedMonths = (value: string) => daysBetween(forecast.startDate, value) * 400 / 12175;
  return { status: crossing ? "projected_within_horizon" as const : "beyond_horizon" as const,
    crossingDate: crossing?.date ?? null, months: crossing ? elapsedMonths(crossing.date) : null,
    atLeastMonths: crossing ? null : elapsedMonths(points.at(-1)!.date), minimumCashMinor };
}

export function forecastRunwayThreshold(forecast: CashForecast, months: number, minimumCashMinor = 0) {
  integer(months, "runway threshold months", 0, 120);
  const runway = calculateForecastRunway(forecast, minimumCashMinor);
  if (!runway.crossingDate) return { status: "unavailable" as const, crossingDate: null, months,
    reason: runway.status === "unavailable" ? "cash_or_baseline_unavailable" : "cash_threshold_not_reached_within_horizon" };
  const boundaries = [forecast.startDate, ...forecast.trajectory.map(row => row.endExclusive)];
  return { status: "projected_within_horizon" as const, months,
    crossingDate: boundaries.find(value => addMonths(value, months) >= runway.crossingDate!)!,
    cashThresholdDate: runway.crossingDate, reason: null };
}

export function estimateFundraisingStartDate(forecast: CashForecast, options: {
  desiredRunwayAtCloseMonths: number; fundraisingDurationMonths: number; minimumCashMinor?: number;
}) {
  integer(options.desiredRunwayAtCloseMonths, "desired runway at close", 0, 120);
  integer(options.fundraisingDurationMonths, "fundraising duration", 0, 120);
  const runway = calculateForecastRunway(forecast, options.minimumCashMinor);
  if (!runway.crossingDate) return { status: "unavailable" as const, targetCloseDate: null, latestStartDate: null,
    recommendedStartDate: null, reason: "cash_threshold_date_unavailable" };
  const targetCloseDate = addMonths(runway.crossingDate, -options.desiredRunwayAtCloseMonths);
  const latestStartDate = addMonths(targetCloseDate, -options.fundraisingDurationMonths);
  return { status: "conditional" as const, targetCloseDate, latestStartDate,
    recommendedStartDate: latestStartDate < forecast.startDate ? forecast.startDate : latestStartDate,
    overdueAtForecastStart: latestStartDate < forecast.startDate, reason: null,
    method: "cash_threshold_date_minus_pre_raise_runway_at_close_minus_fundraising_duration" };
}

export function reachProfitability(forecast: OperatingForecast, consecutiveMonths = 3) {
  integer(consecutiveMonths, "profitability confirmation months", 1, 120);
  const first = forecast.rows.findIndex((_, index) => index + consecutiveMonths <= forecast.rows.length &&
    forecast.rows.slice(index, index + consecutiveMonths).every(row => row.operatingProfitMinor >= 0));
  return { status: first < 0 ? "not_reached_within_horizon" as const : "conditional" as const,
    firstMonth: first < 0 ? null : forecast.rows[first].start, consecutiveMonths,
    method: "first_window_of_non_negative_monthly_operating_profit_excluding_financing",
    qualifications: forecast.qualifications };
}
