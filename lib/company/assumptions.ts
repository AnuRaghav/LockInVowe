import { minorUnitExponent } from "@/lib/source/money";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * The persistent company financial model (see PROJECT_OVERVIEW.md).
 *
 * Keys are deliberately a fixed, known set rather than free-form strings:
 * the onboarding wizard, the forecasting engine, and the agent all need to
 * agree on what "mrr" means. Add a key here before anything writes it.
 */
export const ASSUMPTION_KEYS = {
  cashOnHandUsd: "cash_on_hand_usd",
  mrrUsd: "mrr_usd",
  monthlyExpensesUsd: "monthly_expenses_usd",
  monthlyGrowthTargetPct: "monthly_growth_target_pct",
  minimumRunwayMonths: "minimum_runway_months",
  plannedHires: "planned_hires",
  monthlyPayrollCostUsd: "monthly_payroll_cost_usd",
} as const;

export type AssumptionKey = (typeof ASSUMPTION_KEYS)[keyof typeof ASSUMPTION_KEYS];

export interface PlannedHire {
  title: string;
  startDate: string;
  monthlyCostUsd: number;
}

/** Shape of the onboarding wizard's founder-entered answers. */
export interface OnboardingAnswers {
  mrrUsd: number;
  monthlyExpensesUsd: number;
  monthlyGrowthTargetPct: number;
  minimumRunwayMonths: number;
  plannedHires: PlannedHire[];
}

export type AssumptionSource = "onboarding" | "derived" | "founder";

/** All assumptions currently on file for a company, keyed by {@link AssumptionKey}. */
export type CompanyAssumptions = Partial<Record<AssumptionKey, unknown>>;

/** Reads every assumption on file for a company. */
export const getCompanyAssumptions = async (
  companyId: string
): Promise<CompanyAssumptions> => {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("company_assumptions")
    .select("key, value")
    .eq("company_id", companyId);

  if (error) throw error;

  return Object.fromEntries((data ?? []).map((row) => [row.key, row.value]));
};

/** Upserts one assumption. `value` must be JSON-serializable. */
export const setCompanyAssumption = async (
  companyId: string,
  key: AssumptionKey,
  value: unknown,
  source: AssumptionSource = "onboarding"
): Promise<void> => {
  const supabase = createServiceClient();
  const { error } = await supabase.from("company_assumptions").upsert(
    {
      company_id: companyId,
      key,
      value: value as never,
      source,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "company_id,key" }
  );

  if (error) throw error;
};

/** Account kinds counted as cash for runway purposes - not credit, not investment. */
const CASH_ACCOUNT_KINDS = ["checking", "savings"] as const;

/**
 * Derives current cash on hand from the Source Layer (see
 * lib/source/store.ts) and stores it as a `derived` assumption. Call this
 * once accounts are connected/synced, before asking the founder anything the
 * data already answers.
 *
 * Reads the latest {@link https://.../source_balance_observations} per
 * checking/savings account and sums balances already denominated in USD -
 * mixed-currency cash isn't a case the MVP onboarding flow handles yet.
 */
export const deriveCashFromBankAccounts = async (
  companyId: string
): Promise<number | null> => {
  const supabase = createServiceClient();

  const { data: accounts, error: accountsError } = await supabase
    .from("source_accounts")
    .select("id")
    .eq("company_id", companyId)
    .in("kind", CASH_ACCOUNT_KINDS);

  if (accountsError) throw accountsError;
  if (!accounts || accounts.length === 0) return null;

  const accountIds = accounts.map((account) => account.id);

  const { data: observations, error: observationsError } = await supabase
    .from("source_balance_observations")
    .select("account_id, current_minor, currency, observed_at")
    .eq("company_id", companyId)
    .in("account_id", accountIds)
    .order("observed_at", { ascending: false });

  if (observationsError) throw observationsError;
  if (!observations || observations.length === 0) return null;

  // First row per account, since observations are ordered newest first.
  const latestByAccount = new Map<string, (typeof observations)[number]>();
  for (const observation of observations) {
    if (!latestByAccount.has(observation.account_id)) {
      latestByAccount.set(observation.account_id, observation);
    }
  }

  const cashOnHandUsd = Array.from(latestByAccount.values())
    .filter((observation) => observation.currency === "USD")
    .reduce(
      (sum, observation) =>
        sum + observation.current_minor / 10 ** minorUnitExponent(observation.currency),
      0
    );

  await setCompanyAssumption(companyId, ASSUMPTION_KEYS.cashOnHandUsd, cashOnHandUsd, "derived");
  return cashOnHandUsd;
};

/**
 * Derives current monthly payroll cost from synced Gusto payroll runs and
 * stores it as a `derived` assumption. Uses the most recent processed run's
 * employer cost as a proxy for "this month's payroll" - good enough for the
 * MVP; a real implementation would annualize or average across runs of
 * different cadences (weekly/biweekly/monthly).
 */
export const deriveMonthlyPayrollCostFromGusto = async (
  companyId: string
): Promise<number | null> => {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("payroll_runs")
    .select("total_employer_cost_usd, check_date")
    .eq("company_id", companyId)
    .order("check_date", { ascending: false })
    .limit(1);

  if (error) throw error;
  if (!data || data.length === 0) return null;

  const monthlyPayrollCostUsd = data[0].total_employer_cost_usd ?? 0;

  await setCompanyAssumption(
    companyId,
    ASSUMPTION_KEYS.monthlyPayrollCostUsd,
    monthlyPayrollCostUsd,
    "derived"
  );
  return monthlyPayrollCostUsd;
};

/** Saves the founder-entered onboarding answers as structured assumptions. */
export const saveOnboardingAnswers = async (
  companyId: string,
  answers: OnboardingAnswers
): Promise<void> => {
  await Promise.all([
    setCompanyAssumption(companyId, ASSUMPTION_KEYS.mrrUsd, answers.mrrUsd),
    setCompanyAssumption(
      companyId,
      ASSUMPTION_KEYS.monthlyExpensesUsd,
      answers.monthlyExpensesUsd
    ),
    setCompanyAssumption(
      companyId,
      ASSUMPTION_KEYS.monthlyGrowthTargetPct,
      answers.monthlyGrowthTargetPct
    ),
    setCompanyAssumption(
      companyId,
      ASSUMPTION_KEYS.minimumRunwayMonths,
      answers.minimumRunwayMonths
    ),
    setCompanyAssumption(companyId, ASSUMPTION_KEYS.plannedHires, answers.plannedHires),
  ]);

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("companies")
    .upsert(
      { id: companyId, name: "Development company", onboarding_completed_at: new Date().toISOString() },
      { onConflict: "id" }
    );

  if (error) throw error;
};
