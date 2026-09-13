"use client";

import type { ReactNode } from "react";

import { ActivitySummary, ActivityTrail } from "@/components/chat/ActivityTrail";
import { CopyButton } from "@/components/chat/CopyButton";
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
    <div className="group flex flex-col items-end gap-1">
      <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md border border-border bg-surface-strong px-4 py-2.5 text-[15px] leading-relaxed text-foreground">
        {content}
      </p>
      <CopyButton
        text={content}
        label="Copy input"
        copiedLabel="Input copied"
        className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
      />
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
      <div className="flex flex-wrap items-center gap-2">
        <CopyButton text={content} label="Copy answer" copiedLabel="Answer copied" />
        {footer}
      </div>
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
export function EmptyConversation({
  voiceControl,
  onAsk,
  disabled = false,
  run,
  companion,
}: {
  voiceControl?: ReactNode;
  onAsk?: (question: string) => void;
  disabled?: boolean;
  run?: RunView | null;
  companion?: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-[64rem] flex-1 flex-col items-center justify-center gap-7 px-5 py-16 text-center sm:px-6">
      <div className="grid w-full items-center gap-8 md:grid-cols-[minmax(0,1fr)_minmax(18rem,0.95fr)]">
        <div className="relative flex flex-col items-center justify-center">
          {run && run.steps.length > 0 && (
            <div className="pointer-events-none absolute -right-2 top-1/2 z-0 hidden w-64 -translate-y-1/2 rounded-3xl border border-border bg-surface/80 p-3 text-left shadow-2xl shadow-black/20 backdrop-blur md:block">
              <ActivityTrail steps={run.steps} starting={run.phase === "submitting"} />
            </div>
          )}
          <div className="relative z-10">{voiceControl}</div>
        </div>
        <div className="hidden min-h-[18rem] items-center justify-center md:flex">
          {companion ? (
            <div className="w-full animate-in fade-in duration-500">{companion}</div>
          ) : (
            <div className="rounded-3xl border border-dashed border-border px-6 py-8 text-left text-[13.5px] leading-relaxed text-muted-2">
              Visuals Sam creates, like charts or scenario outputs, will appear here while the voice answer plays.
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="text-balance text-2xl font-semibold tracking-tight text-foreground">
          Ask Sam out loud.
        </h2>
        <p className="max-w-[42ch] text-[15px] leading-relaxed text-muted">
          Sam has your company&apos;s numbers. Tap the orb, ask about runway, hiring, spend, or a scenario,
          and Sam will answer back by voice.
        </p>
      </div>
      {onAsk && (
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
      )}
    </div>
  );
}
