import type { BaseMessage } from "@langchain/core/messages";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { createAgent } from "langchain";

import { DEFAULT_SAM_MODEL, type SamModelConfig } from "@/lib/agents/sam/config";
import {
  samRuntimeContextSchema,
  financialSession,
  type SamRuntimeContext,
} from "@/lib/agents/sam/context";
import {
  createSamContextBuilder,
  type SamContextBuilder,
  type SamInitialContext,
} from "@/lib/agents/sam/context-builder";
import { measureSamContext } from "@/lib/agents/sam/harness/context-budget";
import type {
  SamRunObserver,
  SamRunTrigger,
} from "@/lib/agents/sam/harness/events";
import type { SamToolApprover } from "@/lib/agents/sam/harness/middleware";
import {
  SamRunRecorder,
  defaultSamRunObserver,
  summariseError,
  type SamRunRecord,
} from "@/lib/agents/sam/harness/observability";
import {
  classifyRunFailure,
  isRetryableError,
  type SamRunFailure,
  type SamRunOutcome,
} from "@/lib/agents/sam/harness/outcome";
import {
  recursionLimitFor,
  resolveSamExecutionPolicy,
  type SamExecutionPolicy,
} from "@/lib/agents/sam/harness/policy";
import { buildSamMiddleware } from "@/lib/agents/sam/harness/run";
import { createSamModel } from "@/lib/agents/sam/model";
import { SAM_SYSTEM_PROMPT, buildSamSystemPrompt } from "@/lib/agents/sam/prompt";
import { loadFinancialSnapshot } from "@/lib/finance/sam-surface";
import { samAnswerSchema, type SamAnswer, type SamToolCall } from "@/lib/agents/sam/schemas";
import { SAM_TOOLS } from "@/lib/agents/sam/tools";
import type { SamToolPolicyRegistry } from "@/lib/agents/sam/tools/policy";

export interface CreateSamAgentOptions {
  /** Override model, key, token cap, or effort. Defaults come from the env. */
  model?: Partial<SamModelConfig>;
  /** Replace the tool registry. Mainly useful for tests. */
  tools?: typeof SAM_TOOLS;
  /** Replace the system prompt. Company context should be appended, not inlined. */
  systemPrompt?: string;
  /** Override any part of the run's execution budget. */
  policy?: Partial<SamExecutionPolicy>;
  /** Override how individual tools are governed. Mainly useful for tests. */
  toolPolicies?: SamToolPolicyRegistry;
  /** Where approval for a state-changing tool will be obtained. Unused today. */
  approver?: SamToolApprover;
}

interface AgentAssemblyOptions extends CreateSamAgentOptions {
  recorder: SamRunRecorder;
  resolvedPolicy: SamExecutionPolicy;
}

const agentParams = ({
  model,
  tools = SAM_TOOLS,
  systemPrompt = SAM_SYSTEM_PROMPT,
  toolPolicies,
  approver,
  recorder,
  resolvedPolicy,
}: AgentAssemblyOptions) => ({
  // The per-model-call output cap is part of the execution policy, so it is
  // set here rather than being a second, separate notion of "how big".
  model: createSamModel({ maxTokens: resolvedPolicy.maxOutputTokens, ...model }),
  tools,
  systemPrompt,
  contextSchema: samRuntimeContextSchema,
  middleware: buildSamMiddleware({
    policy: resolvedPolicy,
    recorder,
    toolPolicies,
    approver,
  }),
});

const assemblyFor = (options: CreateSamAgentOptions): AgentAssemblyOptions => {
  const resolvedPolicy = resolveSamExecutionPolicy(
    options.policy,
    options.toolPolicies
  );

  return {
    ...options,
    resolvedPolicy,
    recorder: new SamRunRecorder({
      companyId: "unknown",
      model: options.model?.model ?? DEFAULT_SAM_MODEL,
    }),
  };
};

/**
 * Builds a Sam agent: a Claude model, the tool registry, the system prompt, and
 * the execution harness the loop runs inside.
 *
 * The model chooses which tools to call; the tools own every calculation; the
 * harness owns how much all of that is allowed to cost.
 */
export const createSamAgent = (options: CreateSamAgentOptions = {}) =>
  createAgent(agentParams(assemblyFor(options)));

/** Same agent, but constrained to return a typed {@link SamAnswer}. */
export const createStructuredSamAgent = (options: CreateSamAgentOptions = {}) =>
  createAgent({
    ...agentParams(assemblyFor(options)),
    responseFormat: samAnswerSchema,
  });

export interface SamRunInput extends CreateSamAgentOptions {
  /** A single founder question, or a full conversation to continue. */
  messages: string | BaseMessage[];
  /**
   * Trusted execution context, resolved by the caller before the run starts.
   *
   * This is the only way a company reaches a tool. It is never part of the
   * model's tool arguments, so Claude can choose *what* to call but never
   * *whose data* it touches.
   */
  context: SamRuntimeContext;
  /**
   * Decides what Sam starts the turn knowing.
   *
   * A first-class dependency, not logic inside the agent: swap it and Sam
   * opens with different memory, different numerical state, or different
   * source-derived facts, with nothing in this file changing.
   */
  contextBuilder?: SamContextBuilder;
  /** Cancellation from the caller - a closed HTTP connection, say. */
  signal?: AbortSignal;
  /** Identity for this execution. Generated when absent. */
  runId?: string;
  /** Identity of the originating request, when the caller already has one. */
  requestId?: string;
  /** What set this run going. Defaults to a founder asking. */
  trigger?: SamRunTrigger;
  /** Where execution metadata goes. Defaults to a structured logger. */
  observer?: SamRunObserver;
}

export interface SamRunResult {
  /**
   * How the run ended. `completed` is the only value where {@link text} is an
   * answer; anything else means Sam stopped against a budget or a failure and
   * the caller must not present the text as a reply.
   */
  outcome: SamRunOutcome;
  /** Shorthand for `outcome === "completed"`. */
  ok: boolean;
  /** Sam's final reply text. Empty when the run did not complete. */
  text: string;
  /** The context the builder selected for this run, before formatting. */
  initialContext: SamInitialContext;
  /** Tools the agent invoked, in call order. */
  toolCalls: SamToolCall[];
  /** Full message history, for persisting or continuing the conversation. */
  messages: BaseMessage[];
  /** Execution metadata: ids, counts, durations, usage, termination reason. */
  run: SamRunRecord;
  /** Everything that went wrong, whether or not the run recovered. */
  failures: SamRunFailure[];
  /** The run completed, but something failed along the way. */
  degraded: boolean;
  /** The terminal error, for a run that did not complete. */
  error?: string;
}

export interface SamStructuredRunResult extends SamRunResult {
  /** Present only when the run completed. */
  structured?: SamAnswer;
}

const toMessages = (messages: SamRunInput["messages"]): BaseMessage[] =>
  typeof messages === "string" ? [new HumanMessage(messages)] : messages;

const collectToolCalls = (messages: BaseMessage[]): SamToolCall[] =>
  messages
    .filter((message): message is AIMessage => message instanceof AIMessage)
    .flatMap((message) => message.tool_calls ?? [])
    .map(({ name, args }) => ({ name, args }));

const finalText = (messages: BaseMessage[]): string =>
  messages[messages.length - 1]?.text ?? "";

/** The founder's latest request - what the context builder selects against. */
const latestRequest = (messages: BaseMessage[]): string =>
  [...messages].reverse().find((message) => message instanceof HumanMessage)?.text ?? "";

const emptyContext = (companyId: string): SamInitialContext => ({
  companyId,
  thread: null,
  brief: null,
  memories: [],
  numerical: { status: "unavailable", reason: "context_not_loaded" },
});

/**
 * Resolves the trusted context, opens the run record, and assembles what Claude
 * will be told.
 *
 * The context builder is treated as an *optional* dependency: if memory cannot
 * be reached, the run opens with nothing selected and is marked degraded rather
 * than failing outright. Sam can still call the retrieval tools mid-loop, and
 * the founder is better served by a narrower answer than by an error.
 *
 * @internal Shared by `runSamAgent` and `streamSamAgent`.
 */
export const prepareSamRun = async (
  input: SamRunInput,
  /** Extra cancellation, e.g. a stream consumer that walked away. */
  extraSignal?: AbortSignal
) => {
  const runtime = samRuntimeContextSchema.parse(input.context);
  // Shared successful read for baseline and tools; no cross-run/global cache.
  runtime.financials = financialSession(runtime);
  const policy = resolveSamExecutionPolicy(input.policy, input.toolPolicies);
  const history = toMessages(input.messages);

  const recorder = new SamRunRecorder({
    companyId: runtime.companyId,
    threadId: runtime.threadId,
    model: input.model?.model ?? process.env.SAM_MODEL ?? DEFAULT_SAM_MODEL,
    runId: input.runId ?? runtime.runId,
    requestId: input.requestId ?? runtime.requestId,
    trigger: input.trigger,
    observer: input.observer ?? defaultSamRunObserver(),
  });
  recorder.start();

  const contextBuilder = input.contextBuilder ?? createSamContextBuilder();
  let initialContext = emptyContext(runtime.companyId);
  try {
    initialContext = await contextBuilder.build({
      runtime,
      request: latestRequest(history),
    });
  } catch (error) {
    recorder.contextFailed(error, isRetryableError(error));
  }

  // A semantic/context-provider failure must not erase independently available financial facts.
  if (!initialContext.numerical || (initialContext.numerical.status === "unavailable" && initialContext.numerical.reason === "context_not_loaded")) {
    initialContext.numerical = await loadFinancialSnapshot(runtime.financials);
  }
  if (initialContext.numerical?.status === "unavailable" && initialContext.numerical.reason !== "context_not_loaded") {
    recorder.contextFailed(new Error("Numerical context unavailable"), false);
  }
  const systemPrompt = input.systemPrompt ?? buildSamSystemPrompt(initialContext);
  recorder.contextBuilt(
    measureSamContext({
      systemPrompt,
      initialContext,
      maxChars: policy.maxContextChars,
    })
  );

  // Run identity travels with the trusted context so a future state-changing
  // tool can key an idempotent write on it. It is still server-supplied: the
  // model cannot see it or choose it.
  const invokeContext: SamRuntimeContext = {
    ...runtime,
    runId: recorder.runId,
    requestId: recorder.requestId,
  };

  // Cancellation the *caller* asked for, kept apart from the deadline so a
  // stopped run can be told from one that ran out of time.
  const cancellation = [input.signal, extraSignal].filter(
    (signal): signal is AbortSignal => signal !== undefined
  );
  const callerSignal =
    cancellation.length > 0 ? AbortSignal.any(cancellation) : undefined;

  const deadline = AbortSignal.timeout(policy.runDeadlineMs);
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, deadline])
    : deadline;

  return {
    runtime,
    invokeContext,
    history,
    initialContext,
    systemPrompt,
    policy,
    recorder,
    deadline,
    callerSignal,
    signal,
    invokeConfig: {
      context: invokeContext,
      signal,
      recursionLimit: recursionLimitFor(policy),
    },
  };
};

export type PreparedSamRun = Awaited<ReturnType<typeof prepareSamRun>>;

/** @internal Builds the agent for a prepared run. */
export const buildSamAgent = (
  input: SamRunInput,
  prepared: PreparedSamRun,
  structured = false
) => {
  const params = agentParams({
    ...input,
    systemPrompt: prepared.systemPrompt,
    recorder: prepared.recorder,
    resolvedPolicy: prepared.policy,
  });

  return structured
    ? createAgent({ ...params, responseFormat: samAnswerSchema })
    : createAgent(params);
};

interface SamFinalState {
  messages: BaseMessage[];
  structuredResponse?: SamAnswer;
}

type StreamedChunk = [mode: string, data: unknown];

/**
 * Runs the agent loop and returns its final state.
 *
 * This is *the* execution path. `runSamAgent` and `streamSamAgent` both come
 * through here, so there is one loop, one policy, and one set of events - the
 * difference between them is only whether anybody is listening to `onDelta`.
 *
 * @internal
 */
export const executeSamRun = async (
  agent: ReturnType<typeof buildSamAgent>,
  prepared: PreparedSamRun,
  onDelta?: (text: string) => void
): Promise<SamFinalState> => {
  const stream = await agent.stream(
    { messages: prepared.history },
    // `values` carries the state after each step, so the last one is the final
    // state; `messages` carries the model's output as it is produced.
    { ...prepared.invokeConfig, streamMode: ["values", "messages"] }
  );

  let finalState: SamFinalState = { messages: prepared.history };

  for await (const chunk of stream as AsyncIterable<StreamedChunk>) {
    const [mode, data] = chunk;

    if (mode === "values") {
      finalState = data as SamFinalState;
      continue;
    }

    if (mode === "messages" && onDelta) {
      const [message] = data as [BaseMessage, Record<string, unknown>];
      const text = visibleAssistantText(message);
      if (text) onDelta(text);
    }
  }

  return finalState;
};

/**
 * The part of a model message a founder is meant to read.
 *
 * Anthropic returns reasoning as separate content blocks alongside the reply.
 * Only `text` blocks are returned here, so thinking, redacted thinking, and
 * tool-argument fragments cannot reach a stream. Tool *results* arrive on this
 * channel too and are excluded outright - their sanitized form is the tool
 * event, not the transcript.
 */
export const visibleAssistantText = (message: BaseMessage): string => {
  if (!(message instanceof AIMessage)) return "";

  const { content } = message;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .filter(
      (block): block is { type: "text"; text: string } =>
        typeof block === "object" &&
        block !== null &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string"
    )
    .map((block) => block.text)
    .join("");
};

/** @internal Assembles the result of a run that reached an answer. */
export const completedSamResult = (
  prepared: PreparedSamRun,
  state: SamFinalState
): SamStructuredRunResult => {
  const text = state.structuredResponse?.answer ?? finalText(state.messages);
  const run = prepared.recorder.finish("completed", { text });

  return {
    outcome: "completed",
    ok: true,
    text,
    initialContext: prepared.initialContext,
    toolCalls: collectToolCalls(state.messages),
    messages: state.messages,
    structured: state.structuredResponse,
    run,
    failures: run.failures,
    degraded: run.degraded,
  };
};

/** @internal Assembles the result of a run that stopped without an answer. */
export const failedSamResult = (
  prepared: PreparedSamRun,
  error: unknown
): SamStructuredRunResult => {
  const outcome = classifyRunFailure(error, {
    cancelled: prepared.callerSignal?.aborted ?? false,
    timedOut: prepared.deadline.aborted,
    lastFailureStage: prepared.recorder.lastFailureStage(),
  });
  const message = summariseError(error);
  const run = prepared.recorder.finish(outcome, { error: message });

  return {
    outcome,
    ok: false,
    text: "",
    initialContext: prepared.initialContext,
    toolCalls: [],
    messages: prepared.history,
    run,
    failures: run.failures,
    degraded: run.degraded,
    error: message,
  };
};

/**
 * Public entry point: ask Sam a question.
 *
 * Never throws for an execution failure - a budget stop, a timeout, a
 * cancellation, or a provider error all come back as an {@link SamRunOutcome}
 * with the run's metadata attached. It *does* throw for a malformed call, such
 * as a run with no company context, because that is the caller's bug.
 */
export const runSamAgent = async (input: SamRunInput): Promise<SamRunResult> => {
  const prepared = await prepareSamRun(input);

  try {
    const state = await executeSamRun(buildSamAgent(input, prepared), prepared);
    return completedSamResult(prepared, state);
  } catch (error) {
    return failedSamResult(prepared, error);
  }
};

/** Same as {@link runSamAgent}, but the reply is parsed into a typed answer. */
export const runSamAgentStructured = async (
  input: SamRunInput
): Promise<SamStructuredRunResult> => {
  const prepared = await prepareSamRun(input);

  try {
    const state = await executeSamRun(
      buildSamAgent(input, prepared, true),
      prepared
    );
    return completedSamResult(prepared, state);
  } catch (error) {
    return failedSamResult(prepared, error);
  }
};
