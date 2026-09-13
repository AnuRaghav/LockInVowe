/**
 * The dashboard's "top insights" contract.
 *
 * This is the seam a real recommendation engine plugs into later - whatever
 * eventually decides *what's worth telling a founder* (rules over the
 * financial model, a scored ranking, an LLM pass, some mix) only needs to
 * produce a list of these. Nothing in app/dashboard/page.tsx or
 * InsightCard should need to change when that happens.
 */

export type InsightTone = "positive" | "warning" | "critical" | "neutral";

export interface Insight {
  /** Stable within one generation - not persisted (yet). Used as a React key. */
  id: string;
  tone: InsightTone;
  /** One line. What the insight is, not the full explanation. */
  title: string;
  /** One or two sentences of supporting detail. */
  body: string;
  /** Optional: what talking to Sam about this would open with. */
  followUpPrompt?: string;
}
