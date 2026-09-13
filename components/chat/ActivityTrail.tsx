"use client";

import { Check } from "@phosphor-icons/react";

import { activityLines, type ActivityStep } from "@/lib/chat/activity";
import { cn } from "@/lib/utils";

/**
 * What Sam is doing, at the altitude a founder cares about.
 *
 * One line per piece of work, phrased by `lib/chat/activity.ts` from the
 * harness's own safe events. No tool names, no arguments, no reasoning - and
 * it gives way to the answer the moment the answer starts.
 */
export function ActivityTrail({ steps, starting }: { steps: ActivityStep[]; starting: boolean }) {
  const lines = activityLines(steps);

  if (!lines.length) {
    return (
      <p className="flex items-center gap-2 text-[14px] text-muted-2">
        <Pulse />
        {starting ? "Getting your question" : "Thinking it through"}…
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {lines.map(({ callId, text, status }) => (
        <li
          key={callId}
          className={cn(
            "flex items-center gap-2 text-[14px] transition-colors",
            status === "running" ? "text-muted" : "text-muted-2",
          )}
        >
          {status === "running" ? (
            <Pulse />
          ) : status === "done" ? (
            <Check weight="bold" className="h-3.5 w-3.5 flex-none text-accent" />
          ) : (
            <span aria-hidden className="h-1.5 w-1.5 flex-none rounded-full bg-danger" />
          )}
          <span>
            {text}
            {status === "running" && "…"}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Pulse() {
  return <span aria-hidden className="h-1.5 w-1.5 flex-none animate-pulse rounded-full bg-accent" />;
}

/** The one line a finished turn leaves behind, once the answer is the point. */
export function ActivitySummary({ text }: { text: string }) {
  return <p className="text-[12.5px] text-muted-2">{text}</p>;
}
