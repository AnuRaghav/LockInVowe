import type { ChartSpec } from "@/lib/charts/spec";

/**
 * The dashboard's daily digest contract.
 *
 * This is the seam a real recommendation engine plugs into later - whatever
 * eventually decides *what's worth telling a founder* (rules over the
 * financial model, a scored ranking, an LLM pass, some mix) only needs to
 * produce a list of these. Nothing in app/dashboard/page.tsx or
 * InsightCard should need to change when that happens. See
 * lib/insights/digest.ts for the current hardcoded stand-in.
 */

export type InsightTone = "positive" | "warning" | "critical" | "neutral";

export interface DigestInsight {
  /** Stable within one generation - not persisted (yet). Used as a React key. */
  id: string;
  tone: InsightTone;
  /** One line. What the insight is, not the full explanation. */
  title: string;
  /** One or two sentences of supporting detail - the CFO's actual read on it. */
  note: string;
  /** The one number worth animating in. */
  stat: {
    value: number;
    label: string;
    prefix?: string;
    suffix?: string;
    decimalPlaces?: number;
  };
  /** Reuses the same ChartSpec Sam draws in chat - one rendering path, one palette. */
  chart: ChartSpec;
  /** What talking to Sam about this would open with. */
  followUpPrompt: string;
}
