/**
 * Reader for the AI SDK data-stream protocol that `app/api/chat/route.ts`
 * already speaks. Only the two frames the chat workspace needs are surfaced:
 * `0:` text deltas and the `2:` data frame carrying the thread id the server
 * committed the turn to. Everything else (tool lifecycle events) is ignored
 * here rather than reshaped, so the streaming contract stays the server's.
 */

export type ChatStreamEvent =
  | { type: "delta"; text: string }
  | { type: "thread"; threadId: string };

const dataFrameEvent = (value: unknown): ChatStreamEvent | null => {
  if (!value || typeof value !== "object") return null;
  const frame = value as { type?: unknown; threadId?: unknown };
  if (frame.type === "thread" && typeof frame.threadId === "string") {
    return { type: "thread", threadId: frame.threadId };
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
