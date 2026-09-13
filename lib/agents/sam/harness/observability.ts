import { randomUUID } from "node:crypto";

import type { SamToolKind } from "@/lib/agents/sam/tools/policy";
import {
  errorMessage,
  type SamFailureStage,
  type SamRunFailure,
  type SamRunOutcome,
} from "@/lib/agents/sam/harness/outcome";

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
  name: string;
  kind: SamToolKind;
  durationMs: number;
  ok: boolean;
  error?: string;
  /** Size of the result handed to the model, in characters. */
  resultChars: number;
  /** True when the result was refused for exceeding the policy's size cap. */
  truncated: boolean;
}

export interface SamContextBudget {
  maxChars: number;
  systemPromptChars: number;
  /** Characters contributed by retrieved company context alone. */
  initialContextChars: number;
  memoryCount: number;
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

export type SamRunEvent =
  | { type: "run_start"; record: SamRunRecord }
  | { type: "model_call"; runId: string; call: SamModelCallRecord }
  | { type: "tool_call"; runId: string; call: SamToolCallRecord }
  | { type: "failure"; runId: string; failure: SamRunFailure }
  | { type: "run_end"; record: SamRunRecord };

/**
 * The one seam between Sam and whatever watches it.
 *
 * Keep it this narrow. A tracer, a metrics sink, and a test spy are all the
 * same three lines; none of them can reach back into the run.
 */
export interface SamRunObserver {
  record(event: SamRunEvent): void;
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
    if (event.type === "run_start" || event.type === "run_end") {
      const { record } = event;
      write(
        JSON.stringify({
          event: event.type,
          runId: record.runId,
          companyId: record.companyId,
          threadId: record.threadId,
          model: record.model,
          durationMs: record.durationMs,
          modelCalls: record.modelCallCount,
          toolCalls: record.toolCallCount,
          toolNames: record.toolNames,
          usage: record.usage,
          failures: record.failures.length,
          contextChars: record.contextBudget?.systemPromptChars,
          outcome: record.outcome,
          degraded: record.degraded,
        })
      );
      return;
    }

    write(JSON.stringify({ event: event.type, ...event }));
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
  observer?: SamRunObserver;
}

/**
 * Accumulates a {@link SamRunRecord} and forwards each event as it happens.
 *
 * One instance per run, created by the harness and handed to the middleware, so
 * nothing is shared between concurrent runs.
 */
export class SamRunRecorder {
  readonly record: SamRunRecord;

  private readonly observer: SamRunObserver;
  private readonly startedAtMs = Date.now();

  constructor({
    companyId,
    threadId,
    model,
    runId = createSamRunId(),
    requestId,
    observer = NOOP_OBSERVER,
  }: CreateRunRecorderOptions) {
    this.observer = observer;
    this.record = {
      runId,
      requestId: requestId ?? runId,
      companyId,
      threadId,
      model,
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

  start(): void {
    this.observer.record({ type: "run_start", record: this.record });
  }

  nextModelCallIndex(): number {
    return this.record.modelCalls.length;
  }

  modelCall(call: Omit<SamModelCallRecord, "index">): void {
    const entry: SamModelCallRecord = {
      index: this.record.modelCalls.length,
      ...call,
    };
    this.record.modelCalls.push(entry);
    if (entry.ok) this.record.modelCallCount += 1;
    if (entry.usage) {
      this.record.usage.inputTokens += entry.usage.inputTokens;
      this.record.usage.outputTokens += entry.usage.outputTokens;
      this.record.usage.totalTokens += entry.usage.totalTokens;
    }
    this.observer.record({
      type: "model_call",
      runId: this.runId,
      call: entry,
    });
  }

  toolCall(call: Omit<SamToolCallRecord, "index">): void {
    const entry: SamToolCallRecord = {
      index: this.record.toolCalls.length,
      ...call,
    };
    this.record.toolCalls.push(entry);
    this.record.toolCallCount += 1;
    this.record.toolNames.push(entry.name);
    this.observer.record({ type: "tool_call", runId: this.runId, call: entry });
  }

  failure(failure: SamRunFailure): void {
    this.record.failures.push(failure);
    this.observer.record({ type: "failure", runId: this.runId, failure });
  }

  /** Stage of the most recent failure, used to classify the run's outcome. */
  lastFailureStage(): SamFailureStage | undefined {
    return this.record.failures[this.record.failures.length - 1]?.stage;
  }

  contextBudget(budget: SamContextBudget): void {
    this.record.contextBudget = budget;
  }

  finish(outcome: SamRunOutcome): SamRunRecord {
    const endedAtMs = Date.now();
    this.record.outcome = outcome;
    // A run that reached an answer despite a failure along the way is not the
    // same as a clean one, and callers deserve to be able to tell.
    this.record.degraded = outcome === "completed" && this.record.failures.length > 0;
    this.record.endedAt = new Date(endedAtMs).toISOString();
    this.record.durationMs = endedAtMs - this.startedAtMs;
    this.observer.record({ type: "run_end", record: this.record });
    return this.record;
  }
}
