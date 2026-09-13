"use client";

import { useId, useState } from "react";
import { Calculator, CaretRight, ChartBar, Check, Database, WarningCircle } from "@phosphor-icons/react";

import { activityLines, type ActivityStep } from "@/lib/chat/activity";
import { cn } from "@/lib/utils";

/** Decorative dots; the adjacent status supplies the accessible text. */
export function ThinkingDots() {
  return (
    <span aria-hidden="true" className="inline-flex h-4 flex-none items-center gap-0.5 text-accent">
      {[0, 1, 2].map((dot) => (
        <span key={dot} className="h-1 w-1 rounded-full bg-current motion-safe:animate-pulse"
          style={{ animationDelay: `${dot * 180}ms`, animationDuration: "1.2s" }} />
      ))}
    </span>
  );
}

const duration = (ms: number) => ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;

function ToolIcon({ step }: { step: ActivityStep }) {
  const Icon = /chart|plot/.test(step.name) ? ChartBar
    : step.kind === "calculation" || /forecast|simulate|scenario/.test(step.name) ? Calculator : Database;
  return <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 flex-none text-muted-2" />;
}

/** One stable work panel, independent of whether answer text has started. */
export function WorkPanel({ steps, active = false, starting = false }: {
  steps: ActivityStep[];
  active?: boolean;
  starting?: boolean;
}) {
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const bodyId = useId();
  const open = expanded ?? active;
  const done = steps.filter((step) => step.status === "done").length;
  const running = steps.filter((step) => step.status === "running").length;
  const failed = steps.filter((step) => step.status === "failed").length;
  const waiting = steps.filter((step) => step.status === "awaiting_approval").length;
  const stopped = steps.filter((step) => step.status === "stopped").length;
  const counts = [
    done && `${done} complete`, running && `${running} running`, waiting && `${waiting} awaiting approval`,
    failed && `${failed} failed`, stopped && `${stopped} stopped`,
  ].filter(Boolean).join(" · ");
  const state = starting ? "Getting your question" : running ? "Checking your numbers"
    : waiting ? "Awaiting approval" : "Thinking";

  if (!steps.length) {
    return active ? <p role="status" className="flex items-center gap-2 text-[13px] text-muted"><ThinkingDots />{state}…</p> : null;
  }

  return (
    <section aria-label="Sam's work" className="overflow-hidden rounded-xl border border-border bg-surface/40">
      <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => setExpanded(!open)}
        className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left text-[13px] text-muted transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-accent">
        <CaretRight aria-hidden="true" className={cn("h-3.5 w-3.5 flex-none transition-transform motion-reduce:transition-none", open && "rotate-90")} />
        <span className="min-w-0 flex-1">
          <span className="font-medium text-foreground">{active ? state : "Work"}</span>
          <span className="ml-2 text-muted-2">{counts}</span>
        </span>
        {active && <ThinkingDots />}
      </button>
      <div id={bodyId} hidden={!open} className="border-t border-border px-3.5 py-3">
        <ol className="flex flex-col gap-3 border-l border-border pl-3">
          {activityLines(steps).map(({ callId, text, status }, index) => {
            const step = steps[index];
            return (
              <li key={callId} className="flex items-start gap-2.5 text-[13px]">
                <ToolIcon step={step} />
                <div className="min-w-0 flex-1">
                  <p className={cn("break-words transition-colors", status === "running" ? "text-foreground" : "text-muted")}>
                    {text}
                  </p>
                  <p className={cn("mt-0.5 text-[11.5px]", status === "failed" ? "text-danger" : "text-muted-2")}>
                    {status === "done" ? "Complete" : status === "failed" ? "Failed" : status === "stopped" ? "Stopped"
                      : status === "awaiting_approval" ? "Awaiting approval" : "Running"}
                    {step.durationMs !== undefined && ` · ${duration(step.durationMs)}`}
                  </p>
                  {step.summary && <p className="mt-1 break-words text-[12px] leading-relaxed text-muted-2">{step.summary}</p>}
                </div>
                {status === "running" ? <ThinkingDots /> : status === "done"
                  ? <Check aria-hidden="true" weight="bold" className="mt-0.5 h-3.5 w-3.5 flex-none text-accent" />
                  : status === "failed" ? <WarningCircle aria-hidden="true" className="mt-0.5 h-4 w-4 flex-none text-danger" /> : null}
              </li>
            );
          })}
        </ol>
      </div>
      <span role="status" className="sr-only">{active ? state : "Work finished"}. {counts}</span>
    </section>
  );
}
