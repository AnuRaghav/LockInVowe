"use client";

import type { ReactNode } from "react";

import { ActivitySummary, ActivityTrail } from "@/components/chat/ActivityTrail";
import { ListenButton } from "@/components/chat/ListenButton";
import { ChartFigure } from "@/components/chat/ChartFigure";
import { Markdown } from "@/components/chat/Markdown";
import { currentActivity, summarizeActivity, type ActivityStep } from "@/lib/chat/activity";
import type { ChatChart, ChatMessage } from "@/lib/chat/client";
import { cn } from "@/lib/utils";

/**
 * A founder's own words read as a short aside; Sam's answers are the
 * document. So user turns get a light chat treatment and Sam's get the full
 * reading column with no bubble around them - which is also what leaves room
 * for tables now and charts later without re-laying out the thread.
 */
function UserTurn({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md border border-border bg-surface-strong px-4 py-2.5 text-[15px] leading-relaxed text-foreground">
        {content}
      </p>
    </div>
  );
}

function SamTurn({
  content,
  summary,
  pending = false,
  footer,
  charts = [],
}: {
  content: string;
  summary?: string | null;
  pending?: boolean;
  footer?: ReactNode;
  charts?: ChatChart[];
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-2">Sam</span>
      {summary && <ActivitySummary text={summary} />}
      <div className="text-[16px] leading-[1.7] text-foreground">
        <Markdown source={content} />
        {pending && (
          <span
            aria-hidden
            className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[0.16em] animate-pulse bg-accent"
          />
        )}
      </div>
      {charts.map((chart) => (
        <ChartFigure key={chart.id} spec={chart.spec} />
      ))}
      {footer}
    </div>
  );
}

/** The in-flight turn. `settling` means the run ended and the thread is being re-read. */
export interface RunView {
  phase: "submitting" | "working" | "settling";
  steps: ActivityStep[];
  text: string;
}

/**
 * Sam can speak before it has finished working - a ReAct run may write a
 * sentence, call two more tools, then keep going. So the answer is shown as
 * soon as there is any, with finished work collapsed to one line above it and
 * anything still running noted quietly underneath. Before there is any text,
 * the work itself is the content.
 */
function ActiveTurn({ run }: { run: RunView }) {
  const summary = summarizeActivity(run.steps);
  const current = currentActivity(run.steps);

  // The run is over and the database is being re-read: hold the answer
  // steady rather than blinking it out and back in a moment later.
  if (run.phase === "settling") {
    return run.text ? <SamTurn content={run.text} summary={summary} /> : null;
  }

  if (!run.text) {
    return (
      <div className="flex flex-col gap-2.5" aria-live="polite">
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-2">Sam</span>
        <ActivityTrail steps={run.steps} starting={run.phase === "submitting"} />
      </div>
    );
  }

  return (
    <SamTurn
      content={run.text}
      summary={summary}
      pending={!current}
      footer={
        current && (
          <p className="flex items-center gap-2 text-[14px] text-muted" aria-live="polite">
            <span aria-hidden className="h-1.5 w-1.5 flex-none animate-pulse rounded-full bg-accent" />
            {current}…
          </p>
        )
      }
    />
  );
}

export interface ChatNotice {
  tone: "error" | "muted";
  text: string;
}

export function MessageList({
  messages,
  summaries,
  run,
  notice,
}: {
  messages: ChatMessage[];
  summaries: Record<string, string>;
  run: RunView | null;
  notice: ChatNotice | null;
}) {
  return (
    <div className="mx-auto flex w-full max-w-[46rem] flex-col gap-8 px-5 py-10 sm:px-6">
      {messages.map((message) =>
        message.role === "user" ? (
          <UserTurn key={message.id} content={message.content} />
        ) : (
          <SamTurn
            key={message.id}
            content={message.content}
            summary={summaries[message.id]}
            charts={message.charts}
            footer={<ListenButton threadId={message.threadId} messageId={message.id} />}
          />
        ),
      )}
      {run && <ActiveTurn run={run} />}
      {notice && (
        <p
          role={notice.tone === "error" ? "alert" : undefined}
          className={cn(
            "text-[13.5px] leading-relaxed",
            notice.tone === "error" ? "text-danger" : "text-muted-2",
          )}
        >
          {notice.text}
        </p>
      )}
    </div>
  );
}

/** Openers that show the range - one a lookup, one a decision. */
const STARTERS = [
  "How much cash do we have?",
  "What's my runway right now?",
  "If we make two engineering hires next quarter, what does that do to runway?",
];

/** Shown for a brand-new thread, and for `/chat` before anything is selected. */
export function EmptyConversation({ onAsk, disabled }: { onAsk: (question: string) => void; disabled: boolean }) {
  return (
    <div className="mx-auto flex w-full max-w-[46rem] flex-1 flex-col items-center justify-center gap-6 px-5 py-16 text-center sm:px-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-balance text-2xl font-semibold tracking-tight text-foreground">
          What do you want to know?
        </h2>
        <p className="max-w-[42ch] text-[15px] leading-relaxed text-muted">
          Sam has your company&apos;s numbers. Ask about runway, a hire, a spending change, or a scenario
          you&apos;re weighing.
        </p>
      </div>
      <ul className="flex flex-col items-center gap-2">
        {STARTERS.map((question) => (
          <li key={question}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onAsk(question)}
              className="rounded-full border border-border px-4 py-2 text-[13.5px] text-muted transition-colors hover:border-border-strong hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {question}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
