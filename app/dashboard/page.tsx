import type { Metadata } from "next";

import { DashboardReveal } from "@/components/dashboard/DashboardReveal";
import { getDailyDigest } from "@/lib/insights/digest";

export const metadata: Metadata = {
  title: "Sam | Dashboard",
  description: "Your CFO's take, before you ask a single question.",
};

/**
 * The founder's landing page after onboarding (and on every return visit) -
 * not the chat window. The goal is the feeling of "Sam already did work and
 * has something to tell me," with chat one click away for anything the
 * digest doesn't cover.
 *
 * DashboardReveal shows a scripted "Sam is working" screen first (see
 * components/dashboard/AgentWorkingScreen.tsx) - boilerplate, meant to be
 * wired to a real agent run's progress later - then reveals the digest
 * below. getDailyDigest() is also hardcoded on purpose: this screen is the
 * demo-ready boilerplate to build the real recommendation mechanism
 * against (see lib/insights/types.ts), not that mechanism itself. Auth is
 * enforced by proxy.ts, not re-checked here.
 */
export default function DashboardPage() {
  const insights = getDailyDigest();

  return <DashboardReveal insights={insights} />;
}
