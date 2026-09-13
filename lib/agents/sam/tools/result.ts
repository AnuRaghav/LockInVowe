import { isRetryableError } from "@/lib/agents/sam/harness/outcome";

/**
 * One serialization + error shape for every Sam tool.
 *
 * Tools return a JSON string, so the model sees a stable envelope whether the
 * call succeeded or not. Failures are returned rather than thrown: an
 * exception aborts the agent run, while an `ok: false` payload lets Sam
 * explain the problem or ask the founder for the missing input.
 */

/**
 * What kind of thing a result *is*.
 *
 * Five classes, and the list is closed on purpose - this is an epistemic
 * envelope, not an ontology of business concepts. Each names a different reason
 * to believe something, which is the only distinction Sam has to be able to
 * make structurally rather than by remembering a paragraph:
 *
 * - `source_evidence`       a provider said this happened. Balances, ledger
 *                           entries, payroll records, and their provenance.
 * - `financial_actual`      deterministic computation over observed data.
 *                           True of the company, subject to its own scope and
 *                           freshness qualifications.
 * - `financial_projection`  true only of the assumptions it carries. A forecast
 *                           or scenario is never an observation.
 * - `management_context`    what the company believes, plans, or requires.
 *                           Stated by people, verified by nothing.
 * - `conversation_claim`    asserted in this conversation. The weakest class,
 *                           and the one a founder's own message arrives in.
 *
 * The ordering that matters is not a total ranking: `source_evidence` and
 * `financial_actual` outrank the other three *about the same quantity*, and a
 * `management_context` value that disagrees with a `financial_actual` one is a
 * disagreement to report, never a number to average.
 */
export type EpistemicClass =
  | "source_evidence"
  | "financial_actual"
  | "financial_projection"
  | "management_context"
  | "conversation_claim";

/**
 * The tag carried by every successful result.
 *
 * Deliberately four fields. `origin` is coarse provenance - which layer or
 * provider produced this - and is stable text a founder-facing answer can
 * quote. It is never a row id or a query.
 */
export interface Epistemic {
  class: EpistemicClass;
  /** Which layer or provider produced this: `numerical-model`, `semantic`, `provider:gusto`. */
  origin: string;
  /**
   * When this was true, or when it was evaluated. Filled from the result's own
   * `evaluatedAt`/`asOf` when the tool does not state one, so a tool cannot
   * accidentally return an undated figure.
   */
  asOf?: string;
  /** Set on every projection: the result holds only if its assumptions do. */
  conditional?: true;
}

export type SamToolPayload =
  | { ok: true; epistemic: Epistemic; data: unknown }
  | { ok: false; error: string };

/** Reads a date the result already states, so `asOf` is not a second source of truth. */
const statedAsOf = (data: unknown): string | undefined => {
  if (typeof data !== "object" || data === null) return undefined;
  const record = data as { evaluatedAt?: unknown; asOf?: unknown };
  if (typeof record.evaluatedAt === "string") return record.evaluatedAt;
  if (typeof record.asOf === "string") return record.asOf;
  return undefined;
};

export const toolSuccess = (data: unknown, epistemic: Epistemic): string =>
  JSON.stringify({
    ok: true,
    epistemic: { ...epistemic, asOf: epistemic.asOf ?? statedAsOf(data) },
    data,
  } satisfies SamToolPayload);

export const toolFailure = (error: string): string =>
  JSON.stringify({ ok: false, error } satisfies SamToolPayload);

/**
 * Wraps a tool body so domain errors come back as `ok: false` instead of
 * killing the run, and so every successful result is classified.
 *
 * The classification is declared here, at the call site, rather than inside the
 * domain code: `lib/finance/` computes numbers and knows nothing about what
 * Sam is allowed to conclude from them. One argument per tool is the whole cost
 * of making the distinction structural instead of prose.
 *
 * Transient infrastructure failures are the one exception to returning errors:
 * a dropped socket or a throttled backend says nothing about whether the call
 * was valid, so it is rethrown for the harness's retry middleware to deal with.
 * Turning it into an `ok: false` here would tell Sam the *company* has a
 * problem when the network does, and would spend a reasoning turn on something
 * a retry fixes silently.
 */
export const runTool = async (
  execute: () => unknown | Promise<unknown>,
  epistemic: Epistemic
): Promise<string> => {
  try {
    return toolSuccess(await execute(), epistemic);
  } catch (error) {
    if (isRetryableError(error)) throw error;

    return toolFailure(
      error instanceof Error ? error.message : "Unknown tool error."
    );
  }
};
