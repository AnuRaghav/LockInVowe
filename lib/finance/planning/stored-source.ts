import { createServiceClient } from "@/lib/supabase/service";
import { readAllSourcePages } from "../source-reader";
import type { Database } from "@/lib/supabase/types";

type Tables = Database["public"]["Tables"];
export type StoredAssumption = Pick<Tables["company_assumptions"]["Row"], "company_id" | "id" | "key" | "value" | "source" | "updated_at">;
export type StoredEmployee = Pick<Tables["payroll_employees"]["Row"], "company_id" | "id" | "payroll_connection_id" |
  "annual_salary_usd" | "hourly_rate_usd" | "payment_unit" | "start_date" | "termination_date" | "employment_status" | "updated_at">;
export type StoredPayrollConnection = Pick<Tables["payroll_connections"]["Row"], "company_id" | "id" | "status" | "last_synced_at" | "updated_at">;
export interface StoredPlanningRecords {
  companyId: string;
  assumptions: StoredAssumption[];
  employees: StoredEmployee[];
  payrollConnections: StoredPayrollConnection[];
}

/** Internal server reader. companyId must come from verified Auth, never HTTP/model arguments. */
export async function readStoredPlanningRecords(companyId: string, client = createServiceClient(), signal?: AbortSignal): Promise<StoredPlanningRecords> {
  if (!companyId) throw new Error("Company scope is required");
  const requestSignal = signal ?? new AbortController().signal;
  const [assumptions, employees, payrollConnections] = await Promise.all([
    readAllSourcePages((from, to) => client.from("company_assumptions")
      .select("company_id,id,key,value,source,updated_at").eq("company_id", companyId).order("id").range(from, to).abortSignal(requestSignal)),
    readAllSourcePages((from, to) => client.from("payroll_employees")
      .select("company_id,id,payroll_connection_id,annual_salary_usd,hourly_rate_usd,payment_unit,start_date,termination_date,employment_status,updated_at")
      .eq("company_id", companyId).order("id").range(from, to).abortSignal(requestSignal)),
    readAllSourcePages((from, to) => client.from("payroll_connections")
      .select("company_id,id,status,last_synced_at,updated_at").eq("company_id", companyId).order("id").range(from, to).abortSignal(requestSignal)),
  ]);
  const result = { companyId, assumptions, employees, payrollConnections };
  assertPlanningScope(companyId, result);
  return result;
}

export function assertPlanningScope(companyId: string, records: StoredPlanningRecords) {
  if (records.companyId !== companyId || [...records.assumptions, ...records.employees, ...records.payrollConnections]
    .some(row => row.company_id !== companyId)) throw new Error("Planning data scope mismatch");
}
