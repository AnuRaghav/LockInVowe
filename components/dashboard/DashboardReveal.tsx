"use client";

import { AnimatePresence, motion } from "motion/react";
import { useLayoutEffect, useState } from "react";

import { AgentWorkingScreen } from "@/components/dashboard/AgentWorkingScreen";
import { DashboardContent } from "@/components/dashboard/DashboardContent";
import type { Insight } from "@/lib/insights/types";

/** Shown once per browser session - a returning visit shouldn't replay "Sam is working" every time. */
const SEEN_KEY = "sam_dashboard_intro_seen";

const hasSeenIntro = () => {
  try {
    return sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false; // storage unavailable (private mode, etc.) - fail toward showing the intro once.
  }
};

const markIntroSeen = () => {
  try {
    sessionStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Best-effort only.
  }
};

/**
 * Orchestrates the boilerplate "agent working" screen before revealing the
 * real dashboard.
 *
 * Always starts in "working" so server and first client render agree - there
 * is no sessionStorage on the server, so deciding the phase before mount
 * would either always skip the intro (a naive fallback-to-seen) or risk a
 * hydration mismatch (a naive fallback-to-unseen, if the client's first
 * render then disagrees with what the server sent). The layout effect below
 * flips to "content" immediately for a returning visit, before paint.
 */
export function DashboardReveal({ insights }: { insights: Insight[] }) {
  const [phase, setPhase] = useState<"working" | "content">("working");

  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resuming external (sessionStorage) state before paint, not a derived-state sync
    if (hasSeenIntro()) setPhase("content");
  }, []);

  return (
    <AnimatePresence mode="wait" onExitComplete={markIntroSeen}>
      {phase === "working" ? (
        <AgentWorkingScreen key="working" onComplete={() => setPhase("content")} />
      ) : (
        <motion.div
          key="content"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35 }}
          className="flex flex-1 flex-col"
        >
          <DashboardContent insights={insights} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
