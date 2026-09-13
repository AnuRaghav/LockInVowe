"use client";

import type { ReactNode } from "react";

import { WorkPanel } from "@/components/chat/ActivityTrail";
import { CopyButton } from "@/components/chat/CopyButton";
import { SamOrb } from "@/components/SamOrb";
import { ChartFigure } from "@/components/chat/ChartFigure";
import { Markdown } from "@/components/chat/Markdown";
import type { ActivityStep } from "@/lib/chat/activity";
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
  work,
  pending = false,
  charts = [],
}: {
  content: string;
  work?: ReactNode;
  pending?: boolean;
  charts?: ChatChart[];
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-2">Sam</span>
      {work}
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
      {content && <CopyButton text={content} label="Copy answer" copiedLabel="Answer copied" />}
    </div>
  );
}

/** The in-flight turn. `settling` means the run ended and the thread is being re-read. */
export interface RunView {
  phase: "submitting" | "working" | "settling";
  steps: ActivityStep[];
  text: string;
}

/** Work stays above the answer, including when tools run between text deltas. */
function ActiveTurn({ run }: { run: RunView }) {
  return (
    <SamTurn
      content={run.text}
      pending={Boolean(run.text) && run.phase !== "settling"}
      work={<WorkPanel steps={run.steps} active={run.phase !== "settling"} starting={run.phase === "submitting"} />}
    />
  );
}

export interface ChatNotice {
  tone: "error" | "muted";
  text: string;
}

export function MessageList({
  messages,
  traces,
  run,
  notice,
  interruptedSteps = [],
  className,
}: {
  messages: ChatMessage[];
  traces: Record<string, ActivityStep[]>;
  run: RunView | null;
  notice: ChatNotice | null;
  interruptedSteps?: ActivityStep[];
  className?: string;
}) {
  return (
    <div className={cn("mx-auto flex w-full max-w-[46rem] flex-col gap-8 px-5 py-10 sm:px-6", className)}>
      {messages.map((message) =>
        message.role === "user" ? (
          <UserTurn key={message.id} content={message.content} />
        ) : (
          <SamTurn
            key={message.id}
            content={message.content}
            work={<WorkPanel steps={traces[message.id] ?? []} />}
            charts={message.charts}
          />
        ),
      )}
      {run && <ActiveTurn run={run} />}
      {!run && interruptedSteps.length > 0 && <WorkPanel steps={interruptedSteps} />}
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
export type EmptyConversationPhase = "idle" | "activating" | "working" | "conversation";

export function EmptyConversation({
  onAsk,
  disabled = false,
  phase = "idle",
}: {
  onAsk?: (question: string) => void;
  disabled?: boolean;
  phase?: EmptyConversationPhase;
}) {
  const transitioning = phase !== "idle";
  const fadingOut = phase === "conversation";

  if (transitioning) {
    return (
      <div className="pointer-events-none flex h-full w-full items-center justify-center overflow-hidden">
        <SamOrb
          energy={0.3}
          points={360}
          className={cn(
            "h-28 w-28 opacity-100 transition-opacity duration-500 ease-out motion-reduce:transition-opacity sm:h-32 sm:w-32",
            fadingOut && "opacity-0",
          )}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[46rem] flex-1 flex-col items-center justify-center gap-6 px-5 py-16 text-center sm:px-6">
      <SamOrb energy={0.3} points={360} className="h-28 w-28 sm:h-32 sm:w-32" />
      <div className="flex flex-col gap-2">
        <h2 className="text-balance text-2xl font-semibold tracking-tight text-foreground">
          What do you want to know?
        </h2>
        <p className="max-w-[42ch] text-[15px] leading-relaxed text-muted">
          Sam has your company&apos;s numbers. Ask about runway, a hire, a spending change, or a scenario
          you&apos;re weighing.
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
