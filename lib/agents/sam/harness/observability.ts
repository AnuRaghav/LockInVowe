import { randomUUID } from "node:crypto";

import type {
  SamRunEvent,
  SamRunObserver,
  SamRunTrigger,
} from "@/lib/agents/sam/harness/events";
import {
  errorMessage,
  type SamFailureStage,
  type SamRunFailure,
  type SamRunOutcome,
} from "@/lib/agents/sam/harness/outcome";
import type { SamToolKind } from "@/lib/agents/sam/tools/policy";

/**
 * What one Sam run recorded about itself.
 *
 * Two rules keep this safe to ship anywhere:
 *
 * 1. It carries *shapes*, never payloads. Tool names, durations, counts, sizes
 *    - never tool arguments, never tool results, never a memory's content.
 *    A founder's cash position must not leak into a log aggregator.
 * 2. It is plain data behind {@link SamRunObserver}. Sam knows nothing about
 *    LangSmith, OpenTelemetry, or a database; pointing the record at one is a
 *    new observer and no change here.
 *
 * The recorder is also what makes a run *observable while it happens*: every
 * method both accumulates the record and emits an event from the contract in
 * `events.ts`, so live streaming and after-the-fact metadata are one mechanism
 * rather than two that can disagree.
 */

export interface SamTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface SamModelCallRecord {
  index: number;
  durationMs: number;
  ok: boolean;
  /** Truncated error message. Never a payload. */
  error?: string;
  usage?: SamTokenUsage;
}

export interface SamToolCallRecord {
  index: number;
  /** The model's id for this call, for correlating with the event stream. */
  callId: string;
  name: string;
  kind: SamToolKind;
  durationMs: number;
  ok: boolean;
  error?: string;
  /** Size of the result handed to the model, in characters. */
  resultChars: number;
  /** True when the result was refused for exceeding the policy's size cap. */
  truncated: boolean;
  /** Sanitized summary, only for tools that declared one. */
  summary?: string;
}

export interface SamContextBudget {
  maxChars: number;
  systemPromptChars: number;
  /** Characters contributed by retrieved company context alone. */
  initialContextChars: number;
  /**
   * Characters the company brief contributes.
   *
   * Tracked separately because it is the only part of the context paid for on
   * *every* run whether or not it is used. If the standing cost of a
   * conversation starts climbing, this is the number that shows it.
   */
  briefChars: number;
  /**
   * Topics listed in the company-knowledge directory.
   *
   * The count, never the topics. Answers "did Sam know this company had
   * opinions, and how many?" when reading a run back.
   */
  directoryEntryCount: number;
  /** True when current topics went unlisted, so the directory was incomplete. */
  directoryTruncated: boolean;
  /** `available`, `empty`, or `unavailable`. Whether a stated plan reached the run. */
  companyPlanStatus: string;
  transcriptMessageCount: number;
  /** Characters the replayed conversation contributes. The unbounded component. */
  transcriptChars: number;
  threadNoteCount: number;
  /** Rough, provider-independent estimate: characters / 4. */
  estimatedTokens: number;
  withinBudget: boolean;
}

export interface SamRunRecord {
  runId: string;
  /** Stable id for the originating request; equals `runId` unless supplied. */
  requestId: string;
  companyId: string;
  threadId?: string;
  model: string;
  trigger: SamRunTrigger;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  modelCallCount: number;
  toolCallCount: number;
  /** Tool names in call order. */
  toolNames: string[];
  modelCalls: SamModelCallRecord[];
  toolCalls: SamToolCallRecord[];
  failures: SamRunFailure[];
  usage: SamTokenUsage;
  contextBudget?: SamContextBudget;
  outcome?: SamRunOutcome;
  /** The run finished, but a non-critical dependency failed along the way. */
  degraded: boolean;
}

export const NOOP_OBSERVER: SamRunObserver = { record: () => {} };

/** Error text is bounded before it is recorded - messages can quote payloads. */
const MAX_ERROR_CHARS = 200;

export const summariseError = (error: unknown): string => {
  const message = errorMessage(error);
  return message.length > MAX_ERROR_CHARS
    ? `${message.slice(0, MAX_ERROR_CHARS)}...`
    : message;
};

/** Structured, single-line JSON logger. The default when nothing else is set. */
export const createStructuredLogger = (
  write: (line: string) => void = (line) => console.info(line)
): SamRunObserver => ({
  record(event) {
    if (event.type === "run_completed" || event.type === "run_terminated") {
      const { run } = event;
      write(
        JSON.stringify({
          event: event.type,
          runId: run.runId,
          companyId: run.companyId,
          threadId: run.threadId,
          model: run.model,
          durationMs: run.durationMs,
          modelCalls: run.modelCallCount,
          toolCalls: run.toolCallCount,
          toolNames: run.toolNames,
          usage: run.usage,
          failures: run.failures.length,
          contextChars: run.contextBudget?.systemPromptChars,
          transcriptChars: run.contextBudget?.transcriptChars,
          directoryEntries: run.contextBudget?.directoryEntryCount,
          directoryTruncated: run.contextBudget?.directoryTruncated,
          companyPlan: run.contextBudget?.companyPlanStatus,
          outcome: run.outcome,
          degraded: run.degraded,
        })
      );
      return;
    }

    // Message deltas are the founder's answer arriving a piece at a time;
    // logging them would duplicate the reply into the log stream.
    if (event.type === "message_delta") return;

    write(JSON.stringify(event));
  },
});

export const createSamRunId = (): string => `run_${randomUUID()}`;

/**
 * The observer a run uses when the caller does not supply one.
 *
 * Structured lines in normal operation; silent under test, where the assertions
 * read {@link SamRunRecord} directly and log noise helps nobody.
 */
export const defaultSamRunObserver = (): SamRunObserver =>
  process.env.NODE_ENV === "test" || process.env.SAM_LOG_RUNS === "false"
    ? NOOP_OBSERVER
    : createStructuredLogger();

export interface CreateRunRecorderOptions {
  companyId: string;
  threadId?: string;
  model: string;
  runId?: string;
  requestId?: string;
  trigger?: SamRunTrigger;
  observer?: SamRunObserver;
}

type EventPayload<T extends SamRunEvent["type"]> = Omit<
  Extract<SamRunEvent, { type: T }>,
  "runId" | "seq" | "at" | "type"
>;

/**
 * Accumulates a {@link SamRunRecord} and emits the run's events as they happen.
 *
 * One instance per run, created by the harness and handed to the middleware, so
 * nothing is shared between concurrent runs.
 */
export class SamRunRecorder {
  readonly record: SamRunRecord;

  private readonly observer: SamRunObserver;
  private readonly startedAtMs = Date.now();
  private seq = 0;

  constructor({
    companyId,
    threadId,
    model,
    runId = createSamRunId(),
    requestId,
    trigger = "user",
    observer = NOOP_OBSERVER,
  }: CreateRunRecorderOptions) {
    this.observer = observer;
    this.record = {
      runId,
      requestId: requestId ?? runId,
      companyId,
      threadId,
      model,
      trigger,
      startedAt: new Date(this.startedAtMs).toISOString(),
      modelCallCount: 0,
      toolCallCount: 0,
      toolNames: [],
      modelCalls: [],
      toolCalls: [],
      failures: [],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      degraded: false,
    };
  }

  get runId(): string {
    return this.record.runId;
  }

  get requestId(): string {
    return this.record.requestId;
  }

  /** Stamps identity and ordering onto an event, then hands it to the observer. */
  emit<T extends SamRunEvent["type"]>(type: T, payload: EventPayload<T>): void {
    this.observer.record({
      type,
      runId: this.record.runId,
      seq: this.seq++,
      at: new Date().toISOString(),
      ...payload,
      // The `type` and its payload are correlated by EventPayload<T> at every
      // call site; TypeScript cannot see that through the generic.
    } as unknown as SamRunEvent);
  }

  start(): void {
    this.emit("run_started", {
      requestId: this.record.requestId,
      companyId: this.record.companyId,
      threadId: this.record.threadId,
      model: this.record.model,
      trigger: this.record.trigger,
    });
  }

  contextBuilt(budget: SamContextBudget): void {
    this.record.contextBudget = budget;
    this.emit("context_built", {
      directoryEntryCount: budget.directoryEntryCount,
      companyPlanStatus: budget.companyPlanStatus,
      threadNoteCount: budget.threadNoteCount,
      budget,
    });
  }

  /** Reserves the index for an attempt about to be made. */
  modelStarted(): number {
    const index = this.record.modelCalls.length;
    this.emit("model_started", { index });
    return index;
  }

  modelCall(call: Omit<SamModelCallRecord, "index">, index: number): void {
    const entry: SamModelCallRecord = { index, ...call };
    this.record.modelCalls.push(entry);

    if (entry.ok) {
      this.record.modelCallCount += 1;
      if (entry.usage) {
        this.record.usage.inputTokens += entry.usage.inputTokens;
        this.record.usage.outputTokens += entry.usage.outputTokens;
        this.record.usage.totalTokens += entry.usage.totalTokens;
      }
      this.emit("model_completed", {
        index,
        durationMs: entry.durationMs,
        usage: entry.usage,
      });
      return;
    }

    const failure = this.record.failures[this.record.failures.length - 1];
    this.emit("model_failed", {
      index,
      durationMs: entry.durationMs,
      error: entry.error ?? "Model call failed.",
      retryable: failure?.stage === "model" ? failure.retryable : false,
    });
  }

  toolStarted(tool: { callId: string; name: string; kind: SamToolKind; label: string }): void {
    this.emit("tool_started", tool);
  }

  awaitingApproval(tool: {
    callId: string;
    name: string;
    kind: SamToolKind;
    label: string;
  }): void {
    this.emit("tool_awaiting_approval", tool);
  }

  toolCall(call: Omit<SamToolCallRecord, "index">): void {
    const entry: SamToolCallRecord = {
      index: this.record.toolCalls.length,
      ...call,
    };
    this.record.toolCalls.push(entry);
    this.record.toolCallCount += 1;
    this.record.toolNames.push(entry.name);

    const shared = {
      callId: entry.callId,
      name: entry.name,
      kind: entry.kind,
      durationMs: entry.durationMs,
    };

    if (entry.ok) {
      this.emit("tool_completed", {
        ...shared,
        resultChars: entry.resultChars,
        truncated: entry.truncated,
        summary: entry.summary,
      });
      return;
    }

    const failure = this.record.failures[this.record.failures.length - 1];
    this.emit("tool_failed", {
      ...shared,
      error: entry.error ?? "Tool call failed.",
      retryable: failure?.name === entry.name ? failure.retryable : false,
      critical: failure?.name === entry.name ? failure.critical : true,
    });
  }

  repeatBlocked(tool: {
    callId: string;
    name: string;
    kind: SamToolKind;
    attempt: number;
  }): void {
    this.failure({
      stage: "tool",
      name: tool.name,
      message: `Blocked repeat #${tool.attempt} of an identical call.`,
      critical: false,
      retryable: false,
    });
    this.emit("tool_repeat_blocked", tool);
  }

  contextFailed(error: unknown, retryable: boolean): void {
    const message = summariseError(error);
    this.failure({ stage: "context", message, critical: false, retryable });
    this.emit("context_failed", { error: message, retryable });
  }

  /**
   * Records a failure without emitting.
   *
   * The event for a model or tool failure is emitted by the call that failed,
   * so it carries that call's timing; this keeps the record complete without
   * duplicating the event.
   */
  failure(failure: SamRunFailure): void {
    this.record.failures.push(failure);
  }

  /** Stage of the most recent failure, used to classify the run's outcome. */
  lastFailureStage(): SamFailureStage | undefined {
    return this.record.failures[this.record.failures.length - 1]?.stage;
  }

  finish(outcome: SamRunOutcome, detail: { text?: string; error?: string } = {}): SamRunRecord {
    const endedAtMs = Date.now();
    this.record.outcome = outcome;
    this.record.endedAt = new Date(endedAtMs).toISOString();
    this.record.durationMs = endedAtMs - this.startedAtMs;
    // A run that reached an answer despite a failure along the way is not the
    // same as a clean one, and callers deserve to be able to tell.
    this.record.degraded = outcome === "completed" && this.record.failures.length > 0;

    if (outcome === "completed") {
      this.emit("run_completed", {
        outcome,
        text: detail.text ?? "",
        degraded: this.record.degraded,
        run: this.record,
      });
    } else {
      this.emit("run_terminated", {
        outcome,
        error: detail.error ?? "The run did not complete.",
        run: this.record,
      });
    }

    return this.record;
  }
}
