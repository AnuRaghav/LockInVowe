import { deriveFinancialActuals, type FinancialActuals } from "./actuals";
import type { ReconciledFinancialState } from "./reconciliation";
import { loadReconciledFinancialState } from "./source-reader";
import { hasServiceCredentials } from "@/lib/supabase/service";

export interface FinancialSession {
  readonly companyId: string;
  read(): Promise<{ reconciled: ReconciledFinancialState; actuals: FinancialActuals }>;
}
export class FinancialDataUnavailable extends Error {
  constructor(public readonly code: "not_configured" | "source_unavailable" | "scope_mismatch") {
    super(`Numerical Model unavailable: ${code}. Do not substitute conversation or memory figures.`);
  }
}
/** One successful observation per run, never a global/company cache. Failed reads can be retried.
 * The loader seam accepts only Source-derived reconciled state, not financial scalar inputs.
 */
export function createFinancialSession(companyId: string, options: {
  load?: (companyId: string, signal?: AbortSignal) => Promise<ReconciledFinancialState>;
  now?: () => Date;
  timeoutMs?: number;
} = {}): FinancialSession {
  const timeoutMs = options.timeoutMs ?? 5000;
  if (!companyId || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid financial session options");
  let loaded: ReturnType<FinancialSession["read"]> | undefined;
  const load = options.load ?? (async (id: string, signal?: AbortSignal) => {
    if (!hasServiceCredentials()) throw new FinancialDataUnavailable("not_configured");
    return loadReconciledFinancialState(id, { now: options.now?.() ?? new Date(), staleAfterMs: 86400000, signal });
  });
  return {
    companyId,
    read() {
      if (!loaded) {
        loaded = (async () => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const controller = new AbortController();
          try {
            const reconciled = await Promise.race([
              load(companyId, controller.signal),
              new Promise<never>((_, reject) => { timer = setTimeout(() => {
                controller.abort(); reject(new FinancialDataUnavailable("source_unavailable"));
              }, timeoutMs); }),
            ]);
            if (reconciled.companyId !== companyId) throw new FinancialDataUnavailable("scope_mismatch");
            return { reconciled, actuals: deriveFinancialActuals(reconciled) };
          } catch (error) {
            // Never leak SQL, credentials, provider error payloads or an unsafe partial result.
            throw error instanceof FinancialDataUnavailable ? error : new FinancialDataUnavailable("source_unavailable");
          } finally { clearTimeout(timer); }
        })().catch(error => { loaded = undefined; throw error; });
      }
      return loaded;
    },
  };
}
