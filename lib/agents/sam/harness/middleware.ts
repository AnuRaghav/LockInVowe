import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";

import {
  SamCallTimeoutError,
  SamNoProgressError,
  isRetryableError,
} from "@/lib/agents/sam/harness/outcome";
import {
  summariseError,
  type SamRunRecorder,
  type SamTokenUsage,
} from "@/lib/agents/sam/harness/observability";
import type { SamExecutionPolicy } from "@/lib/agents/sam/harness/policy";
import {
  SAM_TOOL_POLICIES,
  samToolLabel,
  samToolPolicy,
  type SamToolPolicy,
  type SamToolPolicyRegistry,
} from "@/lib/agents/sam/tools/policy";

/**
 * The two pieces of the harness that LangChain does not already ship.
 *
 * Everything else the harness enforces - call budgets, retries with backoff -
 * is native middleware, wired up in `agent.ts`. What is left is what is
 * specific to Sam: measuring a run, and governing the tool boundary.
 */

/** Caps one attempt without cancelling the surrounding run. */
const withTimeout = async <T>(
  work: Promise<T>,
  timeoutMs: number,
  makeError: () => Error
): Promise<T> => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return work;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(makeError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const readUsage = (message: unknown): SamTokenUsage | undefined => {
  const usage = (message as AIMessage | undefined)?.usage_metadata;
  if (!usage) return undefined;

  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0,
  };
};

const textOf = (message: ToolMessage): string =>
  typeof message.content === "string" ? message.content : JSON.stringify(message.content);

/** Reads the `{ ok }` envelope every Sam tool returns, when there is one. */
const envelopeOf = (
  content: string
): { ok?: boolean; error?: string; data?: unknown } => {
  try {
    const parsed = JSON.parse(content) as {
      ok?: boolean;
      error?: string;
      data?: unknown;
    };
    return typeof parsed?.ok === "boolean" ? parsed : {};
  } catch {
    return {};
  }
};

/**
 * Applies a tool's declared summariser, defensively.
 *
 * A summariser is application code we wrote, but it runs on a payload; if it
 * throws, the run must not care and nothing is summarised.
 */
const summaryOf = (policy: SamToolPolicy, data: unknown): string | undefined => {
  if (!policy.summarize) return undefined;
  try {
    return policy.summarize(data);
  } catch {
    return undefined;
  }
};

const toolEnvelope = (payload: Record<string, unknown>): string =>
  JSON.stringify({ ok: false, ...payload });

/**
 * The seam human approval will attach to.
 *
 * Sam only reads today, so no tool sets `requiresApproval` and no run is ever
 * gated. When the first state-changing tool lands, it flips that flag and the
 * caller supplies an approver; nothing in the agent loop changes.
 */
export interface SamToolApprovalRequest {
  runId: string;
  companyId: string;
  toolName: string;
  kind: SamToolPolicy["kind"];
  args: Record<string, unknown>;
}

export interface SamToolApprover {
  requestApproval(request: SamToolApprovalRequest): Promise<boolean>;
}

export interface SamExecutionMiddlewareOptions {
  recorder: SamRunRecorder;
  policy: SamExecutionPolicy;
  toolPolicies?: SamToolPolicyRegistry;
  approver?: SamToolApprover;
}

/**
 * Times every model and tool call, enforces per-call timeouts, applies each
 * tool's execution policy, and bounds what a tool is allowed to put back into
 * the context window.
 *
 * Failures are classified, not swallowed: a read-only retrieval that fails
 * degrades the run, while a calculation Sam needs to answer marks the run
 * critical so it can never be reported as a clean answer.
 */
export const createSamExecutionMiddleware = ({
  recorder,
  policy,
  toolPolicies = SAM_TOOL_POLICIES,
  approver,
}: SamExecutionMiddlewareOptions) =>
  createMiddleware({
    name: "SamExecutionMiddleware",

    async wrapModelCall(request, handler) {
      const index = recorder.modelStarted();
      const startedAt = Date.now();

      try {
        const response = await withTimeout(
          Promise.resolve(handler(request)),
          policy.modelCallTimeoutMs,
          () => new SamCallTimeoutError("model", policy.modelCallTimeoutMs)
        );

        recorder.modelCall(
          {
            durationMs: Date.now() - startedAt,
            ok: true,
            usage: readUsage(response),
          },
          index
        );

        return response;
      } catch (error) {
        const retryable = isRetryableError(error);
        recorder.failure({
          stage: "model",
          message: summariseError(error),
          // A transient fault may still be recovered by the retry middleware
          // sitting outside this one; anything else ends the run.
          critical: !retryable,
          retryable,
        });
        recorder.modelCall(
          {
            durationMs: Date.now() - startedAt,
            ok: false,
            error: summariseError(error),
          },
          index
        );
        throw error;
      }
    },

    async wrapToolCall(request, handler) {
      const { toolCall, runtime } = request;
      const name = toolCall.name;
      const callId = toolCall.id ?? name;
      const toolPolicyForCall = samToolPolicy(name, toolPolicies);
      const label = samToolLabel(name, toolPolicies);
      const startedAt = Date.now();

      const finish = (message: ToolMessage, truncated = false): ToolMessage => {
        const content = textOf(message);
        const { ok, error, data } = envelopeOf(content);
        const failed = ok === false;

        if (failed) {
          recorder.failure({
            stage: "tool",
            name,
            message: summariseError(error ?? "Tool returned an error."),
            // A number Sam was asked for is not optional; a retrieval that came
            // back empty-handed leaves the run usable but degraded.
            critical: toolPolicyForCall.kind !== "read_only",
            retryable: false,
          });
        }

        recorder.toolCall({
          callId,
          name,
          kind: toolPolicyForCall.kind,
          durationMs: Date.now() - startedAt,
          ok: !failed,
          error: failed ? summariseError(error ?? "Tool returned an error.") : undefined,
          resultChars: content.length,
          truncated,
          summary: failed ? undefined : summaryOf(toolPolicyForCall, data),
        });

        return message;
      };

      recorder.toolStarted({ callId, name, kind: toolPolicyForCall.kind, label });

      if (toolPolicyForCall.requiresApproval) {
        recorder.awaitingApproval({ callId, name, kind: toolPolicyForCall.kind, label });
        const context = runtime.context as { companyId?: string } | undefined;
        const approved = await approver?.requestApproval({
          runId: recorder.runId,
          companyId: context?.companyId ?? "",
          toolName: name,
          kind: toolPolicyForCall.kind,
          args: (toolCall.args ?? {}) as Record<string, unknown>,
        });

        if (!approved) {
          return finish(
            new ToolMessage({
              content: toolEnvelope({
                error: `"${name}" changes company state and needs the founder's approval, which this run cannot obtain. Tell the founder what you would do and ask them to confirm.`,
              }),
              tool_call_id: callId,
              name,
              status: "error",
            })
          );
        }
      }

      const timeoutMs = toolPolicyForCall.timeoutMs ?? policy.toolCallTimeoutMs;

      let result: ToolMessage;
      try {
        const raw = await withTimeout(
          Promise.resolve(handler(request)),
          timeoutMs,
          () => new SamCallTimeoutError("tool", timeoutMs, name)
        );

        // A tool may return a Command for control flow; pass it through
        // untouched rather than pretending to measure it.
        if (!(raw instanceof ToolMessage)) return raw;
        result = raw;
      } catch (error) {
        recorder.failure({
          stage: "tool",
          name,
          message: summariseError(error),
          critical: toolPolicyForCall.kind !== "read_only",
          retryable: isRetryableError(error) && toolPolicyForCall.retryable,
        });
        recorder.toolCall({
          callId,
          name,
          kind: toolPolicyForCall.kind,
          durationMs: Date.now() - startedAt,
          ok: false,
          error: summariseError(error),
          resultChars: 0,
          truncated: false,
        });
        throw error;
      }

      const content = textOf(result);
      if (content.length > policy.maxToolResultChars) {
        // Bounded tool results: a result too large to belong in the context
        // window is refused with instructions, not silently truncated into
        // malformed JSON the model would then reason over.
        return finish(
          new ToolMessage({
            content: toolEnvelope({
              error: `Result was ${content.length} characters, over the ${policy.maxToolResultChars} character limit. Narrow the request (for example a smaller \`limit\`) and call again.`,
              preview: content.slice(0, 500),
            }),
            tool_call_id: callId,
            name,
            status: "error",
          }),
          true
        );
      }

      return finish(result);
    },
  });

export interface SamNoProgressMiddlewareOptions {
  policy: SamExecutionPolicy;
  recorder: SamRunRecorder;
  toolPolicies?: SamToolPolicyRegistry;
}

/**
 * Stops a run that is repeating itself.
 *
 * Call budgets bound how long a loop can last; this bounds whether it is
 * allowed to start. A repeat of a call the run already made, byte for byte,
 * cannot produce a new result, so the second one is answered with a note
 * telling the model so, and a third ends the run as `no_progress`.
 *
 * It is registered outside the retry middleware on purpose: a retried attempt
 * is the same call by design and must not be mistaken for the model looping.
 */
export const createSamNoProgressMiddleware = ({
  policy,
  recorder,
  toolPolicies = SAM_TOOL_POLICIES,
}: SamNoProgressMiddlewareOptions) => {
  // One map per run - the middleware is built by the harness per invocation.
  const attempts = new Map<string, number>();

  return createMiddleware({
    name: "SamNoProgressMiddleware",

    async wrapToolCall(request, handler) {
      const { toolCall } = request;
      const signature = `${toolCall.name}:${JSON.stringify(toolCall.args ?? {})}`;
      const seen = (attempts.get(signature) ?? 0) + 1;
      attempts.set(signature, seen);

      if (seen > policy.maxRepeatedToolCalls) {
        throw new SamNoProgressError(toolCall.name, seen);
      }

      if (seen > 1) {
        recorder.repeatBlocked({
          callId: toolCall.id ?? toolCall.name,
          name: toolCall.name,
          kind: samToolPolicy(toolCall.name, toolPolicies).kind,
          attempt: seen,
        });

        return new ToolMessage({
          content: toolEnvelope({
            error: `You already called "${toolCall.name}" with exactly these arguments in this run. The result has not changed. Use the result you already have, or change your approach.`,
            repeatedCall: true,
          }),
          tool_call_id: toolCall.id ?? toolCall.name,
          name: toolCall.name,
          status: "error",
        });
      }

      return handler(request);
    },
  });
};
