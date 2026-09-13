"use client";

import { CheckCircle, Circle } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { SamOrb } from "@/components/SamOrb";

/**
 * Scripted for now (see the module doc below); a real agent run should drive
 * this list and each step's timing/outcome instead of the fixed schedule.
 */
export interface WorkingStep {
  id: string;
  label: string;
}

export const DEFAULT_CFO_STEPS: WorkingStep[] = [
  { id: "accounts", label: "Pulling your connected accounts" },
  { id: "cash", label: "Reconciling cash position" },
  { id: "burn", label: "Calculating burn and runway" },
  { id: "payroll", label: "Reviewing payroll and hiring plans" },
  { id: "compare", label: "Comparing against your model" },
  { id: "insights", label: "Drafting your insights" },
];

const STEP_INTERVAL_MS = 480;
const HOLD_AFTER_LAST_MS = 550;

interface AgentWorkingScreenProps {
  steps?: WorkingStep[];
  onComplete: () => void;
}

/**
 * Boilerplate "an agent is doing CFO work" loading screen, shown between
 * finishing onboarding and landing on the dashboard (see
 * components/dashboard/DashboardReveal.tsx).
 *
 * Every step here completes on a fixed timer - there is no real agent run
 * behind it yet. When one exists, replace the interval in the effect below
 * with real progress events (a step completes when the agent reports it
 * done, not when a clock says so) and this component's props/rendering
 * shouldn't need to change.
 */
export function AgentWorkingScreen({
  steps = DEFAULT_CFO_STEPS,
  onComplete,
}: AgentWorkingScreenProps) {
  const [completedCount, setCompletedCount] = useState(0);
  const reduceMotion = useReducedMotion();
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (reduceMotion) {
      onCompleteRef.current();
      return;
    }

    let cancelled = false;
    let count = 0;

    const tick = () => {
      if (cancelled) return;
      count += 1;
      setCompletedCount(count);

      if (count >= steps.length) {
        setTimeout(() => {
          if (!cancelled) onCompleteRef.current();
        }, HOLD_AFTER_LAST_MS);
        return;
      }

      setTimeout(tick, STEP_INTERVAL_MS);
    };

    const start = setTimeout(tick, STEP_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(start);
    };
  }, [steps.length, reduceMotion]);

  if (reduceMotion) return null;

  const energy = 0.35 + (completedCount / steps.length) * 0.5;

  return (
    <motion.div
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-8 px-6 py-24"
    >
      <SamOrb energy={energy} className="h-32 w-32" />

      <div className="flex flex-col items-center gap-1 text-center">
        <p className="text-[15px] font-medium text-foreground">Sam is reviewing your company</p>
        <p className="text-[13px] text-muted">This only takes a moment.</p>
      </div>

      <ul className="flex w-full flex-col gap-2.5">
        {steps.map((step, i) => {
          const done = i < completedCount;
          const active = i === completedCount;
          return (
            <li
              key={step.id}
              className="flex items-center gap-2.5 text-[13px] transition-colors duration-300"
            >
              <AnimatePresence mode="wait" initial={false}>
                {done ? (
                  <motion.span
                    key="done"
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.2 }}
                    className="shrink-0 text-accent"
                  >
                    <CheckCircle weight="fill" className="h-4 w-4" />
                  </motion.span>
                ) : (
                  <motion.span
                    key="pending"
                    animate={active ? { opacity: [0.35, 1, 0.35] } : { opacity: 0.35 }}
                    transition={active ? { duration: 1.1, repeat: Infinity, ease: "easeInOut" } : undefined}
                    className="shrink-0 text-muted-2"
                  >
                    <Circle weight="bold" className="h-4 w-4" />
                  </motion.span>
                )}
              </AnimatePresence>
              <span className={done || active ? "text-foreground" : "text-muted-2"}>
                {step.label}
              </span>
            </li>
          );
        })}
      </ul>
    </motion.div>
  );
}
