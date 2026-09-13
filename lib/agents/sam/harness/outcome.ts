/**
 * How a Sam run ended, and how failures are classified on the way there.
 *
 * The contract for callers is the single most important thing in this file: a
 * run that returns text is not automatically a run that answered the question.
 * `completed` is the only outcome where Sam's text may be shown as an answer;
 * every other value means the run stopped against a budget or a failure, and
 * whatever text exists is partial.
 */
export type SamRunOutcome =
  | "completed"
  /** Ran out of model calls before Sam finished. */
  | "max_model_calls"
  /** Ran out of tool calls before Sam finished. */
  | "max_tool_calls"
  /** Repeated the same tool call with the same arguments and stopped moving. */
  | "no_progress"
  /** The run deadline elapsed. */
  | "timeout"
  /** The caller aborted the request. */
  | "cancelled"
  /** The model failed and retries did not recover it. */
  | "model_error"
  /** A tool failed in a way that aborted the run. */
  | "tool_error"
  /** Anything else that escaped the agent loop. */
  | "execution_error";

/** Only this outcome may be presented to a founder as an answer. */
export const isAnswered = (outcome: SamRunOutcome): boolean =>
  outcome === "completed";

/** Where in the run a failure happened. */
export type SamFailureStage = "context" | "model" | "tool" | "run";

export interface SamRunFailure {
  stage: SamFailureStage;
  /** Tool name, for tool-stage failures. */
  name?: string;
  message: string;
  /**
   * `false` when the run can still produce a valid answer without this
   * dependency - an optional memory lookup, say. `true` when it cannot, and
   * Sam must not pretend otherwise.
   */
  critical: boolean;
  retryable: boolean;
}

/** Base class for failures the harness itself raises. */
export class SamHarnessError extends Error {
  readonly outcome: SamRunOutcome;

  constructor(outcome: SamRunOutcome, message: string) {
    super(message);
    this.name = "SamHarnessError";
    this.outcome = outcome;
  }
}

/** The agent repeated an identical tool call past the policy's tolerance. */
export class SamNoProgressError extends SamHarnessError {
  readonly toolName: string;
  readonly attempts: number;

  constructor(toolName: string, attempts: number) {
    super(
      "no_progress",
      `Stopped: "${toolName}" was called ${attempts} times with identical arguments without the run advancing.`
    );
    this.name = "SamNoProgressError";
    this.toolName = toolName;
    this.attempts = attempts;
  }
}

/** A single model or tool attempt exceeded its per-call timeout. */
export class SamCallTimeoutError extends SamHarnessError {
  readonly stage: "model" | "tool";

  constructor(stage: "model" | "tool", timeoutMs: number, name?: string) {
    super(
      stage === "model" ? "model_error" : "tool_error",
      `${name ?? stage} call exceeded its ${timeoutMs}ms timeout.`
    );
    this.name = "SamCallTimeoutError";
    this.stage = stage;
  }
}

/**
 * Unwraps LangChain's `MiddlewareError`.
 *
 * A middleware that throws has its error re-thrown wrapped: the message and
 * name survive, but `status`, `code`, and the original class do not. The real
 * error is on `cause`, so every inspection below works on the innermost one.
 */
export const rootCause = (error: unknown): unknown => {
  let current = error;
  const seen = new Set<unknown>();

  while (
    current instanceof Error &&
    current.cause !== undefined &&
    !seen.has(current)
  ) {
    seen.add(current);
    current = current.cause;
  }

  return current;
};

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : "";

const errorStatus = (error: unknown): number | undefined => {
  const candidate = error as { status?: unknown; statusCode?: unknown } | null;
  const value = candidate?.status ?? candidate?.statusCode;
  return typeof value === "number" ? value : undefined;
};

const errorCode = (error: unknown): string | undefined => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
};

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** HTTP statuses worth a second attempt: throttling and server-side faults. */
const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

/** Socket-level faults that say nothing about whether the request was valid. */
const RETRYABLE_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
]);

/** Provider error classes that mean "try again", by name. */
const RETRYABLE_ERROR_NAMES = new Set([
  "APIConnectionError",
  "APIConnectionTimeoutError",
  "InternalServerError",
  "RateLimitError",
  "OverloadedError",
  "ServiceUnavailableError",
]);

export const isAbortError = (error: unknown): boolean =>
  errorName(error) === "AbortError" ||
  errorName(error) === "TimeoutError" ||
  (error as { code?: unknown } | null)?.code === "ABORT_ERR" ||
  errorMessage(error).toLowerCase().includes("aborted");

/**
 * Whether a failure is worth retrying.
 *
 * Deliberately a small allow-list rather than "retry unless it looks fatal".
 * A bad request, a schema violation, or a missing company context will fail the
 * same way every time; retrying those only burns the run's budget and delays
 * telling the founder something is wrong.
 */
export const isRetryableError = (error: unknown): boolean => {
  const cause = rootCause(error);

  // Cancellation and budget stops are decisions, not faults.
  if (isAbortError(error) || isAbortError(cause)) return false;
  if (cause instanceof SamNoProgressError) return false;

  // A call that timed out may well succeed on a second attempt - the run
  // deadline still bounds how long that can go on.
  if (cause instanceof SamCallTimeoutError) return true;
  if (cause instanceof SamHarnessError) return false;

  const status = errorStatus(cause);
  if (typeof status === "number") return RETRYABLE_STATUSES.has(status);

  const code = errorCode(cause);
  if (code && RETRYABLE_CODES.has(code)) return true;

  return RETRYABLE_ERROR_NAMES.has(errorName(cause));
};

export interface ClassifyOptions {
  /** Set when the caller aborted the request. */
  cancelled: boolean;
  /** Set when the run deadline elapsed. */
  timedOut: boolean;
  /**
   * Stage of the last failure the telemetry middleware saw. A provider error
   * reaches the caller as an opaque `Error`; this is how we know whether it
   * came out of the model or out of a tool.
   */
  lastFailureStage?: SamFailureStage;
}

/** Maps whatever escaped the agent loop onto a {@link SamRunOutcome}. */
export const classifyRunFailure = (
  error: unknown,
  { cancelled, timedOut, lastFailureStage }: ClassifyOptions
): SamRunOutcome => {
  const cause = rootCause(error);

  if (cause instanceof SamHarnessError && !isAbortError(cause)) {
    return cause.outcome;
  }
  // Check cancellation before the deadline: an explicit abort is the more
  // specific fact, even when both signals have fired by the time we look.
  if (cancelled) return "cancelled";
  if (timedOut) return "timeout";
  if (isAbortError(error) || isAbortError(cause)) return "cancelled";

  const name = errorName(cause);
  if (name === "ModelCallLimitMiddlewareError") return "max_model_calls";
  if (name === "ToolCallLimitExceededError") return "max_tool_calls";
  if (name === "GraphRecursionError") return "max_model_calls";
  // Names survive middleware wrapping even when the class does not.
  if (name === "SamNoProgressError") return "no_progress";

  if (lastFailureStage === "model") return "model_error";
  if (lastFailureStage === "tool") return "tool_error";

  return "execution_error";
};
