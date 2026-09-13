import type { OnboardingSnapshot } from "@/lib/company/assumptions";
import type { Insight } from "@/lib/insights/types";

/**
 * PLACEHOLDER. This picks from a fixed menu of observations based on what
 * data exists, not on any actual analysis of the company's situation - it
 * exists so app/dashboard/page.tsx has three real-looking cards to render
 * while the actual recommendation mechanism (what's worth surfacing, how
 * it's ranked, whether it's rule-based or model-based) gets designed
 * separately. Swap the body of this function; keep the {@link Insight} shape.
 */
export const getPlaceholderInsights = (snapshot: OnboardingSnapshot): Insight[] => {
  const insights: Insight[] = [];
  const usd = (value: number) =>
    value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  if (snapshot.cashOnHandUsd !== null) {
    insights.push({
      id: "cash-on-hand",
      tone: "neutral",
      title: `${usd(snapshot.cashOnHandUsd)} in the bank`,
      body: "Pulled from your connected accounts as of your last sync. Ask Sam for the full runway picture.",
      followUpPrompt: "What's my runway right now?",
    });
  } else {
    insights.push({
      id: "connect-bank",
      tone: "warning",
      title: "No bank connected yet",
      body: "Connect an account so Sam can read your real cash position instead of the number you entered manually.",
      followUpPrompt: "How do I connect my bank?",
    });
  }

  if (snapshot.mrrUsd !== null && snapshot.stripeConnected) {
    insights.push({
      id: "mrr",
      tone: "positive",
      title: `${usd(snapshot.mrrUsd)} in recent revenue`,
      body: "Derived from the last 30 days of Stripe activity. Compare it against your growth target with Sam.",
      followUpPrompt: "Am I on track for my growth target?",
    });
  } else if (snapshot.monthlyPayrollCostUsd !== null) {
    insights.push({
      id: "payroll",
      tone: "neutral",
      title: `${usd(snapshot.monthlyPayrollCostUsd)}/mo in payroll`,
      body: "Your largest predictable expense. Ask Sam what a new hire would actually cost you in runway.",
      followUpPrompt: "Can I afford to hire right now?",
    });
  } else {
    insights.push({
      id: "connect-more",
      tone: "neutral",
      title: "Connect revenue or payroll",
      body: "Link Stripe or Gusto so Sam can ground revenue and payroll answers in real data, not assumptions.",
      followUpPrompt: "What should I connect next?",
    });
  }

  insights.push({
    id: "ask-sam",
    tone: "neutral",
    title: "Sam is ready when you are",
    body: "Ask about runway, a hire, a scenario - Sam runs the numbers through your model and explains the answer.",
    followUpPrompt: "What's the biggest financial risk in my business right now?",
  });

  return insights.slice(0, 3);
};
