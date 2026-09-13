"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Composer } from "@/components/chat/Composer";
import { EmptyConversation, MessageList } from "@/components/chat/MessageList";
import { ThreadSidebar, threadLabel } from "@/components/chat/ThreadSidebar";
import {
  createThread,
  listThreads,
  loadThread,
  sendMessage,
  type ChatMessage,
  type ChatThread,
} from "@/lib/chat/client";

const describe = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");

/**
 * The Sam conversation workspace.
 *
 * The server is the only source of conversation truth: every thread list and
 * every message list here comes from `/api/threads`, and a turn is re-read
 * from the database once its run ends rather than kept from what streamed.
 * Local state is a view of that, which is why a refresh restores everything.
 */
export function ChatWorkspace({ initialThreadId }: { initialThreadId?: string }) {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const [activeThreadId, setActiveThreadId] = useState<string | null>(initialThreadId ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(Boolean(initialThreadId));

  const [running, setRunning] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const runAbort = useRef<AbortController | null>(null);

  const refreshThreads = useCallback(async (signal?: AbortSignal) => {
    try {
      setThreads(await listThreads(signal));
    } catch (cause) {
      if (!signal?.aborted) setError(describe(cause));
    } finally {
      if (!signal?.aborted) setThreadsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      await refreshThreads(controller.signal);
    })();
    return () => controller.abort();
  }, [refreshThreads]);

  // Reading a thread is driven by which one is selected, so selection, a
  // refresh, and a deep link all take the same path through the API.
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      if (!activeThreadId) {
        setMessages([]);
        setMessagesLoading(false);
        return;
      }
      setMessagesLoading(true);
      try {
        const { messages: loaded } = await loadThread(activeThreadId, controller.signal);
        if (!controller.signal.aborted) {
          setMessages(loaded);
          setError(null);
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setMessages([]);
          setError(describe(cause));
        }
      } finally {
        if (!controller.signal.aborted) setMessagesLoading(false);
      }
    })();
    return () => controller.abort();
  }, [activeThreadId]);

  // Keeps the address bar pointing at the open thread without a navigation,
  // so a reload lands back in the same conversation.
  useEffect(() => {
    const next = activeThreadId ? `/chat?thread=${activeThreadId}` : "/chat";
    if (window.location.pathname + window.location.search !== next) {
      window.history.replaceState(null, "", next);
    }
  }, [activeThreadId]);

  useEffect(() => () => runAbort.current?.abort(), []);

  const select = (threadId: string) => {
    if (threadId === activeThreadId || running) return;
    setStreamingText("");
    setActiveThreadId(threadId);
  };

  const startNewThread = async () => {
    if (running) return;
    setCreating(true);
    setError(null);
    try {
      const thread = await createThread();
      setThreads((current) => [thread, ...current]);
      setStreamingText("");
      setActiveThreadId(thread.id);
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setCreating(false);
    }
  };

  const send = async (content: string) => {
    if (running) return;
    const controller = new AbortController();
    runAbort.current = controller;
    setError(null);
    setRunning(true);
    setStreamingText("");
    // Optimistic only until the run ends - the authoritative row replaces it.
    setMessages((current) => [
      ...current,
      {
        id: `pending-${Date.now()}`,
        threadId: activeThreadId ?? "",
        role: "user",
        content,
        createdAt: new Date().toISOString(),
      },
    ]);

    let threadId = activeThreadId;
    try {
      for await (const event of sendMessage({ content, threadId: threadId ?? undefined, signal: controller.signal })) {
        if (event.type === "thread") {
          threadId = event.threadId;
          if (event.threadId !== activeThreadId) setActiveThreadId(event.threadId);
        }
        if (event.type === "delta") setStreamingText((current) => current + event.text);
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(describe(cause));
    } finally {
      runAbort.current = null;
      setRunning(false);
      setStreamingText("");
      if (threadId && !controller.signal.aborted) {
        try {
          const { messages: persisted } = await loadThread(threadId);
          setMessages(persisted);
        } catch (cause) {
          setError(describe(cause));
        }
        // A turn sent from the empty state created the thread server-side.
        if (!threads.some((thread) => thread.id === threadId)) void refreshThreads();
      } else if (!threadId) {
        setMessages((current) => current.filter((message) => !message.id.startsWith("pending-")));
      }
    }
  };

  const activeThread = threads.find((thread) => thread.id === activeThreadId) ?? null;
  const hasConversation = messages.length > 0 || running;

  return (
    <div className="flex h-dvh w-full overflow-hidden">
      <ThreadSidebar
        threads={threads}
        activeThreadId={activeThreadId}
        loading={threadsLoading}
        creating={creating}
        onSelect={select}
        onCreate={startNewThread}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 flex-none items-center border-b border-border px-6">
          <h1 className="truncate text-[15px] font-medium text-foreground">
            {activeThread ? threadLabel(activeThread) : "New conversation"}
          </h1>
        </header>

        {error && (
          <p role="alert" className="mx-auto w-full max-w-[46rem] px-6 pt-4 text-[13px] text-danger">
            {error}
          </p>
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {messagesLoading ? (
            <p className="mx-auto w-full max-w-[46rem] px-6 py-10 text-[13px] text-muted-2">Loading conversation…</p>
          ) : hasConversation ? (
            <MessageList messages={messages} streamingText={streamingText} running={running} />
          ) : (
            <EmptyConversation hint="Sam answers from your connected accounts and the financial model you set up in onboarding — runway, hiring, spend, growth." />
          )}
        </div>

        <div className="flex-none border-t border-border pt-4">
          <Composer onSend={send} running={running} disabled={messagesLoading} />
        </div>
      </main>
    </div>
  );
}
