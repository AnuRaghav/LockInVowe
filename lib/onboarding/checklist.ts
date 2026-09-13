import type { OnboardingFacts } from "@/lib/onboarding/facts";

/**
 * What the onboarding interview needs to find out.
 *
 * A coverage checklist, not a script. Sections run in order; within a section
 * Sam chooses the order, combines questions that belong together, and skips
 * anything the connected data or an earlier answer already covers. What this
 * file fixes is *what must be known* before a section counts as done, and what
 * each answer is for.
 *
 * Progress lives in the session's `checklist` object under three kinds of key,
 * so one jsonb merge can update any of them:
 *
 *   question:<id>     {state, at}   how a question was resolved
 *   section:<id>      {state, at}   the section was completed
 *   extraction:<id>   {state, at}   the section's transcript was consolidated
 */

export const ONBOARDING_SECTION_IDS = [
  "company-basics",
  "company-position",
  "company-plans",
  "founder-working-style",
  "founder-values",
  "personal",
] as const;

export type OnboardingSectionId = (typeof ONBOARDING_SECTION_IDS)[number];

export interface OnboardingSection {
  id: OnboardingSectionId;
  title: string;
  /** Whose durable model the section's answers consolidate into. */
  subject: "company" | "founder";
  /** Answers are personal: never stored as text, never consolidated from a transcript. */
  sensitive: boolean;
}

export const ONBOARDING_SECTIONS: readonly OnboardingSection[] = [
  { id: "company-basics", title: "What the company does", subject: "company", sensitive: false },
  { id: "company-position", title: "Where the company stands", subject: "company", sensitive: false },
  { id: "company-plans", title: "Where the company is going", subject: "company", sensitive: false },
  { id: "founder-working-style", title: "How to work with you", subject: "founder", sensitive: false },
  { id: "founder-values", title: "What matters to you", subject: "founder", sensitive: false },
  { id: "personal", title: "Personal (optional)", subject: "founder", sensitive: true },
];

/** `core` is asked during onboarding; `deferred` is picked up in chat later. */
export type OnboardingQuestionTier = "core" | "deferred";

/** A question only applies when this is true of the connected data. */
export type OnboardingQuestionCondition = "stripe_connected" | "stripe_not_connected";

export interface OnboardingQuestion {
  id: string;
  sectionId: OnboardingSectionId;
  tier: OnboardingQuestionTier;
  /** What Sam needs to find out - not wording to read aloud. */
  find: string;
  /** Where the answer goes, for Sam and for a reader of this file. */
  fills: readonly string[];
  when?: OnboardingQuestionCondition;
}

export const ONBOARDING_QUESTIONS: readonly OnboardingQuestion[] = [
  // What the company does
  {
    id: "what-you-sell",
    sectionId: "company-basics",
    tier: "core",
    find: "What the company sells and to whom, in a sentence, and the company's name if it is not on file.",
    fills: ["company profile", "company-overview topic"],
  },
  {
    id: "pricing-and-billing",
    sectionId: "company-basics",
    tier: "core",
    find: "How customers are charged (subscription, usage, services), monthly or annual prepay, and how long customers take to pay.",
    fills: ["business-model topic", "assumption:collection_lag_months", "assumption:collection_rate_pct"],
  },
  {
    id: "revenue-representative",
    sectionId: "company-basics",
    tier: "core",
    find: "Whether the revenue seen in Stripe over the last 30 days is representative of recurring monthly revenue, or includes one-offs or annual prepayments.",
    fills: ["assumption:revenue_proxy_accepted", "assumption:mrr_usd"],
    when: "stripe_connected",
  },
  {
    id: "current-revenue",
    sectionId: "company-basics",
    tier: "core",
    find: "Current monthly recurring revenue.",
    fills: ["assumption:mrr_usd"],
    when: "stripe_not_connected",
  },
  {
    id: "gross-margin",
    sectionId: "company-basics",
    tier: "core",
    find: "Roughly what gross margin the company runs at, and what drives its cost of revenue.",
    fills: ["assumption:gross_margin_pct", "business-model topic"],
  },
  {
    id: "customer-concentration",
    sectionId: "company-basics",
    tier: "core",
    find: "How much revenue comes from the top three customers, monthly revenue churn so far, and any large renewals coming up.",
    fills: ["assumption:monthly_revenue_churn_pct", "customers topic"],
  },
  {
    id: "why-customers-buy",
    sectionId: "company-basics",
    tier: "deferred",
    find: "Why customers buy, and what they would use instead.",
    fills: ["company-overview topic"],
  },
  {
    id: "sales-motion",
    sectionId: "company-basics",
    tier: "deferred",
    find: "Self-serve or sales-led, and how long a typical deal takes.",
    fills: ["go-to-market topic"],
  },

  // Where the company stands
  {
    id: "last-raise-and-other-cash",
    sectionId: "company-position",
    tier: "core",
    find: "The last raise (amount, date, instrument) and any cash, debt, or credit lines the bank connection does not show.",
    fills: ["financial-posture topic"],
  },
  {
    id: "monthly-spend",
    sectionId: "company-position",
    tier: "core",
    find: "Monthly spending other than payroll: rent, software, contractors, everything else.",
    fills: ["assumption:monthly_expenses_usd"],
  },
  {
    id: "known-large-costs",
    sectionId: "company-position",
    tier: "core",
    find: "Large one-time costs coming up, with dates: deposits, annual contracts, tax bills, legal.",
    fills: ["assumption:one_time_costs"],
  },
  {
    id: "contractors-outside-payroll",
    sectionId: "company-position",
    tier: "deferred",
    find: "Contractors or anyone paid outside payroll.",
    fills: ["financial-posture topic"],
  },
  {
    id: "working-and-not",
    sectionId: "company-position",
    tier: "deferred",
    find: "What is working, what is not, and the biggest worry right now.",
    fills: ["company topics"],
  },

  // Where the company is going
  {
    id: "next-raise",
    sectionId: "company-plans",
    tier: "core",
    find: "Whether a raise is planned: round, amount, expected close date, and what the company needs to show for it.",
    fills: ["assumption:planned_raises", "fundraising topic"],
  },
  {
    id: "growth-target-basis",
    sectionId: "company-plans",
    tier: "core",
    find: "The monthly growth target and what it is based on - an aspiration, or an operating assumption with a pipeline behind it.",
    fills: ["assumption:monthly_growth_target_pct", "growth-plan topic"],
  },
  {
    id: "hiring-plan",
    sectionId: "company-plans",
    tier: "core",
    find: "Planned hires with role, start date and monthly cost, why each role exists, and which depend on hitting a milestone.",
    fills: ["assumption:planned_hires", "hiring topic"],
  },
  {
    id: "minimum-runway",
    sectionId: "company-plans",
    tier: "core",
    find: "The minimum runway to protect, why that number, and what would trigger cutting costs.",
    fills: ["assumption:minimum_runway_months", "financial-posture topic"],
  },
  {
    id: "twelve-month-milestones",
    sectionId: "company-plans",
    tier: "deferred",
    find: "The milestones that would make the next twelve months a success.",
    fills: ["company topics"],
  },

  // How to work with you
  {
    id: "bad-news",
    sectionId: "founder-working-style",
    tier: "core",
    find: "When something is wrong, whether they want it first and blunt, with context first, or alongside options.",
    fills: ["preference:badNews"],
  },
  {
    id: "pushback-and-recommendations",
    sectionId: "founder-working-style",
    tier: "core",
    find: "Whether Sam should flag plans it thinks are optimistic even unasked, how hard to push back, and whether they want a recommendation or the trade-offs.",
    fills: ["preference:flagOptimisticAssumptions", "preference:pushback", "preference:recommendations"],
  },
  {
    id: "alerts",
    sectionId: "founder-working-style",
    tier: "core",
    find: "What Sam should raise without being asked, and at what threshold (runway, cash, or monthly net burn).",
    fills: ["preference:alerts"],
  },
  {
    id: "finance-background",
    sectionId: "founder-working-style",
    tier: "deferred",
    find: "Prior founding and finance experience, and who else handles money (co-founder, bookkeeper, accountant, board).",
    fills: ["background topic"],
  },
  {
    id: "under-pressure",
    sectionId: "founder-working-style",
    tier: "deferred",
    find: "What helps under pressure, and what advisors or investors have done that was unhelpful.",
    fills: ["decision-style topic"],
  },

  // What matters to you
  {
    id: "risk-scenario",
    sectionId: "founder-values",
    tier: "core",
    find: "Their call on a concrete scenario: nine months of runway and a great senior engineer available now - hire, wait, or hire only if a deal closes - and why.",
    fills: ["risk-and-values topic"],
  },
  {
    id: "non-negotiables-and-outcome",
    sectionId: "founder-values",
    tier: "core",
    find: "Lines they will not cross (layoffs, venture debt, a down round, missed payroll) and the outcome they are building toward.",
    fills: ["risk-and-values topic", "motivation topic"],
  },
  {
    id: "decision-style",
    sectionId: "founder-values",
    tier: "deferred",
    find: "Whether they decide on gut or numbers first, and who they consult before big calls.",
    fills: ["decision-style topic"],
  },
  {
    id: "second-risk-scenario",
    sectionId: "founder-values",
    tier: "deferred",
    find: "Raise six months early at a lower valuation, or cut burn by 20% to wait?",
    fills: ["risk-and-values topic"],
  },

  // Personal (optional)
  {
    id: "personal-opt-in",
    sectionId: "personal",
    tier: "core",
    find: "Whether they are willing to answer a few optional personal questions, explaining that each is skippable and only they will see the answers.",
    fills: [],
  },
  {
    id: "founder-salary",
    sectionId: "personal",
    tier: "core",
    find: "Their current salary, and whether it is below what they need long-term.",
    fills: ["personal founder topic"],
  },
  {
    id: "personal-runway",
    sectionId: "personal",
    tier: "core",
    find: "How long they could keep going on their current salary.",
    fills: ["personal founder topic"],
  },
  {
    id: "personal-money-in-company",
    sectionId: "personal",
    tier: "core",
    find: "Personal money in the company: loans, personal guarantees, personal credit cards.",
    fills: ["personal founder topic"],
  },
  {
    id: "personal-timing",
    sectionId: "personal",
    tier: "core",
    find: "Anything personal that constrains the company's timing. Left open; not probed.",
    fills: ["personal founder topic"],
  },
];

export const PERSONAL_OPT_IN_QUESTION_ID = "personal-opt-in";

/** Active interview time Sam should aim for, and when it should start wrapping up. */
export const ONBOARDING_TARGET_SECONDS = 10 * 60;
export const ONBOARDING_WRAP_UP_SECONDS = 8 * 60;

export const ONBOARDING_QUESTION_STATES = [
  "answered",
  "deferred",
  "unsure",
  "declined",
  "not_applicable",
] as const;

export type OnboardingQuestionState = (typeof ONBOARDING_QUESTION_STATES)[number];

/** States that leave a question open for later, and so become session open items. */
export const OPEN_ITEM_STATES = ["deferred", "unsure", "declined"] as const;

export const questionEntryKey = (id: string) => `question:${id}`;
export const sectionEntryKey = (id: OnboardingSectionId) => `section:${id}`;
export const extractionEntryKey = (id: OnboardingSectionId) => `extraction:${id}`;

export const sectionById = (id: string): OnboardingSection | undefined =>
  ONBOARDING_SECTIONS.find((section) => section.id === id);

export const questionById = (id: string): OnboardingQuestion | undefined =>
  ONBOARDING_QUESTIONS.find((question) => question.id === id);

export const questionsInSection = (
  sectionId: OnboardingSectionId,
  tier: OnboardingQuestionTier = "core"
): OnboardingQuestion[] =>
  ONBOARDING_QUESTIONS.filter((question) => question.sectionId === sectionId && question.tier === tier);

export const questionApplies = (question: OnboardingQuestion, facts: Pick<OnboardingFacts, "stripeConnected">) =>
  question.when === undefined ||
  (question.when === "stripe_connected" ? facts.stripeConnected : !facts.stripeConnected);

/** The checklist as typed state. Tolerant of entries it does not recognise. */
export interface ChecklistView {
  questions: Partial<Record<string, OnboardingQuestionState>>;
  completedSections: OnboardingSectionId[];
  extractedSections: OnboardingSectionId[];
}

const stateOf = (value: unknown): unknown =>
  typeof value === "object" && value !== null ? (value as { state?: unknown }).state : undefined;

export const readChecklist = (checklist: Record<string, unknown>): ChecklistView => {
  const view: ChecklistView = { questions: {}, completedSections: [], extractedSections: [] };

  for (const [key, value] of Object.entries(checklist)) {
    const separator = key.indexOf(":");
    const kind = key.slice(0, separator);
    const id = key.slice(separator + 1);
    const state = stateOf(value);

    if (kind === "question" && ONBOARDING_QUESTION_STATES.includes(state as OnboardingQuestionState)) {
      view.questions[id] = state as OnboardingQuestionState;
    } else if (kind === "section" && state === "complete" && sectionById(id)) {
      view.completedSections.push(id as OnboardingSectionId);
    } else if (kind === "extraction" && sectionById(id) && typeof state === "string") {
      view.extractedSections.push(id as OnboardingSectionId);
    }
  }

  return view;
};

/** The first section not yet complete, or `null` when onboarding is done. */
export const currentSection = (view: ChecklistView): OnboardingSection | null =>
  ONBOARDING_SECTIONS.find((section) => !view.completedSections.includes(section.id)) ?? null;

/** Core questions in a section that apply to this company and have no resolution yet. */
export const unresolvedCoreQuestions = (
  view: ChecklistView,
  sectionId: OnboardingSectionId,
  facts: Pick<OnboardingFacts, "stripeConnected">
): OnboardingQuestion[] =>
  questionsInSection(sectionId).filter(
    (question) => questionApplies(question, facts) && view.questions[question.id] === undefined
  );

/**
 * Active time spent in the interview, in seconds.
 *
 * Gaps between turns count only up to `maxGapSeconds`, so a founder who left
 * for lunch and came back is not treated as ten minutes over budget.
 */
export const activeInterviewSeconds = (timestamps: string[], maxGapSeconds = 180): number => {
  const times = timestamps.map((at) => Date.parse(at)).filter(Number.isFinite).sort((a, b) => a - b);

  let total = 0;
  for (let i = 1; i < times.length; i += 1) {
    total += Math.min((times[i] - times[i - 1]) / 1000, maxGapSeconds);
  }
  return Math.round(total);
};
