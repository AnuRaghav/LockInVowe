import { minorUnitExponent } from "@/lib/source/money";
import type { SourceProviderId } from "@/lib/source";
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
  currentTeam: "current_team",
} as const;

export type AssumptionKey = (typeof ASSUMPTION_KEYS)[keyof typeof ASSUMPTION_KEYS];

export interface PlannedHire {
  title: string;
  startDate: string;
  monthlyCostUsd: number;
}

/**
 * Someone already on payroll. Kept apart from {@link PlannedHire}: planned
 * hires are cost the forecast adds on top, while the current team is cost
 * already being paid, so merging them would double-count payroll.
 */
export interface TeamMember extends PlannedHire {
  name: string;
}

/** Shape of the onboarding wizard's founder-entered answers. */
export interface OnboardingAnswers {
  mrrUsd: number;
  monthlyExpensesUsd: number;
  monthlyGrowthTargetPct: number;
  minimumRunwayMonths: number;
  plannedHires: PlannedHire[];
  currentTeam: TeamMember[];
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

/** Trailing window of payroll runs averaged into a monthly cost. */
const PAYROLL_WINDOW_DAYS = 90;
const DAYS_PER_MONTH = 365.25 / 12;
/** Standard full-time hours per month, for hourly employees with no run history. */
const HOURS_PER_MONTH = 2080 / 12;

const monthlyCostFromCompensation = (employee: {
  annual_salary_usd: number | null;
  hourly_rate_usd: number | null;
}): number =>
  employee.annual_salary_usd != null
    ? Number(employee.annual_salary_usd) / 12
    : Number(employee.hourly_rate_usd ?? 0) * HOURS_PER_MONTH;

const sumMonthlyCost = (people: Array<{ monthlyCostUsd: number }>): number =>
  Math.round(people.reduce((sum, person) => sum + person.monthlyCostUsd, 0));

export const isTeamMember = (value: unknown): value is TeamMember =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as TeamMember).name === "string" &&
  typeof (value as TeamMember).title === "string" &&
  typeof (value as TeamMember).startDate === "string" &&
  Number.isFinite((value as TeamMember).monthlyCostUsd);

/** The founder's saved team, or `null` if onboarding hasn't saved one yet. */
const getSavedTeam = async (companyId: string): Promise<TeamMember[] | null> => {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("company_assumptions")
    .select("value")
    .eq("company_id", companyId)
    .eq("key", ASSUMPTION_KEYS.currentTeam)
    .maybeSingle();

  if (error) throw error;
  const value: unknown = data?.value;
  if (!Array.isArray(value) || value.length === 0) return null;
  const team = value.filter(isTeamMember);
  return team.length === value.length ? team : null;
};

/**
 * The company's current team for the onboarding Model step: the founder's
 * saved edits if there are any, otherwise active employees as Gusto reports
 * them.
 */
export const getCurrentTeam = async (
  companyId: string
): Promise<{ team: TeamMember[]; source: "founder" | "gusto" } | null> => {
  const saved = await getSavedTeam(companyId);
  if (saved) return { team: saved, source: "founder" };

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("payroll_employees")
    .select("first_name, last_name, title, start_date, annual_salary_usd, hourly_rate_usd")
    .eq("company_id", companyId)
    .eq("employment_status", "active")
    .order("start_date", { ascending: true, nullsFirst: false });

  if (error) throw error;
  if (!data || data.length === 0) return null;

  return {
    source: "gusto",
    team: data.map((employee) => ({
      name: [employee.first_name, employee.last_name].filter(Boolean).join(" "),
      title: employee.title ?? "",
      startDate: employee.start_date ?? "",
      monthlyCostUsd: Math.round(monthlyCostFromCompensation(employee)),
    })),
  };
};

/**
 * Derives monthly payroll cost from synced Gusto data and stores it as a
 * `derived` assumption.
 *
 * A team the founder saved during onboarding wins: those are their corrections
 * to what Gusto reports. Otherwise it averages employer cost over the trailing
 * 90 days of processed runs rather than taking the latest run, which would
 * under-count biweekly and weekly payrolls. With no non-zero run history -
 * Gusto demo companies ship runs with $0 totals - it falls back to current
 * compensation of active employees.
 */
export const deriveMonthlyPayrollCostFromGusto = async (
  companyId: string
): Promise<number | null> => {
  const savedTeam = await getSavedTeam(companyId);
  if (savedTeam) return sumMonthlyCost(savedTeam);

  const supabase = createServiceClient();
  const windowStart = new Date(Date.now() - PAYROLL_WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const { data: runs, error: runsError } = await supabase
    .from("payroll_runs")
    .select("total_employer_cost_usd, check_date")
    .eq("company_id", companyId)
    .gte("check_date", windowStart)
    // Gusto's demo companies auto-generate processed runs with $0 totals;
    // treat those as no history rather than averaging zeros.
    .gt("total_employer_cost_usd", 0);

  if (runsError) throw runsError;

  let monthlyPayrollCostUsd: number | null = null;

  if (runs && runs.length > 0) {
    const total = runs.reduce((sum, run) => sum + Number(run.total_employer_cost_usd), 0);
    monthlyPayrollCostUsd = total / (PAYROLL_WINDOW_DAYS / DAYS_PER_MONTH);
  } else {
    const { data: employees, error: employeesError } = await supabase
      .from("payroll_employees")
      .select("annual_salary_usd, hourly_rate_usd")
      .eq("company_id", companyId)
      .eq("employment_status", "active");

    if (employeesError) throw employeesError;
    if (!employees || employees.length === 0) return null;

    monthlyPayrollCostUsd = employees.reduce(
      (sum, employee) => sum + monthlyCostFromCompensation(employee),
      0
    );
  }

  monthlyPayrollCostUsd = Math.round(monthlyPayrollCostUsd);

  await setCompanyAssumption(
    companyId,
    ASSUMPTION_KEYS.monthlyPayrollCostUsd,
    monthlyPayrollCostUsd,
    "derived"
  );
  return monthlyPayrollCostUsd;
};

/** How far back a trailing-revenue window reaches for a Stripe-derived MRR proxy. */
const REVENUE_WINDOW_DAYS = 30;

/** Stripe balance-transaction `type`s that represent money actually earned. */
const REVENUE_ENTRY_TYPES = new Set(["charge", "payment"]);

/**
 * Derives a monthly-recurring-revenue proxy from synced Stripe balance
 * transactions and stores it as a `derived` assumption, the same way
 * {@link deriveCashFromBankAccounts} treats Plaid/Rho and
 * {@link deriveMonthlyPayrollCostFromGusto} treats Gusto: each connector
 * answers one part of the onboarding model automatically, and the founder is
 * only asked for what the data can't say.
 *
 * `net` (the signed effect on the Stripe balance, already Stripe's convention
 * per lib/source/stripe/map.ts) is summed over the trailing 30 days for
 * `charge`/`payment` entries - not `amount` (gross), so a refunded charge's
 * matching `refund` entry nets back out rather than being missed because it
 * carries a different `type`.
 */
export const deriveMrrFromStripeRevenue = async (
  companyId: string
): Promise<number | null> => {
  const supabase = createServiceClient();
  const since = new Date(Date.now() - REVENUE_WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const { data, error } = await supabase
    .from("source_entries")
    .select("amount_minor, currency, provider_attributes")
    .eq("company_id", companyId)
    .eq("provider", "stripe")
    .gte("occurred_on", since)
    .is("withdrawn_at", null);

  if (error) throw error;
  if (!data || data.length === 0) return null;

  const revenueEntries = data.filter((entry) => {
    const type = (entry.provider_attributes as { type?: string } | null)?.type;
    return entry.currency === "USD" && type !== undefined && REVENUE_ENTRY_TYPES.has(type);
  });

  if (revenueEntries.length === 0) return null;

  const mrrUsd = revenueEntries.reduce(
    (sum, entry) => sum + Number(entry.amount_minor) / 10 ** minorUnitExponent(entry.currency),
    0
  );

  await setCompanyAssumption(companyId, ASSUMPTION_KEYS.mrrUsd, mrrUsd, "derived");
  return mrrUsd;
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
    setCompanyAssumption(companyId, ASSUMPTION_KEYS.currentTeam, answers.currentTeam),
    ...(answers.currentTeam.length > 0
      ? [
          setCompanyAssumption(
            companyId,
            ASSUMPTION_KEYS.monthlyPayrollCostUsd,
            sumMonthlyCost(answers.currentTeam)
          ),
        ]
      : []),
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

/** Whether an active source connection exists for a provider - independent of whether it has produced any data yet. */
export const hasActiveSourceConnection = async (
  companyId: string,
  provider: SourceProviderId
): Promise<boolean> => {
  const supabase = createServiceClient();
  const { count, error } = await supabase
    .from("source_connections")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("provider", provider)
    .eq("status", "active");

  if (error) throw error;
  return (count ?? 0) > 0;
};

/** Gusto lives outside the Source Layer, so its connection has its own table. */
export const hasActivePayrollConnection = async (companyId: string): Promise<boolean> => {
  const supabase = createServiceClient();
  const { count, error } = await supabase
    .from("payroll_connections")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("status", "active");

  if (error) throw error;
  return (count ?? 0) > 0;
};

export interface OnboardingSnapshot {
  cashOnHandUsd: number | null;
  monthlyPayrollCostUsd: number | null;
  mrrUsd: number | null;
  stripeConnected: boolean;
  payrollConnected: boolean;
  currentTeam: TeamMember[] | null;
  currentTeamSource: "founder" | "gusto" | null;
  assumptions: CompanyAssumptions;
}

/**
 * Everything the onboarding review step and the post-onboarding dashboard
 * need about one company: derived actuals where they exist, founder-entered
 * assumptions filling the gaps. The single source of truth for both -
 * GET /api/onboarding and app/dashboard/page.tsx both call this rather than
 * each assembling it themselves.
 */
export const getOnboardingSnapshot = async (companyId: string): Promise<OnboardingSnapshot> => {
  const [
    cashOnHandUsd,
    monthlyPayrollCostUsd,
    mrrUsd,
    stripeConnected,
    payrollConnected,
    currentTeam,
    assumptions,
  ] = await Promise.all([
    deriveCashFromBankAccounts(companyId),
    deriveMonthlyPayrollCostFromGusto(companyId),
    deriveMrrFromStripeRevenue(companyId),
    hasActiveSourceConnection(companyId, "stripe"),
    hasActivePayrollConnection(companyId),
    getCurrentTeam(companyId),
    getCompanyAssumptions(companyId),
  ]);

  return {
    cashOnHandUsd: cashOnHandUsd ?? (assumptions[ASSUMPTION_KEYS.cashOnHandUsd] as number | undefined) ?? null,
    monthlyPayrollCostUsd:
      monthlyPayrollCostUsd ?? (assumptions[ASSUMPTION_KEYS.monthlyPayrollCostUsd] as number | undefined) ?? null,
    // `mrrUsd` is a proxy derived from the last 30 days of Stripe activity, so
    // it can legitimately come back 0 for a connected account with no charges
    // yet - `stripeConnected` is what the UI shows a "Connected" badge from.
    mrrUsd: mrrUsd ?? (assumptions[ASSUMPTION_KEYS.mrrUsd] as number | undefined) ?? null,
    stripeConnected,
    payrollConnected,
    // Founder-edited team if saved, else Gusto's active employees; null when
    // payroll isn't connected. `source` tells the caller which one it is.
    currentTeam: currentTeam?.team ?? null,
    currentTeamSource: currentTeam?.source ?? null,
    assumptions,
  };
};

