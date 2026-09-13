import { gustoGet, refreshGustoToken } from "@/lib/gusto/client";
import { createServiceClient } from "@/lib/supabase/service";

type SupabaseServiceClient = ReturnType<typeof createServiceClient>;

/**
 * Payload shapes trimmed to the fields this connector reads. Field names follow
 * https://docs.gusto.com/app-integrations/reference/get-v1-companies-company_id-employees
 * and .../get-v1-companies-company_id-payrolls.
 */
interface GustoCompensation {
  uuid: string;
  rate: string;
  payment_unit: string;
}

interface GustoJob {
  title?: string | null;
  primary?: boolean;
  hire_date?: string | null;
  current_compensation_uuid?: string | null;
  compensations?: GustoCompensation[];
}

interface GustoEmployee {
  uuid: string;
  first_name?: string | null;
  last_name?: string | null;
  department?: string | null;
  terminated?: boolean;
  current_employment_status?: string | null;
  terminations?: Array<{ active?: boolean; effective_date?: string | null }>;
  jobs?: GustoJob[];
}

interface GustoPayroll {
  payroll_uuid?: string;
  uuid?: string;
  processed?: boolean;
  check_date?: string;
  pay_period?: { start_date?: string; end_date?: string };
  totals?: {
    gross_pay?: string;
    employer_taxes?: string;
    benefits?: string;
    company_debit?: string;
  };
}

export class PayrollConnectionNotFoundError extends Error {
  constructor() {
    super("Payroll connection not found.");
    this.name = "PayrollConnectionNotFoundError";
  }
}

export interface GustoSyncResult {
  payrollConnectionId: string;
  employeesSynced: number;
  payrollRunsSynced: number;
}

/** Gusto's list endpoints page at 25 by default; 100 is the documented max. */
const PAGE_SIZE = 100;

const toNumber = (value: string | undefined): number =>
  value ? Number.parseFloat(value) || 0 : 0;

const gustoGetAllPages = async <T>(accessToken: string, path: string): Promise<T[]> => {
  const results: T[] = [];
  const separator = path.includes("?") ? "&" : "?";

  for (let page = 1; ; page++) {
    const batch = await gustoGet<T[]>(accessToken, `${path}${separator}per=${PAGE_SIZE}&page=${page}`);
    results.push(...batch);
    if (batch.length < PAGE_SIZE) return results;
  }
};

const primaryJob = (employee: GustoEmployee): GustoJob | undefined =>
  employee.jobs?.find((job) => job.primary) ?? employee.jobs?.[0];

const currentCompensation = (job: GustoJob | undefined): GustoCompensation | null =>
  job?.compensations?.find((c) => c.uuid === job.current_compensation_uuid) ??
  job?.compensations?.[0] ??
  null;

const ensureFreshAccessToken = async (
  supabase: SupabaseServiceClient,
  connection: { id: string; access_token: string; refresh_token: string; access_token_expires_at: string }
): Promise<string> => {
  const expiresAt = new Date(connection.access_token_expires_at).getTime();
  if (expiresAt - Date.now() > 60_000) return connection.access_token;

  const refreshed = await refreshGustoToken(connection.refresh_token);
  const { error } = await supabase
    .from("payroll_connections")
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      access_token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
    })
    .eq("id", connection.id);

  if (error) throw error;
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
    const job = primaryJob(employee);
    const compensation = currentCompensation(job);
    const isHourly = compensation?.payment_unit === "Hour";
    const rate = toNumber(compensation?.rate) || null;
    const termination = employee.terminations?.find((t) => t.active) ?? employee.terminations?.[0];

    return {
      company_id: companyId,
      payroll_connection_id: payrollConnectionId,
      provider_employee_id: employee.uuid,
      first_name: employee.first_name ?? null,
      last_name: employee.last_name ?? null,
      title: job?.title ?? null,
      department: employee.department ?? null,
      employment_status: employee.terminated ? "terminated" : "active",
      annual_salary_usd: compensation && !isHourly ? rate : null,
      hourly_rate_usd: isHourly ? rate : null,
      payment_unit: compensation ? (isHourly ? "hour" : "year") : null,
      start_date: job?.hire_date ?? null,
      termination_date: termination?.effective_date ?? null,
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
): Promise<number> => {
  const rows = payrolls.flatMap((payroll) => {
    const id = payroll.payroll_uuid ?? payroll.uuid;
    const start = payroll.pay_period?.start_date;
    const end = payroll.pay_period?.end_date;
    if (!payroll.processed || !id || !start || !end || !payroll.check_date) return [];

    const grossPay = toNumber(payroll.totals?.gross_pay);
    // `company_debit` is what actually leaves the company's bank for the run,
    // which is the number runway cares about. Fall back to the loaded-cost sum
    // for payloads that omit it.
    const employerCost =
      toNumber(payroll.totals?.company_debit) ||
      grossPay + toNumber(payroll.totals?.employer_taxes) + toNumber(payroll.totals?.benefits);

    return [
      {
        company_id: companyId,
        payroll_connection_id: payrollConnectionId,
        provider_payroll_id: id,
        pay_period_start: start,
        pay_period_end: end,
        check_date: payroll.check_date,
        total_gross_pay_usd: grossPay,
        total_employer_cost_usd: employerCost,
        processed: true,
        updated_at: new Date().toISOString(),
      },
    ];
  });

  if (rows.length === 0) return 0;

  const { error } = await supabase
    .from("payroll_runs")
    .upsert(rows, { onConflict: "payroll_connection_id,provider_payroll_id" });

  if (error) throw error;
  return rows.length;
};

/**
 * Pulls employees + processed payroll runs for one linked Gusto company.
 * With no `payrollConnectionId`, syncs the company's most recently linked
 * connection.
 */
export const syncGustoConnection = async ({
  companyId,
  payrollConnectionId,
}: {
  companyId: string;
  payrollConnectionId?: string;
}): Promise<GustoSyncResult> => {
  const supabase = createServiceClient();

  const query = supabase
    .from("payroll_connections")
    .select("id, provider_company_id, access_token, refresh_token, access_token_expires_at")
    .eq("company_id", companyId);

  const { data: connection, error: connectionError } = payrollConnectionId
    ? await query.eq("id", payrollConnectionId).maybeSingle()
    : await query.order("created_at", { ascending: false }).limit(1).maybeSingle();

  if (connectionError) throw connectionError;
  if (!connection) throw new PayrollConnectionNotFoundError();

  try {
    const accessToken = await ensureFreshAccessToken(supabase, connection);
    const gustoCompanyId = connection.provider_company_id;

    // Payrolls default to processed, regular runs from the past 6 months,
    // which is the window a monthly-cost estimate wants anyway.
    const [employees, payrolls] = await Promise.all([
      gustoGetAllPages<GustoEmployee>(accessToken, `/v1/companies/${gustoCompanyId}/employees`),
      gustoGetAllPages<GustoPayroll>(accessToken, `/v1/companies/${gustoCompanyId}/payrolls`),
    ]);

    await upsertEmployees(supabase, companyId, connection.id, employees);
    const payrollRunsSynced = await upsertPayrollRuns(supabase, companyId, connection.id, payrolls);

    await supabase
      .from("payroll_connections")
      .update({ last_synced_at: new Date().toISOString(), status: "active" })
      .eq("id", connection.id);

    return { payrollConnectionId: connection.id, employeesSynced: employees.length, payrollRunsSynced };
  } catch (error) {
    await supabase.from("payroll_connections").update({ status: "error" }).eq("id", connection.id);
    throw error;
  }
};
