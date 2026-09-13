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

/**
 * Derives current cash on hand from synced bank balances and stores it as a
 * `derived` assumption. Call this once bank accounts are connected/synced,
 * before asking the founder anything the data already answers.
 */
export const deriveCashFromBankAccounts = async (
  companyId: string
): Promise<number | null> => {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("bank_accounts")
    .select("current_balance_usd, type")
    .eq("company_id", companyId);

  if (error) throw error;
  if (!data || data.length === 0) return null;

  const cashOnHandUsd = data
    .filter((account) => account.type === "depository")
    .reduce((sum, account) => sum + (account.current_balance_usd ?? 0), 0);

  await setCompanyAssumption(companyId, ASSUMPTION_KEYS.cashOnHandUsd, cashOnHandUsd, "derived");
  return cashOnHandUsd;
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
