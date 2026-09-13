/**
 * Legacy onboarding estimate over founder-supplied assumptions, NOT company actuals.
 *
 * Sam must not import this module or use it as authoritative financial state.
 * Connected financial answers come from actuals.ts and the run-local financial
 * session. This calculator remains only for the existing onboarding UI.
 */

export interface RunwayInput {
  /** Total cash available today, in USD. */
  cashOnHandUsd: number;
  /** Average monthly revenue, in USD. */
  monthlyRevenueUsd: number;
  /** Average monthly operating expenses, in USD. */
  monthlyExpensesUsd: number;
  /** Date the cash balance is accurate as of. Defaults to now. */
  asOf?: Date;
}

export type RunwayStatus =
  | "cash_flow_positive"
  | "healthy"
  | "warning"
  | "critical";

export interface RunwayResult {
  /** Expenses minus revenue. Negative means the company is net cash positive. */
  netMonthlyBurnUsd: number;
  /** Months of cash left, or `null` when the company is not burning cash. */
  runwayMonths: number | null;
  /** ISO date (YYYY-MM-DD) cash hits zero, or `null` when not burning cash. */
  zeroCashDate: string | null;
  status: RunwayStatus;
}

/** Below this many months of runway, a founder should already be fundraising. */
const CRITICAL_MONTHS = 3;
const WARNING_MONTHS = 6;

const roundToCents = (value: number): number => Math.round(value * 100) / 100;

const classify = (runwayMonths: number): RunwayStatus => {
  if (runwayMonths < CRITICAL_MONTHS) return "critical";
  if (runwayMonths < WARNING_MONTHS) return "warning";
  return "healthy";
};

const addMonths = (from: Date, months: number): Date => {
  const result = new Date(from.getTime());
  const wholeMonths = Math.floor(months);
  const remainderDays = Math.round((months - wholeMonths) * 30);
  result.setUTCMonth(result.getUTCMonth() + wholeMonths);
  result.setUTCDate(result.getUTCDate() + remainderDays);
  return result;
};

/**
 * Calculates an illustrative estimate from supplied onboarding assumptions.
 * @deprecated Not authoritative company runway; never expose this as a Sam tool.
 *
 * @throws when any input is negative or non-finite.
 */
export const calculateRunway = (input: RunwayInput): RunwayResult => {
  const { cashOnHandUsd, monthlyRevenueUsd, monthlyExpensesUsd } = input;

  for (const [name, value] of Object.entries({
    cashOnHandUsd,
    monthlyRevenueUsd,
    monthlyExpensesUsd,
  })) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${name} must be a non-negative finite number.`);
    }
  }

  const netMonthlyBurnUsd = roundToCents(monthlyExpensesUsd - monthlyRevenueUsd);

  if (netMonthlyBurnUsd <= 0) {
    return {
      netMonthlyBurnUsd,
      runwayMonths: null,
      zeroCashDate: null,
      status: "cash_flow_positive",
    };
  }

  const exactMonths = cashOnHandUsd / netMonthlyBurnUsd;
  const runwayMonths = Math.round(exactMonths * 10) / 10;
  const asOf = input.asOf ?? new Date();

  return {
    netMonthlyBurnUsd,
    runwayMonths,
    zeroCashDate: addMonths(asOf, exactMonths).toISOString().slice(0, 10),
    status: classify(runwayMonths),
  };
};
