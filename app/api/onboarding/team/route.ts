import { ASSUMPTION_SCHEMAS, saveTeamAndHires } from "@/lib/company/assumptions";
import { resolveCompanyContext } from "@/lib/company/context";

export const runtime = "nodejs";

/** Saves the current team and planned hires from the onboarding table. */
export async function PUT(req: Request) {
  let companyId: string;
  try {
    companyId = (await resolveCompanyContext(req)).companyId;
  } catch {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { currentTeam?: unknown; plannedHires?: unknown } | null;
  const team = ASSUMPTION_SCHEMAS.current_team.safeParse(body?.currentTeam);
  const hires = ASSUMPTION_SCHEMAS.planned_hires.safeParse(body?.plannedHires);

  if (!team.success || !hires.success) {
    return Response.json({ error: "Every person needs a name and monthly cost, and every hire a role, date, and cost." }, { status: 400 });
  }

  try {
    await saveTeamAndHires(companyId, team.data, hires.data);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Failed to save team and hires", error);
    return Response.json({ error: "Couldn't save the team. Try again." }, { status: 500 });
  }
}
