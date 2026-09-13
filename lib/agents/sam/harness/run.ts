import {
  modelCallLimitMiddleware,
  modelRetryMiddleware,
  toolCallLimitMiddleware,
  toolRetryMiddleware,
  type AnyAgentMiddleware,
} from "langchain";

import {
  createSamExecutionMiddleware,
  createSamNoProgressMiddleware,
  type SamToolApprover,
} from "@/lib/agents/sam/harness/middleware";
import { isRetryableError } from "@/lib/agents/sam/harness/outcome";
import type { SamRunRecorder } from "@/lib/agents/sam/harness/observability";
import type { SamExecutionPolicy } from "@/lib/agents/sam/harness/policy";
import {
  SAM_TOOL_POLICIES,
  type SamToolPolicyRegistry,
} from "@/lib/agents/sam/tools/policy";

/**
 * Assembles the middleware stack one Sam run executes inside.
 *
 * Order is the design, so it is worth reading top to bottom - earlier entries
 * wrap later ones:
 *
 * 1. no-progress   - sees the model's calls before any retry could duplicate one
 * 2. call limits   - refuse the call rather than spend budget discovering it
 * 3. retries       - recover transient faults around the real attempt
 * 4. execution     - times the attempt, enforces its timeout, governs the tool
 *
 * Limits and retries are LangChain's own middleware. Only the first and last
 * entries are ours, because only those are specific to Sam.
 */
export interface SamMiddlewareOptions {
  policy: SamExecutionPolicy;
  recorder: SamRunRecorder;
  toolPolicies?: SamToolPolicyRegistry;
  approver?: SamToolApprover;
}

const namesOfKind = (
  registry: SamToolPolicyRegistry,
  kind: "read_only" | "calculation" | "action"
): string[] =>
  Object.entries(registry)
    .filter(([, policy]) => policy.kind === kind && policy.retryable)
    .map(([name]) => name);

export const buildSamMiddleware = ({
  policy,
  recorder,
  toolPolicies = SAM_TOOL_POLICIES,
  approver,
}: SamMiddlewareOptions): AnyAgentMiddleware[] => {
  const backoff = {
    maxRetries: policy.maxToolRetries,
    retryOn: isRetryableError,
    initialDelayMs: policy.retryInitialDelayMs,
    maxDelayMs: policy.retryMaxDelayMs,
    backoffFactor: policy.backoffFactor,
    jitter: policy.retryJitter,
  };

  const retrievalTools = namesOfKind(toolPolicies, "read_only");
  const calculationTools = namesOfKind(toolPolicies, "calculation");

  const middleware: AnyAgentMiddleware[] = [
    createSamNoProgressMiddleware({ policy, recorder }),

    modelCallLimitMiddleware({
      runLimit: policy.maxModelCalls,
      // Surface the stop as a typed failure the harness maps to an outcome,
      // rather than letting a budget stop look like a finished answer.
      exitBehavior: "error",
    }),

    toolCallLimitMiddleware({
      runLimit: policy.maxToolCalls,
      exitBehavior: "error",
    }),

    // Stricter ceilings for individual expensive tools. Nothing declares one
    // yet; a tool that needs one adds `maxCallsPerRun` to its policy.
    ...Object.entries(policy.maxCallsPerTool).map(([toolName, runLimit]) =>
      toolCallLimitMiddleware({ toolName, runLimit, exitBehavior: "error" })
    ),
  ];

  if (policy.maxModelRetries > 0) {
    middleware.push(
      modelRetryMiddleware({
        ...backoff,
        maxRetries: policy.maxModelRetries,
        onFailure: "error",
      })
    );
  }

  if (policy.maxToolRetries > 0 && retrievalTools.length > 0) {
    // Retrieval is optional to the answer: hand the failure to the model as a
    // tool result and let it say what it could not find.
    // Named, because two retry policies coexist and middleware names must be
    // unique within one agent.
    middleware.push(
      Object.assign(
        toolRetryMiddleware({ ...backoff, tools: retrievalTools, onFailure: "continue" }),
        { name: "SamRetrievalRetryMiddleware" }
      )
    );
  }

  if (policy.maxToolRetries > 0 && calculationTools.length > 0) {
    // A figure Sam was asked for is not optional. If the calculation cannot be
    // produced, the run fails rather than continuing toward a confident answer
    // built on nothing.
    middleware.push(
      Object.assign(
        toolRetryMiddleware({ ...backoff, tools: calculationTools, onFailure: "error" }),
        { name: "SamCalculationRetryMiddleware" }
      )
    );
  }

  middleware.push(
    createSamExecutionMiddleware({ recorder, policy, toolPolicies, approver })
  );

  return middleware;
};
