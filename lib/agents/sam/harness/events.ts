import type {
  SamContextBudget,
  SamRunRecord,
  SamTokenUsage,
} from "@/lib/agents/sam/harness/observability";
import type { SamRunOutcome } from "@/lib/agents/sam/harness/outcome";
import type { SamToolKind } from "@/lib/agents/sam/tools/policy";

/**
 * Sam's run-event contract.
 *
 * This is the *public* shape of a run in flight, owned by us. LangChain and
 * LangGraph emit their own event formats; none of them appear here. A caller
 * builds against this union, and the day the agent runs on something else, this
 * file is the only thing that has to keep its promises.
 *
 * Two rules govern what may appear in an event:
 *
 * 1. **No private reasoning.** Thinking blocks, scratchpad content, raw tool
 *    arguments, and internal chain-of-thought never leave the harness. Only
 *    assistant-visible text is streamed.
 * 2. **No raw payloads.** Tool events carry the shape of a result - name, kind,
 *    status, duration, size - and a summary only where the tool has explicitly
 *    declared one safe to show.
 *
 * Every event carries the run identity and metadata the execution harness
 * already tracks, rather than a second bookkeeping system alongside it.
 */

/** What set this run going. Room for proactive/background Sam without a break. */
export type SamRunTrigger = "user" | "system";

interface SamEventBase {
  /** The harness run id. Correlates every event, log line, and record. */
  runId: string;
  /** Monotonic within a run, starting at 0. Gives a total order. */
  seq: number;
  /** ISO timestamp the event was emitted. */
  at: string;
}

/** The run has been accepted and the execution budget is now ticking. */
export interface SamRunStartedEvent extends SamEventBase {
  type: "run_started";
  requestId: string;
  companyId: string;
  threadId?: string;
  model: string;
  trigger: SamRunTrigger;
}

/**
 * The model context for this turn has been assembled.
 *
 * Counts and sizes only - what was retrieved is company knowledge, and does not
 * belong in an event stream.
 */
export interface SamContextBuiltEvent extends SamEventBase {
  type: "context_built";
  memoryCount: number;
  threadNoteCount: number;
  budget: SamContextBudget;
}

/** An optional dependency failed; the run continues with less context. */
export interface SamContextFailedEvent extends SamEventBase {
  type: "context_failed";
  error: string;
  retryable: boolean;
}

export interface SamModelStartedEvent extends SamEventBase {
  type: "model_started";
  /** 0-based attempt index within the run, retries included. */
  index: number;
}

export interface SamModelCompletedEvent extends SamEventBase {
  type: "model_completed";
  index: number;
  durationMs: number;
  usage?: SamTokenUsage;
}

export interface SamModelFailedEvent extends SamEventBase {
  type: "model_failed";
  index: number;
  durationMs: number;
  error: string;
  /** True when the harness will try again. */
  retryable: boolean;
}

/**
 * A fragment of the assistant's visible reply.
 *
 * Only content the founder is meant to read. Reasoning blocks and tool-argument
 * fragments are filtered out before this is emitted, and a provider that does
 * not stream simply produces one delta at the end.
 */
export interface SamMessageDeltaEvent extends SamEventBase {
  type: "message_delta";
  text: string;
}

interface SamToolEventBase extends SamEventBase {
  /** The model's id for this call. Ties started/completed/failed together. */
  callId: string;
  name: string;
  kind: SamToolKind;
}

/**
 * Sam has started using a tool.
 *
 * `label` is the tool's own declared phrasing - "Calculating runway" - so a UI
 * can say what is happening without inspecting arguments.
 */
export interface SamToolStartedEvent extends SamToolEventBase {
  type: "tool_started";
  label: string;
}

export interface SamToolCompletedEvent extends SamToolEventBase {
  type: "tool_completed";
  durationMs: number;
  /** Size of the result handed to the model, in characters. */
  resultChars: number;
  /** The result was refused for exceeding the policy's size cap. */
  truncated: boolean;
  /** Present only for tools that declared a sanitized summary. */
  summary?: string;
}

export interface SamToolFailedEvent extends SamToolEventBase {
  type: "tool_failed";
  durationMs: number;
  error: string;
  retryable: boolean;
  /** False when the run can still produce a valid answer without this call. */
  critical: boolean;
}

/** A repeat of a call already made, blocked by non-progress protection. */
export interface SamToolRepeatBlockedEvent extends SamToolEventBase {
  type: "tool_repeat_blocked";
  attempt: number;
}

/**
 * A state-changing tool is waiting on a human.
 *
 * The approval gate exists in the harness; no tool requires it yet. The event
 * is part of the contract now so the approval flow is a UI addition rather than
 * a change to what a run is allowed to say about itself.
 */
export interface SamToolAwaitingApprovalEvent extends SamToolEventBase {
  type: "tool_awaiting_approval";
  label: string;
}

/** The run produced an answer. Terminal. */
export interface SamRunCompletedEvent extends SamEventBase {
  type: "run_completed";
  outcome: "completed";
  text: string;
  /** Completed, but something failed along the way. */
  degraded: boolean;
  run: SamRunRecord;
}

/**
 * The run stopped without an answer - budget, deadline, cancellation, or a
 * failure. Terminal, and never to be rendered as a reply.
 */
export interface SamRunTerminatedEvent extends SamEventBase {
  type: "run_terminated";
  outcome: Exclude<SamRunOutcome, "completed">;
  error: string;
  run: SamRunRecord;
}

export type SamRunEvent =
  | SamRunStartedEvent
  | SamContextBuiltEvent
  | SamContextFailedEvent
  | SamModelStartedEvent
  | SamModelCompletedEvent
  | SamModelFailedEvent
  | SamMessageDeltaEvent
  | SamToolStartedEvent
  | SamToolCompletedEvent
  | SamToolFailedEvent
  | SamToolRepeatBlockedEvent
  | SamToolAwaitingApprovalEvent
  | SamRunCompletedEvent
  | SamRunTerminatedEvent;

export type SamRunEventType = SamRunEvent["type"];

/**
 * The one seam between Sam and whatever watches it.
 *
 * Keep it this narrow. A tracer, a metrics sink, a websocket, and a test spy
 * are all the same three lines; none of them can reach back into the run.
 */
export interface SamRunObserver {
  record(event: SamRunEvent): void;
}

/** Terminal events. Exactly one of these ends a run. */
export const isTerminalSamEvent = (
  event: SamRunEvent
): event is SamRunCompletedEvent | SamRunTerminatedEvent =>
  event.type === "run_completed" || event.type === "run_terminated";
