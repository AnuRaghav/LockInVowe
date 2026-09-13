import { resolveCompanyContext } from "@/lib/company/context";
import {
  ASSUMPTION_KEYS,
  deriveCashFromBankAccounts,
  deriveMonthlyPayrollCostFromGusto,
  getCompanyAssumptions,
  saveOnboardingAnswers,
  type OnboardingAnswers,
  type PlannedHire,
} from "@/lib/company/assumptions";

/** Current onboarding state: derived cash/payroll plus whatever has been saved so far. */
export async function GET(req: Request) {
  const { companyId } = resolveCompanyContext(req);

  const [cashOnHandUsd, monthlyPayrollCostUsd, assumptions] = await Promise.all([
    deriveCashFromBankAccounts(companyId),
    deriveMonthlyPayrollCostFromGusto(companyId),
    getCompanyAssumptions(companyId),
  ]);

  return Response.json({
    cashOnHandUsd: cashOnHandUsd ?? assumptions[ASSUMPTION_KEYS.cashOnHandUsd] ?? null,
    monthlyPayrollCostUsd:
      monthlyPayrollCostUsd ?? assumptions[ASSUMPTION_KEYS.monthlyPayrollCostUsd] ?? null,
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
    !body.plannedHires.every(isPlannedHire)
  ) {
    return Response.json({ error: "Invalid onboarding answers." }, { status: 400 });
  }

  const answers: OnboardingAnswers = {
    mrrUsd: body.mrrUsd,
    monthlyExpensesUsd: body.monthlyExpensesUsd,
    monthlyGrowthTargetPct: body.monthlyGrowthTargetPct,
    minimumRunwayMonths: body.minimumRunwayMonths,
    plannedHires: body.plannedHires,
  };

  try {
    await saveOnboardingAnswers(companyId, answers);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Failed to save onboarding answers", error);
    return Response.json({ error: "Failed to save onboarding answers." }, { status: 500 });
  }
}
