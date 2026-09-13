import { resolveCompanyContext } from "@/lib/company/context";
import { PayrollConnectionNotFoundError, syncGustoConnection } from "@/lib/gusto/sync";

/** Pulls employees + processed payroll runs for one linked Gusto company. */
export async function POST(req: Request) {
  let companyId: string;
  try {
    companyId = (await resolveCompanyContext(req)).companyId;
  } catch {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const payrollConnectionId =
    typeof body?.payrollConnectionId === "string" && body.payrollConnectionId
      ? body.payrollConnectionId
      : undefined;

  try {
    const result = await syncGustoConnection({ companyId, payrollConnectionId });
    return Response.json(result);
  } catch (error) {
    if (error instanceof PayrollConnectionNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }

    console.error("Failed to sync Gusto data", error);
    return Response.json({ error: "Failed to sync payroll data." }, { status: 500 });
  }
}
