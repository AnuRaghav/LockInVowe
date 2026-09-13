import { resolveAuthenticatedCompanyContext, UnauthenticatedError } from "@/lib/company/context";
import { createFinancialSession, FinancialDataUnavailable } from "@/lib/finance/session";
import { buildStoredCompanyPlan } from "@/lib/finance/planning/stored-plan";
import { planningRequestSchema } from "@/lib/finance/planning/stored-schema";
import { readStoredPlanningRecords } from "@/lib/finance/planning/stored-source";

/**
 * Company-scoped planning endpoint. Identity comes from the Supabase Auth
 * cookie; neither the body nor a header can choose the company being read.
 */
export async function POST(request: Request) {
  let companyId: string;
  try {
    companyId = (await resolveAuthenticatedCompanyContext()).companyId;
  } catch (error) {
    if (error instanceof UnauthenticatedError) return Response.json({ error: "Sign in required." }, { status: 401 });
    return Response.json({ error: "Unable to verify sign-in." }, { status: 503 });
  }

  const rawBody = await request.json().catch(() => ({}));
  const parsed = planningRequestSchema.safeParse(rawBody);
  if (!parsed.success) return Response.json({ error: "Invalid planning inputs.", issues: parsed.error.issues }, { status: 400 });

  try {
    const financials = createFinancialSession(companyId);
    const [{ actuals }, records] = await Promise.all([
      financials.read(),
      readStoredPlanningRecords(companyId),
    ]);
    return Response.json(buildStoredCompanyPlan(companyId, actuals, records, parsed.data));
  } catch (error) {
    if (error instanceof FinancialDataUnavailable) {
      return Response.json({ error: error.message, code: error.code }, { status: 503 });
    }
    console.error("Failed to build company planning model", error);
    return Response.json({ error: "Unable to build company planning model." }, { status: 500 });
  }
}
