import type { Metadata } from "next";

import { DashboardReveal } from "@/components/dashboard/DashboardReveal";
import { getOnboardingSnapshot } from "@/lib/company/assumptions";
import { resolveCompanyContext } from "@/lib/company/context";
import { getPlaceholderInsights } from "@/lib/insights/placeholder";

export const metadata: Metadata = {
  title: "Sam | Dashboard",
  description: "Your CFO's take, before you ask a single question.",
};

/**
 * The founder's landing page after onboarding (and on every return visit) -
 * not the chat window. The goal is the feeling of "Sam already did work and
 * has something to tell me," with chat one click away for anything the
 * insights don't cover.
 *
 * DashboardReveal shows a scripted "Sam is working" screen first (see
 * components/dashboard/AgentWorkingScreen.tsx) - boilerplate for now, meant
 * to be wired to a real agent run's progress later - then reveals the cards
 * below. The three cards themselves are also placeholders (see
 * lib/insights/placeholder.ts): this screen is the boilerplate to build the
 * real recommendation mechanism against, not that mechanism itself.
 */
export default async function DashboardPage() {
  const { companyId } = await resolveCompanyContext();
  const snapshot = await getOnboardingSnapshot(companyId);
  const insights = getPlaceholderInsights(snapshot);

  return <DashboardReveal insights={insights} />;
}
