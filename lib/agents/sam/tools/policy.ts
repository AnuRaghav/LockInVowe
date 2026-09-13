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
  /**
   * How a UI should describe this call while it is running - "Calculating
   * runway". Static text declared next to the tool, never derived from the
   * model's arguments, so narrating a run cannot leak what was asked.
   */
  label?: string;
  /**
   * Optional, explicitly safe one-line summary of a successful result.
   *
   * Opt-in per tool, and the only route by which anything derived from a tool's
   * output reaches an event stream. A tool that declares nothing here streams
   * nothing but its name, status, and timing. Keep summaries qualitative -
   * a status word, a count - never the company's figures.
   */
  summarize?: (data: unknown) => string | undefined;
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

const field = (data: unknown, key: string): unknown =>
  typeof data === "object" && data !== null
    ? (data as Record<string, unknown>)[key]
    : undefined;

/** Policy for every tool in {@link SAM_TOOLS}, keyed by tool name. */
export const SAM_TOOL_POLICIES: Readonly<Record<string, SamToolPolicy>> = {
  financial_position: { kind: "read_only", retryable: true, requiresApproval: false, label: "Reading observed financial position" },
  financial_cash_flow: { kind: "read_only", retryable: true, requiresApproval: false, label: "Analyzing recorded cash flow" },
  financial_burn_runway: { kind: "read_only", retryable: true, requiresApproval: false, label: "Checking burn and runway basis",
    summarize: (data) => {
      const status = field(field(data, "runway"), "status");
      return status === "unavailable" ? "Runway unavailable from observed data" : undefined;
    } },
  compare_financial_periods: { kind: "read_only", retryable: true, requiresApproval: false, label: "Comparing financial periods" },
  explain_financial_number: { kind: "read_only", retryable: true, requiresApproval: false, label: "Tracing financial evidence" },
  forecast_cash: { kind: "calculation", retryable: true, requiresApproval: false, label: "Forecasting conditional cash trajectory" },
  simulate_financial_scenario: { kind: "calculation", retryable: true, requiresApproval: false, label: "Simulating a financial scenario" },
  compare_financial_scenarios: { kind: "calculation", retryable: true, requiresApproval: false, label: "Comparing financial scenarios" },
  search_memory: {
    kind: "read_only",
    retryable: true,
    requiresApproval: false,
    label: "Searching company memory",
    // How much was found, never what.
    summarize: (data) => {
      const memories = field(data, "memories");
      return Array.isArray(memories)
        ? `${memories.length} ${memories.length === 1 ? "memory" : "memories"} matched`
        : undefined;
    },
  },
  get_memory: {
    kind: "read_only",
    retryable: true,
    requiresApproval: false,
    label: "Reading a company note",
  },
  create_chart: {
    // Stores a chart against the turn, so a blind retry would draw it twice.
    kind: "action",
    retryable: false,
    requiresApproval: false,
    maxCallsPerRun: 2,
    label: "Drawing a chart",
    summarize: () => "Chart ready",
  },
};

export type SamToolPolicyRegistry = Readonly<Record<string, SamToolPolicy>>;

/** The policy for one tool, falling back to {@link DEFAULT_SAM_TOOL_POLICY}. */
export const samToolPolicy = (
  name: string,
  registry: SamToolPolicyRegistry = SAM_TOOL_POLICIES
): SamToolPolicy => registry[name] ?? DEFAULT_SAM_TOOL_POLICY;

/** How a UI narrates this tool while it runs. */
export const samToolLabel = (
  name: string,
  registry: SamToolPolicyRegistry = SAM_TOOL_POLICIES
): string => registry[name]?.label ?? name.replace(/_/g, " ");

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
