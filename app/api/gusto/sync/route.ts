import { resolveCompanyContext } from "@/lib/company/context";
import { gustoGet, refreshGustoToken } from "@/lib/gusto/client";
import { createServiceClient } from "@/lib/supabase/service";

type SupabaseServiceClient = ReturnType<typeof createServiceClient>;

/** Shape trimmed to the fields this connector actually uses; Gusto's payload is much larger. */
interface GustoCompensation {
  id: string;
  rate: string;
  payment_unit: "Hour" | "Year" | string;
}

interface GustoJob {
  title?: string;
  current_compensation_id?: string;
  compensations?: GustoCompensation[];
}

interface GustoEmployee {
  uuid: string;
  first_name?: string;
  last_name?: string;
  department?: string;
  employment_status?: string;
  start_date?: string;
  terminated?: boolean;
  jobs?: GustoJob[];
}

interface GustoPayrollTotals {
  gross_pay?: string;
  employer_taxes?: string;
  benefits?: string;
}

interface GustoPayroll {
  payroll_uuid: string;
  pay_period?: { start_date?: string; end_date?: string };
  check_date?: string;
  processed?: boolean;
  totals?: GustoPayrollTotals;
}

const toNumber = (value: string | undefined): number =>
  value ? Number.parseFloat(value) || 0 : 0;

const currentCompensation = (job: GustoJob | undefined): GustoCompensation | null =>
  job?.compensations?.find((c) => c.id === job.current_compensation_id) ??
  job?.compensations?.[0] ??
  null;

const ensureFreshAccessToken = async (
  supabase: SupabaseServiceClient,
  connection: {
    id: string;
    access_token: string;
    refresh_token: string;
    access_token_expires_at: string;
  }
): Promise<string> => {
  const expiresAt = new Date(connection.access_token_expires_at).getTime();
  if (expiresAt - Date.now() > 60_000) return connection.access_token;

  const refreshed = await refreshGustoToken(connection.refresh_token);
  await supabase
    .from("payroll_connections")
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      access_token_expires_at: new Date(
        Date.now() + refreshed.expires_in * 1000
      ).toISOString(),
    })
    .eq("id", connection.id);

  return refreshed.access_token;
};

const upsertEmployees = async (
  supabase: SupabaseServiceClient,
  companyId: string,
  payrollConnectionId: string,
  employees: GustoEmployee[]
) => {
  if (employees.length === 0) return;

  const rows = employees.map((employee) => {
    const job = employee.jobs?.[0];
    const compensation = currentCompensation(job);
    const isHourly = compensation?.payment_unit === "Hour";

    return {
      company_id: companyId,
      payroll_connection_id: payrollConnectionId,
      provider_employee_id: employee.uuid,
      first_name: employee.first_name ?? null,
      last_name: employee.last_name ?? null,
      title: job?.title ?? null,
      department: employee.department ?? null,
      employment_status: employee.employment_status ?? (employee.terminated ? "terminated" : "active"),
      annual_salary_usd: isHourly ? null : toNumber(compensation?.rate) || null,
      hourly_rate_usd: isHourly ? toNumber(compensation?.rate) || null : null,
      payment_unit: isHourly ? "hour" : "year",
      start_date: employee.start_date ?? null,
      updated_at: new Date().toISOString(),
    };
  });

  const { error } = await supabase
    .from("payroll_employees")
    .upsert(rows, { onConflict: "payroll_connection_id,provider_employee_id" });

  if (error) throw error;
};

const upsertPayrollRuns = async (
  supabase: SupabaseServiceClient,
  companyId: string,
  payrollConnectionId: string,
  payrolls: GustoPayroll[]
) => {
  const processed = payrolls.filter(
    (p) => p.processed && p.pay_period?.start_date && p.pay_period?.end_date && p.check_date
  );
  if (processed.length === 0) return;

  const rows = processed.map((payroll) => {
    const grossPay = toNumber(payroll.totals?.gross_pay);
    const employerTaxes = toNumber(payroll.totals?.employer_taxes);
    const benefits = toNumber(payroll.totals?.benefits);

    return {
      company_id: companyId,
      payroll_connection_id: payrollConnectionId,
      provider_payroll_id: payroll.payroll_uuid,
      pay_period_start: payroll.pay_period!.start_date!,
      pay_period_end: payroll.pay_period!.end_date!,
      check_date: payroll.check_date!,
      total_gross_pay_usd: grossPay,
      total_employer_cost_usd: grossPay + employerTaxes + benefits,
      processed: true,
      updated_at: new Date().toISOString(),
    };
  });

  const { error } = await supabase
    .from("payroll_runs")
    .upsert(rows, { onConflict: "payroll_connection_id,provider_payroll_id" });

  if (error) throw error;
};

/** Pulls employees + processed payroll runs for one linked Gusto company. */
export async function POST(req: Request) {
  const { companyId } = resolveCompanyContext(req);
  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const requestedConnectionId = body?.payrollConnectionId;

  const supabase = createServiceClient();

  // No id given: fall back to the company's most recently linked connection,
  // so the demo UI can just say "sync" without tracking ids client-side.
  const connectionQuery = supabase
    .from("payroll_connections")
    .select("id, provider_company_id, access_token, refresh_token, access_token_expires_at")
    .eq("company_id", companyId);

  const { data: connection, error: connectionError } =
    typeof requestedConnectionId === "string" && requestedConnectionId
      ? await connectionQuery.eq("id", requestedConnectionId).single()
      : await connectionQuery
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

  if (connectionError || !connection) {
    return Response.json({ error: "Payroll connection not found." }, { status: 404 });
  }

  const payrollConnectionId = connection.id;

  try {
    const accessToken = await ensureFreshAccessToken(supabase, connection);
    const gustoCompanyId = connection.provider_company_id;

    const [employees, payrolls] = await Promise.all([
      gustoGet<GustoEmployee[]>(
        accessToken,
        `/v1/companies/${gustoCompanyId}/employees`
      ),
      gustoGet<GustoPayroll[]>(
        accessToken,
        `/v1/companies/${gustoCompanyId}/payrolls?processed=true`
      ),
    ]);

    await upsertEmployees(supabase, companyId, payrollConnectionId, employees);
    await upsertPayrollRuns(supabase, companyId, payrollConnectionId, payrolls);

    await supabase
      .from("payroll_connections")
      .update({ last_synced_at: new Date().toISOString(), status: "active" })
      .eq("id", payrollConnectionId);

    return Response.json({
      employeesSynced: employees.length,
      payrollRunsSynced: payrolls.filter((p) => p.processed).length,
    });
  } catch (error) {
    console.error("Failed to sync Gusto data", error);
    await supabase
      .from("payroll_connections")
      .update({ status: "error" })
      .eq("id", payrollConnectionId);

    return Response.json({ error: "Failed to sync payroll data." }, { status: 500 });
  }
}
