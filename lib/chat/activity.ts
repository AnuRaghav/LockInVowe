import type { ChatActivityEvent } from "@/lib/chat/stream";

/**
 * How a run in flight is narrated to a founder.
 *
 * The harness already decides what is safe to emit (tool name, kind, status,
 * timing, and an opt-in summary - never arguments or reasoning). This turns
 * that into the two sentences a founder actually wants: what Sam is doing now,
 * and what it did before answering. Phrasing is keyed by tool name and falls
 * back to the server's own declared label, so a tool added later still
 * narrates itself without a change here.
 */

export interface ActivityStep {
  callId: string;
  name: string;
  /** The server's declared label, kept as the fallback phrasing. */
  label?: string;
  status: "running" | "done" | "failed";
}

interface Phrasing {
  /** Present tense, shown while the call is in flight. */
  live: string;
  /** Past tense, folded into the one-line summary afterwards. */
  past: string;
}

const PHRASING: Readonly<Record<string, Phrasing>> = {
  financial_position: { live: "Checking your financial position", past: "checked your financial position" },
  financial_cash_flow: { live: "Reviewing your recorded cash flow", past: "reviewed your cash flow" },
  financial_burn_runway: { live: "Checking your burn and runway", past: "checked your burn and runway" },
  compare_financial_periods: { live: "Comparing the two periods", past: "compared the periods" },
  explain_financial_number: { live: "Tracing where the numbers come from", past: "traced the underlying numbers" },
  forecast_cash: { live: "Modeling your cash trajectory", past: "modeled your cash trajectory" },
  simulate_financial_scenario: { live: "Modeling the scenario", past: "modeled the scenario" },
  compare_financial_scenarios: { live: "Comparing the scenarios", past: "compared the scenarios" },
  search_memory: { live: "Reviewing what you've told Sam", past: "reviewed your company notes" },
  get_memory: { live: "Reading your company notes", past: "reviewed your company notes" },
  get_memory_history: { live: "Reading how that changed over time", past: "reviewed your company notes" },
};

const fallback = (step: ActivityStep): Phrasing => {
  const label = step.label?.trim() || step.name.replace(/_/g, " ");
  return { live: label, past: label.toLowerCase() };
};

const phrasing = (step: ActivityStep): Phrasing => PHRASING[step.name] ?? fallback(step);

/** What to show on the live line: the newest call still in flight. */
export const currentActivity = (steps: ActivityStep[]): string | null => {
  const running = [...steps].reverse().find((step) => step.status === "running");
  return running ? phrasing(running).live : null;
};

/** Each step as the founder sees it, in order, for the working list. */
export const activityLines = (steps: ActivityStep[]): Array<{ callId: string; text: string; status: ActivityStep["status"] }> =>
  steps.map((step) => ({ callId: step.callId, text: phrasing(step).live, status: step.status }));

const join = (parts: string[]): string =>
  parts.length <= 1
    ? parts.join("")
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

/**
 * The one line left behind once Sam has answered - "Sam checked your
 * financial position and modeled the scenario". Repeated calls to the same
 * tool collapse; a run that used no tools leaves nothing behind.
 */
export const summarizeActivity = (steps: ActivityStep[]): string | null => {
  const phrases: string[] = [];
  for (const step of steps) {
    if (step.status !== "done") continue;
    const past = phrasing(step).past;
    if (!phrases.includes(past)) phrases.push(past);
  }
  return phrases.length ? `Sam ${join(phrases)}` : null;
};

/** Folds one streamed lifecycle event into the run's step list. */
export const applyActivityEvent = (steps: ActivityStep[], event: ChatActivityEvent): ActivityStep[] => {
  const existing = steps.findIndex((step) => step.callId === event.callId);
  if (event.type === "tool_started" || event.type === "tool_awaiting_approval") {
    if (existing >= 0) return steps;
    return [...steps, { callId: event.callId, name: event.name, label: event.label, status: "running" }];
  }
  const status: ActivityStep["status"] = event.type === "tool_completed" ? "done" : "failed";
  if (existing < 0) {
    return [...steps, { callId: event.callId, name: event.name, label: event.label, status }];
  }
  return steps.map((step, index) => (index === existing ? { ...step, status } : step));
};
