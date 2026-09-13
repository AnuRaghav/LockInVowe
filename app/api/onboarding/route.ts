import { resolveCompanyContext } from "@/lib/company/context";
import {
  ASSUMPTION_KEYS,
  deriveCashFromBankAccounts,
  deriveMonthlyPayrollCostFromGusto,
  deriveMrrFromStripeRevenue,
  getCompanyAssumptions,
  getCurrentTeam,
  isTeamMember,
  saveOnboardingAnswers,
  type OnboardingAnswers,
  type PlannedHire,
} from "@/lib/company/assumptions";
import type { SourceProviderId } from "@/lib/source";
import { createServiceClient } from "@/lib/supabase/service";

/** Whether an active source connection exists for a provider - independent of whether it has produced any data yet. */
const hasActiveConnection = async (
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
const hasActivePayrollConnection = async (companyId: string): Promise<boolean> => {
  const supabase = createServiceClient();
  const { count, error } = await supabase
    .from("payroll_connections")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("status", "active");

  if (error) throw error;
  return (count ?? 0) > 0;
};

/** Current onboarding state: derived cash/payroll/revenue plus whatever has been saved so far. */
export async function GET(req: Request) {
  const { companyId } = resolveCompanyContext(req);

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
    hasActiveConnection(companyId, "stripe"),
    hasActivePayrollConnection(companyId),
    getCurrentTeam(companyId),
    getCompanyAssumptions(companyId),
  ]);

  return Response.json({
    cashOnHandUsd: cashOnHandUsd ?? assumptions[ASSUMPTION_KEYS.cashOnHandUsd] ?? null,
    monthlyPayrollCostUsd:
      monthlyPayrollCostUsd ?? assumptions[ASSUMPTION_KEYS.monthlyPayrollCostUsd] ?? null,
    // `mrrUsd` is a proxy derived from the last 30 days of Stripe activity, so
    // it can legitimately come back 0 for a connected account with no charges
    // yet - `stripeConnected` is what the UI shows a "Connected" badge from.
    mrrUsd: mrrUsd ?? assumptions[ASSUMPTION_KEYS.mrrUsd] ?? null,
    stripeConnected,
    payrollConnected,
    // Founder-edited team if saved, else Gusto's active employees; null when
    // payroll isn't connected. `source` tells the UI which one it's showing.
    currentTeam: currentTeam?.team ?? null,
    currentTeamSource: currentTeam?.source ?? null,
    assumptions,
  });
}

const isPlannedHire = (value: unknown): value is PlannedHire =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as PlannedHire).title === "string" &&
  typeof (value as PlannedHire).startDate === "string" &&
  Number.isFinite((value as PlannedHire).monthlyCostUsd);

const isFiniteNonNegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Validates and persists the founder's onboarding answers. */
export async function POST(req: Request) {
  const { companyId } = resolveCompanyContext(req);
  const body = await req.json().catch(() => null);

  if (
    !body ||
    !isFiniteNonNegative(body.mrrUsd) ||
    !isFiniteNonNegative(body.monthlyExpensesUsd) ||
    !isFiniteNonNegative(body.monthlyGrowthTargetPct) ||
    !isFiniteNonNegative(body.minimumRunwayMonths) ||
    !Array.isArray(body.plannedHires) ||
    !body.plannedHires.every(isPlannedHire) ||
    (body.currentTeam !== undefined &&
      (!Array.isArray(body.currentTeam) || !body.currentTeam.every(isTeamMember)))
  ) {
    return Response.json({ error: "Invalid onboarding answers." }, { status: 400 });
  }

  const answers: OnboardingAnswers = {
    mrrUsd: body.mrrUsd,
    monthlyExpensesUsd: body.monthlyExpensesUsd,
    monthlyGrowthTargetPct: body.monthlyGrowthTargetPct,
    minimumRunwayMonths: body.minimumRunwayMonths,
    plannedHires: body.plannedHires,
    currentTeam: body.currentTeam ?? [],
  };

  try {
    await saveOnboardingAnswers(companyId, answers);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Failed to save onboarding answers", error);
    return Response.json({ error: "Failed to save onboarding answers." }, { status: 500 });
  }
}
