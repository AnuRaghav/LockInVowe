import { createServiceClient } from "@/lib/supabase/service";
import { reconcileFinancialActivity } from "@/lib/finance/reconciliation";

/** Exhaust pages even when the server's row cap is smaller than our requested page. */
export async function readAllSourcePages<T>(page: (from: number, to: number) => PromiseLike<{
  data: T[] | null; error: unknown;
}>): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const { data, error } = await page(rows.length, rows.length + 499);
    if (error) throw error;
    if (!data) throw new Error("Missing Source query result");
    if (!data.length) return rows;
    rows.push(...data);
  }
}

/** Internal server entry point; companyId MUST come from trusted authorization context.
 * No route/tool/Server Action is exposed. Reads current projections, never provider APIs.
 * Sync-run fencing detects concurrent ingestion (all existing writers start a run first).
 * This is not a historical as-of query or a database transaction across arbitrary writers.
 */
export async function loadReconciledFinancialState(companyId: string, options: {
  now: Date; staleAfterMs: number; signal?: AbortSignal;
}, client = createServiceClient()) {
  if (!companyId) throw new Error("Company scope is required");
  const signal = options.signal ?? new AbortController().signal;
  const runs = () => readAllSourcePages((from, to) => client.from("source_sync_runs")
    .select("id,company_id,connection_id,provider,status,started_at,finished_at,error")
    .eq("company_id", companyId).order("id").range(from, to).abortSignal(signal));
  const connections = () => readAllSourcePages((from, to) => client.from("source_connections")
    .select("id,company_id,provider,status,last_synced_at,last_sync_error,updated_at")
    .eq("company_id", companyId).order("id").range(from, to).abortSignal(signal));
  const beforeRuns = await runs();
  if (beforeRuns.some(r => r.status === "running")) throw new Error("Source sync in progress; retry reconciliation");
  const beforeConnections = await connections();
  const [accounts, entries, balances] = await Promise.all([
    readAllSourcePages((from, to) => client.from("source_accounts").select("*")
      .eq("company_id", companyId).order("id").range(from, to).abortSignal(signal)),
    readAllSourcePages((from, to) => client.from("source_entries").select("*")
      .eq("company_id", companyId).order("id").range(from, to).abortSignal(signal)),
    readAllSourcePages((from, to) => client.from("source_balance_observations").select("*")
      .eq("company_id", companyId).order("id").range(from, to).abortSignal(signal)),
  ]);
  const afterConnections = await connections();
  const afterRuns = await runs();
  if (JSON.stringify(beforeRuns) !== JSON.stringify(afterRuns) ||
      JSON.stringify(beforeConnections) !== JSON.stringify(afterConnections))
    throw new Error("Source changed during reconciliation; retry");
  return reconcileFinancialActivity({ companyId, accounts, entries, balances,
    connections: afterConnections, runs: afterRuns }, options);
}
