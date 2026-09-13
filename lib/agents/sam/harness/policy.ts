import {
  DEFAULT_SAM_MAX_TOKENS,
  readIntEnv,
} from "@/lib/agents/sam/config";
import {
  SAM_TOOL_POLICIES,
  toolCallCeilings,
  type SamToolPolicyRegistry,
} from "@/lib/agents/sam/tools/policy";

/**
 * One place that says how much a Sam run is allowed to consume.
 *
 * Every bound the harness enforces is a field here - call budgets, deadlines,
 * timeouts, retry shape, context size. Nothing else in the package reads an
 * environment variable or hard-codes a number, so "how expensive can one
 * question get" is answerable by reading this file alone.
 */
export interface SamExecutionPolicy {
  /** Hard ceiling on model invocations in one run. Bounds cost and looping. */
  maxModelCalls: number;
  /** Hard ceiling on tool invocations in one run, across all tools. */
  maxToolCalls: number;
  /**
   * Stricter per-tool ceilings, keyed by tool name. Seeded from the tool
   * registry so an expensive tool declares its own limit next to itself.
   */
  maxCallsPerTool: Record<string, number>;
  /** Max output tokens per model call. */
  maxOutputTokens: number;
  /** Wall-clock budget for the whole run, enforced with an AbortSignal. */
  runDeadlineMs: number;
  /** Per-attempt ceiling on a single model call. */
  modelCallTimeoutMs: number;
  /** Per-attempt ceiling on a single tool call, unless the tool sets its own. */
  toolCallTimeoutMs: number;
  /** Retries after a *transient* model failure. 0 disables model retries. */
  maxModelRetries: number;
  /** Retries after a transient failure in a tool declared retry-safe. */
  maxToolRetries: number;
  /** First backoff delay; grows by {@link backoffFactor} up to the max. */
  retryInitialDelayMs: number;
  retryMaxDelayMs: number;
  backoffFactor: number;
  /** Randomise backoff so concurrent runs do not retry in lockstep. */
  retryJitter: boolean;
  /**
   * How many times the same tool may be called with byte-identical arguments
   * before the run is stopped for making no progress.
   */
  maxRepeatedToolCalls: number;
  /** Tool results larger than this are refused rather than fed to the model. */
  maxToolResultChars: number;
  /**
   * Soft budget for the assembled model context. Exceeding it does not fail a
   * run - it is recorded, so the need for compaction is visible before it is
   * built. See `harness/README.md`.
   */
  maxContextChars: number;
}

export const DEFAULT_SAM_EXECUTION_POLICY: SamExecutionPolicy = {
  maxModelCalls: 8,
  maxToolCalls: 12,
  maxCallsPerTool: {},
  maxOutputTokens: DEFAULT_SAM_MAX_TOKENS,
  runDeadlineMs: 60_000,
  modelCallTimeoutMs: 30_000,
  toolCallTimeoutMs: 15_000,
  maxModelRetries: 2,
  maxToolRetries: 2,
  retryInitialDelayMs: 500,
  retryMaxDelayMs: 8_000,
  backoffFactor: 2,
  retryJitter: true,
  maxRepeatedToolCalls: 2,
  maxToolResultChars: 8_000,
  maxContextChars: 12_000,
};

/**
 * Resolves the policy for a run: defaults, then environment, then explicit
 * overrides (which tests and callers use).
 */
export const resolveSamExecutionPolicy = (
  overrides: Partial<SamExecutionPolicy> = {},
  toolPolicies: SamToolPolicyRegistry = SAM_TOOL_POLICIES
): SamExecutionPolicy => {
  const fromEnv: SamExecutionPolicy = {
    ...DEFAULT_SAM_EXECUTION_POLICY,
    maxModelCalls: readIntEnv(
      "SAM_MAX_MODEL_CALLS",
      DEFAULT_SAM_EXECUTION_POLICY.maxModelCalls
    ),
    maxToolCalls: readIntEnv(
      "SAM_MAX_TOOL_CALLS",
      DEFAULT_SAM_EXECUTION_POLICY.maxToolCalls
    ),
    maxOutputTokens: readIntEnv("SAM_MAX_TOKENS", DEFAULT_SAM_MAX_TOKENS),
    runDeadlineMs: readIntEnv(
      "SAM_RUN_DEADLINE_MS",
      DEFAULT_SAM_EXECUTION_POLICY.runDeadlineMs
    ),
    modelCallTimeoutMs: readIntEnv(
      "SAM_MODEL_TIMEOUT_MS",
      DEFAULT_SAM_EXECUTION_POLICY.modelCallTimeoutMs
    ),
    toolCallTimeoutMs: readIntEnv(
      "SAM_TOOL_TIMEOUT_MS",
      DEFAULT_SAM_EXECUTION_POLICY.toolCallTimeoutMs
    ),
    maxCallsPerTool: toolCallCeilings(toolPolicies),
  };

  return {
    ...fromEnv,
    ...overrides,
    maxCallsPerTool: { ...fromEnv.maxCallsPerTool, ...overrides.maxCallsPerTool },
  };
};

/**
 * LangGraph's own loop guard, derived rather than configured.
 *
 * It is a backstop behind the call budgets above - if it ever fires first, the
 * budgets were mis-set, not the graph.
 */
export const recursionLimitFor = (policy: SamExecutionPolicy): number =>
  2 * (policy.maxModelCalls + policy.maxToolCalls) + 10;
