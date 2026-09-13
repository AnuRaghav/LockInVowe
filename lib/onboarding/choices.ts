import type { CommunicationPreferences, FounderAlert } from "@/lib/founder/contract";

/**
 * Quick replies and plain-language labels for onboarding.
 *
 * Pure data, safe to import from client components. The options are shortcuts,
 * not a form: choosing one sends its label as the founder's message, and Sam
 * interprets it like anything typed.
 */

/** Questions Sam may offer quick replies for, via the `present_choices` tool. */
export const ONBOARDING_CHOICES = {
  "pricing-and-billing": ["Monthly subscription", "Annual prepay", "Usage-based", "Services or projects"],
  "bad-news": ["Tell me first, bluntly", "Give me the context first", "Bring options with the news"],
  "pushback-and-recommendations": [
    "Push back hard and tell me what to do",
    "Advise me and lay out the trade-offs",
  ],
  alerts: ["Runway below 12 months", "Runway below 6 months", "Cash below a set amount"],
  "risk-scenario": ["Hire now", "Wait", "Hire only if a deal closes"],
  "personal-opt-in": ["Sure, ask away", "I'd rather skip these"],
} as const satisfies Record<string, readonly string[]>;

export type ChoiceQuestionId = keyof typeof ONBOARDING_CHOICES;

export const CHOICE_QUESTION_IDS = Object.keys(ONBOARDING_CHOICES) as [ChoiceQuestionId, ...ChoiceQuestionId[]];

export const isChoiceQuestionId = (id: string): id is ChoiceQuestionId => id in ONBOARDING_CHOICES;

/** Always available: no question should require an answer the founder does not have. */
export const GENERAL_REPLIES = ["Not sure yet", "Let's come back to this later"] as const;
export const PERSONAL_DECLINE_REPLY = "I'd rather not say";

type EditablePreference = "badNews" | "detail" | "recommendations" | "pushback" | "financeFluency";

/** How each communication preference reads to the founder, for playback. */
export const PREFERENCE_OPTIONS: {
  [K in EditablePreference]: { label: string; options: Record<NonNullable<CommunicationPreferences[K]>, string> };
} = {
  badNews: {
    label: "When something is wrong",
    options: {
      lead_with_it: "Tell me first, bluntly",
      context_then_news: "Give me the context first",
      news_with_options: "Bring options with the news",
    },
  },
  recommendations: {
    label: "Recommendations",
    options: { tell_me_what_to_do: "Tell me what to do", give_me_options: "Lay out the options" },
  },
  pushback: {
    label: "Pushback",
    options: { challenge_hard: "Push back hard", advisory: "Advise, don't push" },
  },
  detail: {
    label: "Detail",
    options: { headline: "Headline first", show_work: "Show the working" },
  },
  financeFluency: {
    label: "Finance language",
    options: { plain: "Plain language", fluent: "Finance terms are fine" },
  },
};

export const describeAlert = (alert: FounderAlert): string => {
  const value =
    alert.metric === "runway_months" ? `${alert.threshold} months` : `$${alert.threshold.toLocaleString("en-US")}`;
  const metric = { runway_months: "Runway", cash_usd: "Cash", monthly_net_burn_usd: "Monthly net burn" }[alert.metric];
  return `${metric} ${alert.direction} ${value}`;
};
