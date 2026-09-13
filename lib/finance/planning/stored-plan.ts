import { z } from "zod";
import type { FinancialActuals } from "../actuals";
import { decimalToMinor } from "@/lib/source/money";
import { forecastCash, type OperatingPlan } from "./forecast";
import { forecastHeadcountCost, type PlannedEmployee } from "./headcount";
import { addMonths, date, multiply, periods, sum } from "./math";
import { planningRequestSchema, type PlanningRequest } from "./stored-schema";
import { assertPlanningScope, type StoredAssumption, type StoredPlanningRecords } from "./stored-source";

const usd = z.number().finite().nonnegative();
const hireSchema = z.object({ title: z.string(), startDate: z.string(), monthlyCostUsd: usd });
const teamSchema = hireSchema.extend({ name: z.string() });

export interface StoredInput<T> {
  value: T;
  source: string;
  reference: string;
  updatedAt: string;
}

/** Pure adapter: saved financial inputs remain assumptions; actual starting cash stays Source-derived. */
export function buildStoredCompanyPlan(companyId: string, actuals: FinancialActuals, records: StoredPlanningRecords, rawOptions: PlanningRequest) {
  assertPlanningScope(companyId, records);
  if (actuals.companyId !== companyId) throw new Error("Actuals scope mismatch");
  const options = planningRequestSchema.parse(rawOptions);
  const evaluatedDate = actuals.evaluatedAt.slice(0, 10);
  const startDate = options.startDate ?? (evaluatedDate.endsWith("-01") ? evaluatedDate : addMonths(`${evaluatedDate.slice(0, 7)}-01`, 1));
  if (startDate < evaluatedDate) throw new Error("Forecast cannot start before evaluation");
  const window = { startDate, months: options.months }; periods(window);
  const missing: Array<{ field: string; reason: string }> = [];
  const qualifications = ["stored_usd_assumptions_not_observed_actuals", "planning_and_source_reads_are_not_one_database_transaction"];
  const byKey = new Map<string, StoredAssumption>();
  for (const row of records.assumptions) {
    if (byKey.has(row.key)) throw new Error("Duplicate stored assumption key");
    byKey.set(row.key, row);
  }
  const read = <T>(key: string, schema: z.ZodType<T>): StoredInput<T> | null => {
    const row = byKey.get(key);
    if (!row) return null;
    const parsed = schema.safeParse(row.value);
    if (!parsed.success) { missing.push({ field: key, reason: "invalid_stored_value" }); return null; }
    return { value: parsed.data, source: row.source, reference: `company_assumptions:${row.id}`, updatedAt: row.updated_at };
  };
  const mrr = read("mrr_usd", usd);
  const expenses = read("monthly_expenses_usd", usd);
  const growth = read("monthly_growth_target_pct", z.number().finite().nonnegative());
  const runwayFloor = read("minimum_runway_months", z.number().int().min(1).max(120));
  const savedTeam = read("current_team", z.array(teamSchema));
  const savedHires = read("planned_hires", z.array(hireSchema));
  const monthlyPayroll = read("monthly_payroll_cost_usd", usd);
  const supplements = options.assumptions;
  const connectedPayroll = new Map(records.payrollConnections.filter(row => row.status === "active").map(row => [row.id, row]));
  const rawEmployees = records.employees.filter(employee => connectedPayroll.has(employee.payroll_connection_id) &&
    (employee.employment_status === "active" || employee.employment_status === "onboarding"));
  const employees: PlannedEmployee[] = [];
  const payrollReferences: StoredInput<unknown>[] = [];
  let payrollAvailable = false;
  let aggregatePayroll: OperatingPlan["aggregatePayroll"];
  if (savedTeam && savedTeam.value.length > 0) {
    payrollAvailable = true; payrollReferences.push(savedTeam);
    savedTeam.value.forEach((member, index) => {
      try {
        const start = member.startDate ? date(member.startDate) : startDate;
        employees.push({ id: `saved-team:${index}`, startDate: start, monthlyEmployerCostMinor: decimalToMinor(member.monthlyCostUsd, "USD") });
        if (!member.startDate) qualifications.push("current_team_start_missing_assumed_active_at_forecast_start");
      } catch { missing.push({ field: `current_team.${index}`, reason: "invalid_compensation_or_start_date" }); }
    });
  } else if (monthlyPayroll) {
    payrollAvailable = true; payrollReferences.push(monthlyPayroll);
    aggregatePayroll = { monthlyCostMinor: decimalToMinor(monthlyPayroll.value, "USD"), headcount: null };
    qualifications.push("saved_monthly_payroll_used_as_aggregate_assumption_individual_headcount_unavailable");
    if (monthlyPayroll.source === "derived") qualifications.push("derived_payroll_is_an_estimate_not_a_future_payroll_schedule");
  } else if (rawEmployees.length) {
    const burden = supplements?.payrollBurden;
    payrollAvailable = true;
    if (!burden) missing.push({ field: "assumptions.payrollBurden", reason: "gusto_salary_does_not_include_taxes_benefits_or_commissions" });
    for (const employee of rawEmployees) {
      const connection = connectedPayroll.get(employee.payroll_connection_id)!;
      payrollReferences.push({ value: { employeeId: employee.id, annualSalaryUsd: employee.annual_salary_usd,
        hourlyRateUsd: employee.hourly_rate_usd, startDate: employee.start_date }, source: "gusto_compensation_snapshot",
        reference: `payroll_employees:${employee.id}`, updatedAt: employee.updated_at });
      qualifications.push(`payroll_connection_last_synced:${connection.last_synced_at ?? "unknown"}`);
      if (!employee.start_date) { missing.push({ field: `employees.${employee.id}.startDate`, reason: "missing_gusto_start_date" }); continue; }
      try {
        date(employee.start_date);
        if (employee.termination_date) { date(employee.termination_date); missing.push({ field: `employees.${employee.id}.endDate`, reason: "termination_date_requires_end_exclusive_confirmation" }); continue; }
        let monthlyCostMinor: number | null = null;
        if (employee.payment_unit === "year" && employee.annual_salary_usd !== null)
          monthlyCostMinor = multiply(decimalToMinor(usd.parse(employee.annual_salary_usd), "USD"), 1, 12);
        else if (employee.payment_unit === "hour" && employee.hourly_rate_usd !== null && burden?.hoursPerMonth !== undefined)
          monthlyCostMinor = multiply(decimalToMinor(usd.parse(employee.hourly_rate_usd), "USD"), burden.hoursPerMonth, 1);
        if (monthlyCostMinor === null) { missing.push({ field: `employees.${employee.id}.compensation`, reason: "missing_salary_or_hourly_schedule" }); continue; }
        if (burden) employees.push({ id: `gusto:${employee.id}`, startDate: employee.start_date,
          annualSalaryMinor: employee.payment_unit === "year" ? decimalToMinor(employee.annual_salary_usd!, "USD") : multiply(monthlyCostMinor, 12, 1),
          payrollTaxBps: burden.payrollTaxBps, monthlyBenefitsMinor: burden.monthlyBenefitsMinor, monthlyCommissionMinor: burden.monthlyCommissionMinor });
      } catch { missing.push({ field: `employees.${employee.id}`, reason: "invalid_gusto_compensation_or_dates" }); }
    }
  }
  if (!payrollAvailable) missing.push({ field: "payroll", reason: "no_saved_payroll_cost_or_usable_current_team" });
  const existingPayroll = sum(forecastHeadcountCost(window, employees)[0].totalMinor, aggregatePayroll?.monthlyCostMinor ?? 0);
  if (savedHires) {
    savedHires.value.forEach((hire, index) => {
      try {
        date(hire.startDate);
        // An old plan is not evidence this person was hired; don't double-count against current payroll.
        if (hire.startDate < evaluatedDate) {
          missing.push({ field: `planned_hires.${index}`, reason: "past_planned_hire_requires_reconciliation_with_current_team" }); return;
        }
        employees.push({ id: `saved-hire:${index}`, startDate: hire.startDate, monthlyEmployerCostMinor: decimalToMinor(hire.monthlyCostUsd, "USD") });
      } catch { missing.push({ field: `planned_hires.${index}`, reason: "invalid_compensation_or_start_date" }); }
    });
  } else missing.push({ field: "planned_hires", reason: "not_saved_empty_list_must_be_explicit" });

  if (!mrr) missing.push({ field: "mrr_usd", reason: "no_usable_saved_mrr" });
  else if (mrr.source === "derived") {
    qualifications.push("stored_derived_mrr_is_a_trailing_cash_revenue_proxy_not_subscription_mrr");
    if (!supplements?.useStoredRevenueProxy) missing.push({ field: "assumptions.useStoredRevenueProxy", reason: "explicit_acceptance_required_for_revenue_proxy" });
  }
  if (!expenses) missing.push({ field: "monthly_expenses_usd", reason: "no_usable_saved_expenses" });
  if (growth) qualifications.push("saved_growth_target_is_not_automatically_used_as_new_sales_growth");
  const required = ["revenue", "collectionRateBps", "collectionLagMonths", "openingReceivableCollectionsMinor",
    "costOfRevenueBps", "expenseScope", "oneTimeCosts", "raises"] as const;
  for (const field of required) if (supplements?.[field] === undefined)
    missing.push({ field: `assumptions.${field}`, reason: field === "expenseScope" ? "saved_expenses_do_not_record_whether_payroll_is_included" : "not_stored_supply_explicit_planning_assumption" });
  const cash = actuals.currencies.find(item => item.currency === "USD")?.cash ?? null;
  if (cash?.valueMinor == null) missing.push({ field: "cash", reason: "observed_usd_cash_unavailable_saved_cash_cannot_replace_it" });
  const toMinor = (value: StoredInput<number> | null) => value ? { ...value, value: decimalToMinor(value.value, "USD") } : null;
  const inputs = { startingMrrMinor: toMinor(mrr), monthlyExpensesMinor: toMinor(expenses), growthTargetPct: growth,
    minimumRunwayMonths: runwayFloor, currentTeam: savedTeam, plannedHires: savedHires,
    monthlyPayrollCostMinor: toMinor(monthlyPayroll), payrollEvidence: payrollReferences, cash };
  let plan: OperatingPlan | null = null;
  let forecast: ReturnType<typeof forecastCash> | null = null;
  const nonPayrollExpense = expenses ? sum(decimalToMinor(expenses.value, "USD"), supplements?.expenseScope === "includes_payroll_excludes_cogs" ? -existingPayroll : 0) : null;
  if (nonPayrollExpense !== null && nonPayrollExpense < 0) missing.push({ field: "assumptions.expenseScope", reason: "payroll_exceeds_saved_total_expenses" });
  if (missing.length === 0 && supplements) {
    plan = { ...window, currency: "USD", basis: { kind: "management_assumption", label: supplements.label,
      reference: `stored-company-plan:${companyId}:${actuals.evaluatedAt}` },
      revenue: { startingMrrMinor: decimalToMinor(mrr!.value, "USD"), ...supplements.revenue!,
        collectionRateBps: supplements.collectionRateBps!, collectionLagMonths: supplements.collectionLagMonths!,
        openingReceivableCollectionsMinor: supplements.openingReceivableCollectionsMinor! },
      employees, aggregatePayroll, expenses: [{ id: "saved-operating-expenses", category: "saved operating expenses excluding payroll and COGS",
        monthlyAmountMinor: nonPayrollExpense!, startDate }], costOfRevenueBps: supplements.costOfRevenueBps!,
      oneTimeCosts: supplements.oneTimeCosts!, raises: supplements.raises! };
    forecast = forecastCash(actuals, plan);
  }
  return { companyId, evaluatedAt: actuals.evaluatedAt, currency: "USD" as const, window,
    status: forecast ? "conditional" as const : "needs_inputs" as const, inputs, plan, forecast, missing,
    qualifications: [...new Set([...qualifications, ...(forecast?.qualifications ?? [])])] };
}
