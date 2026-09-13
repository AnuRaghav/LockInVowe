import type { ForecastBasis } from "../forecast";
import { date, integer, money, multiply, sum } from "./math";

export interface MonthlyMetricInputs {
  currency: string;
  month: string;
  basis: ForecastBasis;
  openingMrrMinor?: number | null;
  newMrrMinor?: number | null;
  expansionMrrMinor?: number | null;
  churnedMrrMinor?: number | null;
  contractedMrrMinor?: number | null;
  revenueMinor?: number | null;
  costOfRevenueMinor?: number | null;
  acquisitionSpendMinor?: number | null;
  newCustomers?: number | null;
  activeCustomers?: number | null;
  /** Customer/logo churn, NOT revenue churn. */
  customerChurnBps?: number | null;
  netOperatingBurnMinor?: number | null;
  averageEmployees?: number | null;
  collectionsMinor?: number | null;
}

export interface PlanningMetric {
  status: "conditional" | "unavailable";
  value: number | null;
  unit: "minor" | "ratio" | "months";
  method: string;
  reason: string | null;
}

/** Explicit single-currency monthly inputs only. No inference from bank transactions. */
export function calculateSaasMetrics(input: MonthlyMetricInputs) {
  date(input.month);
  if (!input.month.endsWith("-01") || !/^[A-Z]{3}$/.test(input.currency) || !input.basis.label.trim())
    throw new Error("Metrics require a calendar month, currency, and basis");
  for (const [key, value] of Object.entries(input)) {
    if (value == null || typeof value !== "number") continue;
    if (key === "averageEmployees") {
      if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) throw new Error("Invalid average employees");
    } else integer(value, key, key === "netOperatingBurnMinor" ? -Number.MAX_SAFE_INTEGER : 0,
      key === "customerChurnBps" ? 10_000 : Number.MAX_SAFE_INTEGER);
  }
  const metric = (value: number | null, unit: PlanningMetric["unit"], method: string, reason = "missing_inputs"): PlanningMetric => {
    if (value !== null && !Number.isFinite(value)) throw new Error("Unsafe metric result");
    return { status: value === null ? "unavailable" : "conditional", value, unit, method, reason: value === null ? reason : null };
  };
  const ratio = (numerator: number | null | undefined, denominator: number | null | undefined, method: string,
    unit: PlanningMetric["unit"] = "ratio") => numerator == null || denominator == null
      ? metric(null, unit, method) : denominator <= 0
        ? metric(null, unit, method, "non_positive_denominator") : metric(numerator / denominator, unit, method);
  const movement = [input.openingMrrMinor, input.newMrrMinor, input.expansionMrrMinor, input.churnedMrrMinor, input.contractedMrrMinor];
  const complete = movement.every(value => value != null);
  if (input.openingMrrMinor != null && input.churnedMrrMinor != null && input.contractedMrrMinor != null &&
      sum(input.churnedMrrMinor, input.contractedMrrMinor) > input.openingMrrMinor) throw new Error("MRR losses exceed opening MRR");
  const retained = input.openingMrrMinor != null && input.churnedMrrMinor != null && input.contractedMrrMinor != null
    ? sum(input.openingMrrMinor, -input.churnedMrrMinor, -input.contractedMrrMinor) : null;
  const mrr = complete ? sum(input.openingMrrMinor!, input.newMrrMinor!, input.expansionMrrMinor!, -input.churnedMrrMinor!, -input.contractedMrrMinor!) : null;
  const netNewMrr = mrr === null ? null : sum(mrr, -input.openingMrrMinor!);
  const grossProfit = input.revenueMinor != null && input.costOfRevenueMinor != null ? sum(input.revenueMinor, -input.costOfRevenueMinor) : null;
  const grossMargin = ratio(grossProfit, input.revenueMinor, "(revenue - cost of revenue) / revenue");
  const cac = ratio(input.acquisitionSpendMinor, input.newCustomers, "fully loaded acquisition spend / new customers", "minor");
  const grossProfitPerCustomer = ratio(grossProfit, input.activeCustomers, "monthly gross profit / active customers", "minor");
  const ltv = ratio(grossProfitPerCustomer.value, input.customerChurnBps == null ? null : input.customerChurnBps / 10_000,
    "monthly gross profit per customer / monthly customer churn rate", "minor");
  if (grossProfit !== null && grossProfit < 0) Object.assign(ltv, metric(null, "minor", ltv.method, "negative_gross_profit"));
  const perEmployee = ratio(input.revenueMinor, input.averageEmployees, "monthly revenue / average monthly employees", "minor");
  // Monetary unit economics are rounded to minor units at the output boundary.
  const rounded = (value: PlanningMetric) => value.value === null ? value : { ...value, value: money(Math.round(value.value)) };
  return {
    currency: input.currency, month: input.month, basis: input.basis,
    metrics: {
      mrr: metric(mrr, "minor", "opening + new + expansion - churn - contraction"),
      arr: metric(mrr === null ? null : multiply(mrr, 12, 1), "minor", "ending MRR * 12"),
      mrrGrowthRate: ratio(netNewMrr, input.openingMrrMinor, "net new MRR / opening MRR"),
      newMrr: metric(input.newMrrMinor ?? null, "minor", "supplied new customer MRR"),
      expansionMrr: metric(input.expansionMrrMinor ?? null, "minor", "supplied existing customer expansion MRR"),
      churnedMrr: metric(input.churnedMrrMinor ?? null, "minor", "supplied churned MRR"),
      netRevenueRetention: ratio(retained === null || input.expansionMrrMinor == null ? null : sum(retained, input.expansionMrrMinor), input.openingMrrMinor,
        "(opening MRR - churn - contraction + expansion) / opening MRR; excludes new customers"),
      grossRevenueRetention: ratio(retained, input.openingMrrMinor, "(opening MRR - churn - contraction) / opening MRR"),
      grossMargin, cac: rounded(cac), ltv: rounded(ltv),
      cacPaybackMonths: ratio(cac.value, grossProfitPerCustomer.value, "CAC / monthly gross profit per customer", "months"),
      burnMultiple: ratio(input.netOperatingBurnMinor == null ? null : Math.max(0, input.netOperatingBurnMinor),
        netNewMrr === null ? null : multiply(netNewMrr, 12, 1), "non-negative monthly net operating cash burn / net new ARR in the same month"),
      revenuePerEmployee: rounded(perEmployee),
      cashConversion: ratio(input.collectionsMinor, input.revenueMinor, "monthly customer cash collections / monthly revenue; may exceed 1 with lagged collections"),
      collections: metric(input.collectionsMinor ?? null, "minor", "supplied customer cash collections; excludes financing"),
    },
    qualifications: ["conditional_on_supplied_monthly_inputs_not_observed_actuals", "ltv_is_a_constant_churn_gross_profit_estimate",
      "acquisition_spend_and_new_customers_must_cover_the_same_cohort_and_period", "cash_conversion_is_not_inventory_cash_conversion_cycle"],
  };
}
