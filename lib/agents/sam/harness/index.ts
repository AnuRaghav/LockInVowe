/**
 * The Sam execution harness.
 *
 * A thin systems layer around the agent, not an orchestration framework. It
 * answers four questions about any run:
 *
 * - *How much may this cost?*   {@link SamExecutionPolicy}
 * - *How did it end?*           {@link SamRunOutcome}
 * - *What happened inside?*     {@link SamRunRecord} via {@link SamRunObserver}
 * - *What is a tool allowed to do?* the tool policy registry + middleware here
 *
 * Everything LangChain already does well - call budgets, retries with backoff,
 * cancellation, tool interception - is its native middleware. What lives here
 * is only what is specific to Sam.
 */
export {
  DEFAULT_SAM_EXECUTION_POLICY,
  recursionLimitFor,
  resolveSamExecutionPolicy,
  type SamExecutionPolicy,
} from "@/lib/agents/sam/harness/policy";

export {
  SamCallTimeoutError,
  SamHarnessError,
  SamNoProgressError,
  classifyRunFailure,
  errorMessage,
  isAbortError,
  isAnswered,
  isRetryableError,
  type SamFailureStage,
  type SamRunFailure,
  type SamRunOutcome,
} from "@/lib/agents/sam/harness/outcome";

export {
  NOOP_OBSERVER,
  SamRunRecorder,
  createSamRunId,
  createStructuredLogger,
  defaultSamRunObserver,
  summariseError,
  type SamContextBudget,
  type SamModelCallRecord,
  type SamRunEvent,
  type SamRunObserver,
  type SamRunRecord,
  type SamTokenUsage,
  type SamToolCallRecord,
} from "@/lib/agents/sam/harness/observability";

export { measureSamContext } from "@/lib/agents/sam/harness/context-budget";

export {
  createSamExecutionMiddleware,
  createSamNoProgressMiddleware,
  type SamToolApprovalRequest,
  type SamToolApprover,
} from "@/lib/agents/sam/harness/middleware";

export { buildSamMiddleware } from "@/lib/agents/sam/harness/run";
