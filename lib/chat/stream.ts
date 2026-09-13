/**
 * Reader for the AI SDK data-stream protocol that `app/api/chat/route.ts`
 * already speaks: `0:` frames carry visible assistant text, `2:` frames carry
 * the run lifecycle events the route has already stripped down to what is safe
 * to show. Nothing is reconstructed here - an unrecognised frame is dropped
 * rather than guessed at, so the server stays the only authority on what a run
 * is allowed to say about itself.
 */

/** Tool lifecycle, as much of it as the server chooses to expose. */
export interface ChatActivityEvent {
  type: "tool_started" | "tool_awaiting_approval" | "tool_completed" | "tool_failed";
  callId: string;
  name: string;
  /** The tool's own declared phrasing, never derived from its arguments. */
  label?: string;
  /** Present only where a tool declared a sanitized summary. */
  summary?: string;
  critical?: boolean;
  kind?: string;
  durationMs?: number;
}

export type ChatStreamEvent =
  | { type: "thread"; threadId: string }
  | { type: "delta"; text: string }
  | { type: "run_started"; runId: string }
  | { type: "run_completed"; degraded: boolean }
  | { type: "run_terminated"; outcome: string }
  | { type: "activity"; activity: ChatActivityEvent };

const string = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

const ACTIVITY_TYPES = new Set<ChatActivityEvent["type"]>([
  "tool_started",
  "tool_awaiting_approval",
  "tool_completed",
  "tool_failed",
]);

const dataFrameEvent = (value: unknown): ChatStreamEvent | null => {
  if (!value || typeof value !== "object") return null;
  const frame = value as Record<string, unknown>;
  const type = string(frame.type);
  if (!type) return null;

  if (type === "thread") {
    const threadId = string(frame.threadId);
    return threadId ? { type: "thread", threadId } : null;
  }
  if (type === "run_started") {
    const runId = string(frame.runId);
    return runId ? { type: "run_started", runId } : null;
  }
  if (type === "run_completed") return { type: "run_completed", degraded: frame.degraded === true };
  if (type === "run_terminated") {
    return { type: "run_terminated", outcome: string(frame.outcome) ?? "failed" };
  }
  if (ACTIVITY_TYPES.has(type as ChatActivityEvent["type"])) {
    const callId = string(frame.callId);
    const name = string(frame.name);
    if (!callId || !name) return null;
    return {
      type: "activity",
      activity: {
        type: type as ChatActivityEvent["type"],
        callId,
        name,
        label: string(frame.label),
        summary: string(frame.summary),
        critical: frame.critical === true,
        ...(typeof frame.kind === "string" ? { kind: frame.kind } : {}),
        ...(typeof frame.durationMs === "number" && Number.isFinite(frame.durationMs) && frame.durationMs >= 0
          ? { durationMs: frame.durationMs } : {}),
      },
    };
  }
  return null;
};

const parseLine = (line: string): ChatStreamEvent[] => {
  const separator = line.indexOf(":");
  if (separator < 0) return [];
  const prefix = line.slice(0, separator);
  let payload: unknown;
  try {
    payload = JSON.parse(line.slice(separator + 1));
  } catch {
    return [];
  }
  if (prefix === "0") return typeof payload === "string" ? [{ type: "delta", text: payload }] : [];
  if (prefix === "2" && Array.isArray(payload)) {
    return payload.map(dataFrameEvent).filter((event): event is ChatStreamEvent => event !== null);
  }
  return [];
};

/**
 * Stateful line assembler: a frame can be split across network chunks, so
 * partial trailing text is held until its newline arrives.
 */
export function createStreamParser() {
  let buffer = "";
  return {
    push(chunk: string): ChatStreamEvent[] {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      return lines.flatMap(parseLine);
    },
    /** Any frame left unterminated when the response body ends. */
    flush(): ChatStreamEvent[] {
      const rest = buffer;
      buffer = "";
      return rest.trim() ? parseLine(rest) : [];
    },
  };
}
