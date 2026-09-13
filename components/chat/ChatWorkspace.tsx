"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { List, SidebarSimple } from "@phosphor-icons/react";

import { Composer } from "@/components/chat/Composer";
import { EmptyConversation, MessageList, type ChatNotice, type RunView } from "@/components/chat/MessageList";
import { ThreadSidebar, threadLabel } from "@/components/chat/ThreadSidebar";
import { applyActivityEvent, summarizeActivity, type ActivityStep } from "@/lib/chat/activity";
import {
  ChatRequestError,
  createThread,
  deleteThread,
  listThreads,
  loadThread,
  renameThread,
  sendMessage,
  type ChatMessage,
  type ChatThread,
} from "@/lib/chat/client";

const SIDEBAR_COLLAPSED_KEY = "sam.sidebarCollapsed";
const DESKTOP_QUERY = "(min-width: 768px)";

/** Collapsing is a desktop idea; below md the sidebar is a drawer regardless. */
const subscribeDesktop = (onChange: () => void) => {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

/** The collapsed preference, remembered per browser. Storage failures just mean "open". */
const collapsedListeners = new Set<() => void>();
const readCollapsed = () => {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
};
const writeCollapsed = (collapsed: boolean) => {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // Not remembered; the in-memory fallback below still toggles it.
  }
  memoryCollapsed = collapsed;
  collapsedListeners.forEach((listener) => listener());
};
let memoryCollapsed: boolean | null = null;
const subscribeCollapsed = (onChange: () => void) => {
  collapsedListeners.add(onChange);
  return () => collapsedListeners.delete(onChange);
};

/** Terminal outcomes the harness reports, said plainly and without blame. */
const TERMINATION_NOTICE: Record<string, ChatNotice> = {
  cancelled: { tone: "muted", text: "Stopped." },
  timeout: {
    tone: "error",
    text: "That took longer than Sam is allowed to spend on one question. Try narrowing it and ask again.",
  },
  max_model_calls: {
    tone: "error",
    text: "Sam ran out of room working through that one. Try asking for a piece of it at a time.",
  },
  max_tool_calls: {
    tone: "error",
    text: "Sam ran out of room working through that one. Try asking for a piece of it at a time.",
  },
  no_progress: {
    tone: "error",
    text: "Sam stopped making progress on that one. Try rephrasing the question.",
  },
};

const terminationNotice = (outcome: string): ChatNotice =>
  TERMINATION_NOTICE[outcome] ?? {
    tone: "error",
    text: "Something broke while Sam was working, so there's no answer to trust here. Try again in a moment.",
  };

const requestNotice = (error: unknown): ChatNotice => {
  if (error instanceof ChatRequestError) {
    if (error.status === 409) {
      return { tone: "error", text: "Sam is still working on the last question in this conversation." };
    }
    if (error.status === 401) {
      return { tone: "error", text: "Your session expired. Sign in again to keep talking to Sam." };
    }
    return { tone: "error", text: error.message };
  }
  return { tone: "error", text: "Sam could not be reached. Check your connection and try again." };
};

/**
 * The Sam conversation workspace.
 *
 * Two rules hold the whole thing together. The server is the only authority
 * on conversation content: the browser sends one message and a thread id,
 * never a transcript, and every turn is re-read from the database once its run
 * ends. And a run that did not produce an answer never leaves one behind -
 * a cancelled or failed run keeps the founder's message, drops whatever had
 * streamed, and says what happened.
 *
 * The financial model Sam reasons over is built during onboarding and reached
 * entirely through the backend; nothing about it is assembled, cached, or
 * second-guessed here.
 */
export function ChatWorkspace({ initialThreadId }: { initialThreadId?: string }) {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const desktop = useSyncExternalStore(subscribeDesktop, () => window.matchMedia(DESKTOP_QUERY).matches, () => false);
  const sidebarCollapsed = useSyncExternalStore(
    subscribeCollapsed,
    () => memoryCollapsed ?? readCollapsed(),
    () => false,
  );

  const [activeThreadId, setActiveThreadId] = useState<string | null>(initialThreadId ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(Boolean(initialThreadId));

  const [run, setRun] = useState<RunView | null>(null);
  const [notice, setNotice] = useState<ChatNotice | null>(null);
  /** Activity summaries for answers produced in this session, by message id. */
  const [summaries, setSummaries] = useState<Record<string, string>>({});

  const runAbort = useRef<AbortController | null>(null);
  /** The thread a live run owns; its own reconciliation reads it, not the loader. */
  const runThread = useRef<string | null>(null);
  const stopped = useRef(false);
  const mounted = useRef(true);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      runAbort.current?.abort();
    };
  }, []);


  const toggleSidebarCollapsed = () => writeCollapsed(!sidebarCollapsed);


  const refreshThreads = useCallback(async (signal?: AbortSignal) => {
    try {
      const listed = await listThreads(signal);
      if (!signal?.aborted) setThreads(listed);
    } catch (error) {
      if (!signal?.aborted) setNotice(requestNotice(error));
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
      // A run that just created this thread is already streaming into it;
      // re-reading here would blank the answer mid-flight.
      if (runThread.current === activeThreadId) {
        setMessagesLoading(false);
        return;
      }
      setMessagesLoading(true);
      try {
        const { messages: loaded } = await loadThread(activeThreadId, controller.signal);
        if (!controller.signal.aborted) setMessages(loaded);
      } catch (error) {
        if (!controller.signal.aborted) {
          setMessages([]);
          setNotice(requestNotice(error));
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

  // Follow the answer as it streams, but never yank a founder who scrolled up.
  useEffect(() => {
    const node = scroller.current;
    if (node && stickToBottom.current) node.scrollTop = node.scrollHeight;
  }, [messages, run, messagesLoading]);

  const select = (threadId: string) => {
    if (threadId === activeThreadId || run) return;
    setNotice(null);
    setSummaries({});
    stickToBottom.current = true;
    setSidebarOpen(false);
    setActiveThreadId(threadId);
  };

  const startNewThread = useCallback(async () => {
    if (runAbort.current) return;
    setCreating(true);
    setNotice(null);
    try {
      const thread = await createThread();
      setThreads((current) => [thread, ...current]);
      setSummaries({});
      stickToBottom.current = true;
      setSidebarOpen(false);
      setActiveThreadId(thread.id);
    } catch (error) {
      setNotice(requestNotice(error));
    } finally {
      setCreating(false);
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.defaultPrevented) return;
      if (event.key.toLowerCase() === "b") {
        event.preventDefault();
        if (window.matchMedia(DESKTOP_QUERY).matches) writeCollapsed(!(memoryCollapsed ?? readCollapsed()));
      }
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        void startNewThread();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [startNewThread]);

  const rename = async (threadId: string, name: string) => {
    const previous = threads;
    // Optimistic: the name changes as the input closes, and reverts if the save fails.
    setThreads((current) => current.map((thread) => (thread.id === threadId ? { ...thread, name } : thread)));
    try {
      const saved = await renameThread(threadId, name);
      setThreads((current) => current.map((thread) => (thread.id === threadId ? saved : thread)));
    } catch (error) {
      setThreads(previous);
      setNotice(requestNotice(error));
    }
  };

  const remove = async (threadId: string) => {
    try {
      await deleteThread(threadId);
      setThreads((current) => current.filter((thread) => thread.id !== threadId));
      if (threadId === activeThreadId) {
        setSummaries({});
        setNotice(null);
        setActiveThreadId(null);
      }
    } catch (error) {
      setNotice(requestNotice(error));
    }
  };

  const stop = () => {
    stopped.current = true;
    runAbort.current?.abort();
  };

  const send = async (content: string) => {
    if (run || runAbort.current) return;
    const controller = new AbortController();
    runAbort.current = controller;
    stopped.current = false;
    stickToBottom.current = true;
    setNotice(null);
    setRun({ phase: "submitting", steps: [], text: "" });
    // Optimistic only until the run ends - the persisted row replaces it.
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
    let steps: ActivityStep[] = [];
    let answer = "";
    let outcome: "completed" | "terminated" | null = null;
    let terminal: ChatNotice | null = null;

    try {
      for await (const event of sendMessage({ content, threadId: threadId ?? undefined, signal: controller.signal })) {
        switch (event.type) {
          case "thread":
            threadId = event.threadId;
            runThread.current = event.threadId;
            // A turn sent from the empty state created the thread server-side.
            if (event.threadId !== activeThreadId) setActiveThreadId(event.threadId);
            break;
          case "run_started":
            setRun((current) => (current ? { ...current, phase: "working" } : current));
            break;
          case "activity":
            steps = applyActivityEvent(steps, event.activity);
            setRun((current) => (current ? { ...current, steps } : current));
            break;
          case "delta":
            answer += event.text;
            setRun((current) => (current ? { ...current, text: answer } : current));
            break;
          case "run_completed":
            outcome = "completed";
            setRun((current) => (current ? { ...current, phase: "settling" } : current));
            break;
          case "run_terminated":
            // A terminated run persists no answer, and the apology the route
            // streams after this frame is not one either - drop what streamed
            // and let the notice say what happened.
            outcome = "terminated";
            terminal = terminationNotice(event.outcome);
            answer = "";
            setRun((current) => (current ? { ...current, phase: "settling", text: "" } : current));
            break;
        }
      }
    } catch (error) {
      if (stopped.current || controller.signal.aborted) {
        outcome = "terminated";
        terminal = TERMINATION_NOTICE.cancelled;
      } else {
        terminal = requestNotice(error);
      }
      answer = outcome === "completed" ? answer : "";
      setRun((current) => (current ? { ...current, phase: "settling", text: "" } : current));
    }

    if (!outcome && !terminal) {
      // The body ended without a terminal frame; there is no answer to trust.
      terminal = terminationNotice("failed");
      answer = "";
      setRun((current) => (current ? { ...current, phase: "settling", text: "" } : current));
    }

    if (!mounted.current) return;

    const summary = summarizeActivity(steps);
    if (threadId) {
      // The database, not the stream, decides what this thread now contains.
      try {
        const { messages: persisted } = await loadThread(threadId);
        if (!mounted.current) return;
        setMessages(persisted);
        const answered = [...persisted].reverse().find((message) => message.role === "assistant");
        if (outcome === "completed" && answered) {
          if (summary) setSummaries((current) => ({ ...current, [answered.id]: summary }));
        }
      } catch {
        if (!mounted.current) return;
        // The answer was persisted even though this read failed; keep it visible.
        if (outcome === "completed" && answer) {
          setMessages((current) => [
            ...current,
            {
              id: `local-${Date.now()}`,
              threadId,
              role: "assistant",
              content: answer,
              createdAt: new Date().toISOString(),
            },
          ]);
        }
      }
      // Always re-list: a first message names the thread server-side.
      void refreshThreads();
    } else {
      // Nothing reached the server, so nothing was persisted either.
      setMessages((current) => current.filter((message) => !message.id.startsWith("pending-")));
    }

    runAbort.current = null;
    runThread.current = null;
    setRun(null);
    setNotice(terminal);
  };

  const activeThread = threads.find((thread) => thread.id === activeThreadId) ?? null;
  const hasConversation = messages.length > 0 || run !== null || notice !== null;

  return (
    <div className="flex h-dvh w-full overflow-hidden">
      <ThreadSidebar
        threads={threads}
        activeThreadId={activeThreadId}
        loading={threadsLoading}
        creating={creating}
        locked={run !== null}
        open={sidebarOpen}
        collapsed={desktop && sidebarCollapsed}
        onClose={() => setSidebarOpen(false)}
        onToggleCollapsed={toggleSidebarCollapsed}
        onSelect={select}
        onCreate={startNewThread}
        onRename={rename}
        onDelete={remove}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 flex-none items-center gap-2 border-b border-border px-5 sm:px-6">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Show conversations"
            className="-ml-2 inline-flex h-9 w-9 flex-none items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface hover:text-foreground md:hidden"
          >
            <List className="h-[18px] w-[18px]" />
          </button>
          {desktop && sidebarCollapsed && (
            <button
              type="button"
              onClick={toggleSidebarCollapsed}
              aria-label="Show sidebar"
              title="Show sidebar (⌘B)"
              className="-ml-2 hidden h-9 w-9 flex-none items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface hover:text-foreground md:inline-flex"
            >
              <SidebarSimple className="h-[18px] w-[18px]" />
            </button>
          )}
          <h1 className="truncate text-[15px] font-medium text-foreground">
            {activeThread ? threadLabel(activeThread) : "New conversation"}
          </h1>
        </header>

        <div
          ref={scroller}
          onScroll={(event) => {
            const node = event.currentTarget;
            stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
          }}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto"
        >
          {messagesLoading && !run ? (
            <p className="mx-auto w-full max-w-[46rem] px-5 py-10 text-[13px] text-muted-2 sm:px-6">
              Loading conversation…
            </p>
          ) : hasConversation ? (
            <MessageList messages={messages} summaries={summaries} run={run} notice={notice} />
          ) : (
            <EmptyConversation onAsk={send} disabled={messagesLoading} />
          )}
        </div>

        <div className="flex-none border-t border-border pt-4">
          <Composer
            onSend={send}
            onStop={stop}
            running={run !== null}
            disabled={messagesLoading}
            focusKey={`${activeThreadId ?? "new"}:${run ? "running" : "idle"}`}
          />
        </div>
      </main>
    </div>
  );
}
