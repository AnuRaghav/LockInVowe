/**
 * Tool execution policy.
 *
 * A tool's *schema* says what the model may send. This says what the system is
 * allowed to do with the call: whether repeating it is safe, whether it needs a
 * human in the loop, and how much of the run's budget it may consume.
 *
 * The distinction that matters is what a second identical call would do:
 *
 * - `read_only`    - returns information; a repeat changes nothing.
 * - `calculation`  - deterministic math over its arguments; a repeat is free.
 * - `action`       - changes company state; a repeat is *not* free, so the
 *                    harness must never retry it on its own.
 *
 * Sam only reads today, so every registered tool is read-only or a calculation.
 * The point of writing it down now is that the first state-changing tool
 * declares `kind: "action"` here and inherits the right behaviour - no retries,
 * and an approval gate - without the agent loop changing.
 */

export type SamToolKind = "read_only" | "calculation" | "action";

export interface SamToolPolicy {
  kind: SamToolKind;
  /**
   * Whether the harness may re-run this tool after a transient failure.
   *
   * Only ever true for calls that cannot change company state. A state-changing
   * tool stays `false` until it accepts an idempotency key (see `runId` on the
   * runtime context) and the backing store honours it.
   */
  retryable: boolean;
  /**
   * Where human approval will attach. No tool sets this yet, so no run is ever
   * gated today; the gate itself is implemented, so turning it on is a one-line
   * change here plus an approver on the run.
   */
  requiresApproval: boolean;
  /** Stricter ceiling than the run-wide tool budget, for expensive tools. */
  maxCallsPerRun?: number;
  /** Stricter timeout than the run-wide tool timeout. */
  timeoutMs?: number;
}

/**
 * Applied to any tool with no entry below.
 *
 * Deliberately the conservative reading - an unknown tool is assumed to change
 * something, so the harness will not retry it.
 */
export const DEFAULT_SAM_TOOL_POLICY: SamToolPolicy = {
  kind: "action",
  retryable: false,
  requiresApproval: false,
};

const READ_ONLY: SamToolPolicy = {
  kind: "read_only",
  retryable: true,
  requiresApproval: false,
};

const CALCULATION: SamToolPolicy = {
  kind: "calculation",
  retryable: true,
  requiresApproval: false,
};

/** Policy for every tool in {@link SAM_TOOLS}, keyed by tool name. */
export const SAM_TOOL_POLICIES: Readonly<Record<string, SamToolPolicy>> = {
  calculate_runway: CALCULATION,
  search_memory: READ_ONLY,
  get_memory: READ_ONLY,
};

export type SamToolPolicyRegistry = Readonly<Record<string, SamToolPolicy>>;

/** The policy for one tool, falling back to {@link DEFAULT_SAM_TOOL_POLICY}. */
export const samToolPolicy = (
  name: string,
  registry: SamToolPolicyRegistry = SAM_TOOL_POLICIES
): SamToolPolicy => registry[name] ?? DEFAULT_SAM_TOOL_POLICY;

/** Names the harness is allowed to retry. Everything else is left alone. */
export const retryableToolNames = (
  registry: SamToolPolicyRegistry = SAM_TOOL_POLICIES
): string[] =>
  Object.entries(registry)
    .filter(([, policy]) => policy.retryable)
    .map(([name]) => name);

/** Per-tool call ceilings declared by the registry, for the run budget. */
export const toolCallCeilings = (
  registry: SamToolPolicyRegistry = SAM_TOOL_POLICIES
): Record<string, number> =>
  Object.fromEntries(
    Object.entries(registry)
      .filter(([, policy]) => typeof policy.maxCallsPerRun === "number")
      .map(([name, policy]) => [name, policy.maxCallsPerRun as number])
  );
