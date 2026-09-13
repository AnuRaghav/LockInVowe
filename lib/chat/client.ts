import type { ChartSpec } from "@/lib/charts/spec";
import { createStreamParser, type ChatStreamEvent } from "@/lib/chat/stream";

/**
 * Browser-side access to the existing conversation API. The server owns
 * canonical history, so nothing here caches beyond the current render: every
 * load re-reads `/api/threads`, which is what makes a refresh restore the
 * conversation.
 */

export interface ChatThread {
  id: string;
  name: string | null;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  /** Charts Sam drew for this answer, as the series to plot. */
  charts?: ChatChart[];
}

export interface ChatChart {
  id: string;
  spec: ChartSpec;
}

export class ChatRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ChatRequestError";
  }
}

const request = async (input: string, init?: RequestInit): Promise<unknown> => {
  const response = await fetch(input, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (body as { error?: unknown } | null)?.error;
    throw new ChatRequestError(typeof message === "string" ? message : "Request failed", response.status);
  }
  return body;
};

export const listThreads = async (signal?: AbortSignal): Promise<ChatThread[]> => {
  const body = (await request("/api/threads", { signal })) as { threads?: ChatThread[] };
  return body.threads ?? [];
};

export const createThread = async (): Promise<ChatThread> => {
  const body = (await request("/api/threads", { method: "POST" })) as { thread: ChatThread };
  return body.thread;
};

export const renameThread = async (threadId: string, name: string): Promise<ChatThread> => {
  const body = (await request(`/api/threads/${threadId}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  })) as { thread: ChatThread };
  return body.thread;
};

export const deleteThread = async (threadId: string): Promise<void> => {
  await request(`/api/threads/${threadId}`, { method: "DELETE" });
};

export const loadThread = async (
  threadId: string,
  signal?: AbortSignal,
): Promise<{ thread: ChatThread; messages: ChatMessage[] }> => {
  const body = (await request(`/api/threads/${threadId}`, { signal })) as {
    thread: ChatThread;
    messages?: ChatMessage[];
  };
  return { thread: body.thread, messages: body.messages ?? [] };
};

/**
 * Sends one turn to Sam and yields the server's stream as it arrives. The
 * route persists both the user message and Sam's answer itself, so callers
 * should treat what they render mid-stream as provisional and re-read the
 * thread once the run ends.
 */
export async function* sendMessage(
  { content, threadId, signal }: { content: string; threadId?: string; signal?: AbortSignal },
): AsyncGenerator<ChatStreamEvent> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content, threadId }),
    signal,
  });

  if (!response.ok || !response.body) {
    const body: unknown = await response.json().catch(() => null);
    const message = (body as { error?: unknown } | null)?.error;
    throw new ChatRequestError(
      typeof message === "string" ? message : "Sam could not be reached",
      response.status,
    );
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  const parser = createStreamParser();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield* parser.push(value);
    }
    yield* parser.flush();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
