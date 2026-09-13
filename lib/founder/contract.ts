import { z } from "zod";

import type { SemanticChangeKind, SemanticProvenance } from "@/lib/semantic/types";
import type { FounderScope } from "@/lib/founder/types";

/**
 * The communication contract: how this founder wants to be worked with.
 *
 * The one deliberately typed part of the Founder Model. Everything else about a
 * founder is prose retrieved by relevance; these few preferences are rendered
 * into every Sam run for that founder, because Sam's behaviour depends on them
 * and they cannot be left to whether a search matched.
 *
 * Every preference is optional. Absent means "not stated yet", and Sam uses its
 * defaults for that one preference - it never infers a value that was not given.
 *
 * What the contract can never do: change *whether* or *when* Sam raises a
 * material problem. `badNews` shapes delivery only. That rule lives in Sam's
 * static prompt, not here, so no stored value can switch it off.
 */

export const BAD_NEWS_DELIVERY = ["lead_with_it", "context_then_news", "news_with_options"] as const;
export const DETAIL_LEVELS = ["headline", "show_work"] as const;
export const RECOMMENDATION_STYLES = ["tell_me_what_to_do", "give_me_options"] as const;
export const PUSHBACK_STYLES = ["challenge_hard", "advisory"] as const;
export const FINANCE_FLUENCY = ["plain", "fluent"] as const;

/**
 * Metrics an alert can watch.
 *
 * A closed set, unlike almost everything else in the Founder Model: an alert is
 * only useful if code can evaluate it, and code cannot evaluate a metric it has
 * never heard of. Units match `company_assumptions` (USD, months).
 */
export const ALERT_METRICS = ["runway_months", "cash_usd", "monthly_net_burn_usd"] as const;

export const alertSchema = z
  .object({
    metric: z.enum(ALERT_METRICS),
    direction: z.enum(["below", "above"]),
    threshold: z.number().finite(),
  })
  .strict();

export type FounderAlert = z.infer<typeof alertSchema>;

export const MAX_FOUNDER_ALERTS = 10;

/**
 * A change to the contract.
 *
 * A key that is present replaces that preference, and `null` clears it; a key
 * that is absent leaves it alone. An empty patch is refused - a revision that
 * changes nothing is noise in the history.
 */
export const contractPatchSchema = z
  .object({
    badNews: z.enum(BAD_NEWS_DELIVERY).nullable(),
    detail: z.enum(DETAIL_LEVELS).nullable(),
    recommendations: z.enum(RECOMMENDATION_STYLES).nullable(),
    pushback: z.enum(PUSHBACK_STYLES).nullable(),
    flagOptimisticAssumptions: z.boolean().nullable(),
    financeFluency: z.enum(FINANCE_FLUENCY).nullable(),
    alerts: z.array(alertSchema).max(MAX_FOUNDER_ALERTS).nullable(),
  })
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, "A contract patch must change something.");

export type CommunicationContractPatch = z.infer<typeof contractPatchSchema>;

/** The preferences themselves, as currently stated. */
export interface CommunicationPreferences {
  badNews?: (typeof BAD_NEWS_DELIVERY)[number];
  detail?: (typeof DETAIL_LEVELS)[number];
  recommendations?: (typeof RECOMMENDATION_STYLES)[number];
  pushback?: (typeof PUSHBACK_STYLES)[number];
  flagOptimisticAssumptions?: boolean;
  financeFluency?: (typeof FINANCE_FLUENCY)[number];
  alerts: FounderAlert[];
}

/** One revision of the contract. The current contract is the newest revision. */
export interface CommunicationContract extends CommunicationPreferences {
  id: string;
  revision: number;
  provenance: SemanticProvenance;
  changeKind: SemanticChangeKind;
  changeNote?: string;
  recordedAt: string;
}

export interface ReviseContractInput {
  /** Validated with {@link contractPatchSchema} before anything is written. */
  patch: CommunicationContractPatch;
  provenance?: SemanticProvenance;
  /** Usually inferred. `corrected` when the founder is fixing a misreading. */
  changeKind?: SemanticChangeKind;
  changeNote?: string;
}

export interface CommunicationContractStore {
  getCurrent(scope: FounderScope): Promise<CommunicationContract | null>;
  /** Newest first. */
  getHistory(scope: FounderScope, query?: { limit?: number }): Promise<CommunicationContract[]>;
  revise(scope: FounderScope, input: ReviseContractInput): Promise<CommunicationContract>;
}

/**
 * The merge the database performs, stated once in TypeScript.
 *
 * The in-memory store uses it directly; the SQL function implements the same
 * rule under a lock. The integration tests hold the two to each other.
 */
export const applyContractPatch = (
  previous: CommunicationPreferences | null,
  patch: CommunicationContractPatch
): CommunicationPreferences => {
  const next: CommunicationPreferences = {
    ...(previous ?? {}),
    alerts: previous?.alerts ?? [],
  };

  for (const [field, value] of Object.entries(patch) as Array<
    [keyof CommunicationContractPatch, unknown]
  >) {
    if (field === "alerts") {
      next.alerts = (value as FounderAlert[] | null) ?? [];
    } else if (value === null) {
      delete next[field];
    } else {
      Object.assign(next, { [field]: value });
    }
  }

  return next;
};
