import type { ClientTool } from "@langchain/core/tools";
import { tool, type ToolRuntime } from "@langchain/core/tools";
import { z } from "zod";

import { requireSamContext, type samRuntimeContextSchema } from "@/lib/agents/sam/context";
import type { SamToolPolicyRegistry } from "@/lib/agents/sam/tools/policy";
import { runTool } from "@/lib/agents/sam/tools/result";
import { ASSUMPTION_KEYS, parseAssumptionValue } from "@/lib/company/assumptions";
import {
  BAD_NEWS_DELIVERY,
  DETAIL_LEVELS,
  FINANCE_FLUENCY,
  MAX_FOUNDER_ALERTS,
  PUSHBACK_STYLES,
  RECOMMENDATION_STYLES,
  alertSchema,
  contractPatchSchema,
} from "@/lib/founder/contract";
import {
  ONBOARDING_QUESTION_STATES,
  ONBOARDING_SECTION_IDS,
  OPEN_ITEM_STATES,
  PERSONAL_OPT_IN_QUESTION_ID,
  currentSection,
  questionById,
  questionEntryKey,
  readChecklist,
  sectionById,
  sectionEntryKey,
  unresolvedCoreQuestions,
} from "@/lib/onboarding/checklist";
import { CHOICE_QUESTION_IDS, ONBOARDING_CHOICES } from "@/lib/onboarding/choices";
import type { OnboardingOpenItem } from "@/lib/onboarding/sessions";

/**
 * The onboarding interview's tools.
 *
 * Each is a thin, validated write. The model decides what the founder meant and
 * which tool records it; application code decides whether the value is valid,
 * whether the question exists, and whether the section can close. Nothing here
 * takes a company or founder id - both come from the trusted runtime context,
 * as with every Sam tool - and nothing here runs outside onboarding.
 *
 * There is deliberately no tool for writing prose about the company or the
 * founder. That is consolidated from the transcript when a section closes (see
 * `extract.ts`), by the same restrained updater that maintains it afterwards.
 */

type Runtime = ToolRuntime<unknown, typeof samRuntimeContextSchema>;

const onboardingRun = async (runtime: Runtime, toolName: string) => {
  const context = requireSamContext(runtime, toolName);
  const capability = context.onboarding;

  if (!context.founderId || !capability) {
    throw new Error(`Tool "${toolName}" is only available during onboarding.`);
  }

  const identity = { founderId: context.founderId, companyId: context.companyId };
  const session = await capability.sessions.getCurrent(identity);
  if (!session || session.id !== capability.sessionId) {
    throw new Error("This onboarding session is no longer in progress.");
  }

  return { identity, capability, session };
};

const now = () => new Date().toISOString();

const requireQuestion = (id: string) => {
  const question = questionById(id);
  if (!question) throw new Error(`Unknown onboarding question "${id}".`);
  return question;
};

/** Keys the interview may write. Cash, payroll, and the team come from connected data. */
export const ONBOARDING_ASSUMPTION_KEYS = [
  ASSUMPTION_KEYS.mrrUsd,
  ASSUMPTION_KEYS.monthlyExpensesUsd,
  ASSUMPTION_KEYS.monthlyGrowthTargetPct,
  ASSUMPTION_KEYS.minimumRunwayMonths,
  ASSUMPTION_KEYS.plannedHires,
  ASSUMPTION_KEYS.grossMarginPct,
  ASSUMPTION_KEYS.monthlyRevenueChurnPct,
  ASSUMPTION_KEYS.collectionRatePct,
  ASSUMPTION_KEYS.collectionLagMonths,
  ASSUMPTION_KEYS.oneTimeCosts,
  ASSUMPTION_KEYS.plannedRaises,
  ASSUMPTION_KEYS.revenueProxyAccepted,
] as const;

const questionIdField = z
  .string()
  .optional()
  .describe("The checklist question this answers. When given, the question is marked answered.");

const RECORD_ASSUMPTION = "record_assumption";

export const recordAssumptionTool = tool(
  async (input, runtime: Runtime) =>
    runTool(async () => {
      const { identity, capability } = await onboardingRun(runtime, RECORD_ASSUMPTION);
      const question = input.questionId ? requireQuestion(input.questionId) : undefined;
      if (question && sectionById(question.sectionId)?.sensitive) {
        throw new Error("Personal answers are never recorded as company assumptions.");
      }

      const value = parseAssumptionValue(input.key, input.value);
      await capability.assumptions.set(identity.companyId, input.key, value);

      if (question) {
        await capability.sessions.record(identity, capability.sessionId, {
          checklist: { [questionEntryKey(question.id)]: { state: "answered", at: now() } },
        });
      }

      return { recorded: input.key, questionAnswered: question?.id ?? null };
    }),
  {
    name: RECORD_ASSUMPTION,
    description:
      "Save one number or plan the founder stated, as a structured company assumption the forecast engine reads. Record exactly what they said, in the units the key uses (USD, percent 0-100, months, YYYY-MM-DD dates). If they gave a different unit, confirm the converted figure with them before recording. Never record a figure they did not state or confirm.",
    schema: z
      .object({
        key: z.enum(ONBOARDING_ASSUMPTION_KEYS),
        value: z
          .any()
          .describe(
            "mrr_usd, monthly_expenses_usd: USD number. monthly_growth_target_pct, gross_margin_pct, monthly_revenue_churn_pct, collection_rate_pct: percent number. minimum_runway_months, collection_lag_months: months. planned_hires: [{title, startDate, monthlyCostUsd}]. one_time_costs: [{label, date, amountUsd, kind: operating|capital}]. planned_raises: [{label, expectedCloseDate, amountUsd, feesUsd}]. revenue_proxy_accepted: boolean."
          ),
        questionId: questionIdField,
      })
      .strict(),
  }
);

const RECORD_COMPANY_PROFILE = "record_company_profile";

export const recordCompanyProfileTool = tool(
  async (input, runtime: Runtime) =>
    runTool(async () => {
      const { identity, capability } = await onboardingRun(runtime, RECORD_COMPANY_PROFILE);
      if (input.name === undefined && input.description === undefined) {
        throw new Error("Give a name, a description, or both.");
      }
      const question = input.questionId ? requireQuestion(input.questionId) : undefined;

      await capability.companies.saveProfile(identity.companyId, {
        name: input.name,
        description: input.description,
      });

      if (question) {
        await capability.sessions.record(identity, capability.sessionId, {
          checklist: { [questionEntryKey(question.id)]: { state: "answered", at: now() } },
        });
      }

      return { recorded: true, questionAnswered: question?.id ?? null };
    }),
  {
    name: RECORD_COMPANY_PROFILE,
    description:
      "Save the company's name and a one or two sentence description of what it sells and to whom, in the founder's words.",
    schema: z
      .object({
        name: z.string().trim().min(1).max(120).optional(),
        description: z.string().trim().min(1).max(400).optional(),
        questionId: questionIdField,
      })
      .strict(),
  }
);

/** The only preferences Sam may infer from how the founder talks rather than ask about. */
const INFERABLE_PREFERENCES = new Set(["detail", "financeFluency"]);

const RECORD_FOUNDER_PREFERENCE = "record_founder_preference";

export const recordFounderPreferenceTool = tool(
  async (input, runtime: Runtime) =>
    runTool(async () => {
      const { identity, capability } = await onboardingRun(runtime, RECORD_FOUNDER_PREFERENCE);
      const patch = contractPatchSchema.parse(input.patch);

      if (input.basis === "inferred") {
        const asked = Object.keys(patch).filter((field) => !INFERABLE_PREFERENCES.has(field));
        if (asked.length > 0) {
          throw new Error(
            `Only detail and financeFluency may be inferred. Ask the founder about: ${asked.join(", ")}.`
          );
        }
      }

      const question = input.questionId ? requireQuestion(input.questionId) : undefined;

      await capability.contracts.revise(
        { founderId: identity.founderId },
        {
          patch,
          provenance: { kind: "onboarding", sessionId: capability.sessionId, basis: input.basis },
        }
      );

      if (question) {
        await capability.sessions.record(identity, capability.sessionId, {
          checklist: { [questionEntryKey(question.id)]: { state: "answered", at: now() } },
        });
      }

      return { recorded: Object.keys(patch), questionAnswered: question?.id ?? null };
    }),
  {
    name: RECORD_FOUNDER_PREFERENCE,
    description:
      "Save how the founder wants to be worked with. basis 'stated' for what they told you; 'inferred' only for detail and financeFluency, which you may judge from how they talk and will confirm at the end.",
    schema: z
      .object({
        patch: z
          .object({
            badNews: z.enum(BAD_NEWS_DELIVERY),
            detail: z.enum(DETAIL_LEVELS),
            recommendations: z.enum(RECOMMENDATION_STYLES),
            pushback: z.enum(PUSHBACK_STYLES),
            flagOptimisticAssumptions: z.boolean(),
            financeFluency: z.enum(FINANCE_FLUENCY),
            alerts: z.array(alertSchema).max(MAX_FOUNDER_ALERTS),
          })
          .partial()
          .strict(),
        basis: z.enum(["stated", "inferred"]),
        questionId: questionIdField,
      })
      .strict(),
  }
);

const MARK_QUESTION = "mark_question";

export const markQuestionTool = tool(
  async (input, runtime: Runtime) =>
    runTool(async () => {
      const { identity, capability, session } = await onboardingRun(runtime, MARK_QUESTION);
      const questions = input.questionIds.map(requireQuestion);
      const view = readChecklist(session.checklist);

      if (input.state === "answered") {
        const optedIn =
          view.questions[PERSONAL_OPT_IN_QUESTION_ID] === "answered" ||
          questions.some((question) => question.id === PERSONAL_OPT_IN_QUESTION_ID);
        const personal = questions.filter(
          (question) => question.sectionId === "personal" && question.id !== PERSONAL_OPT_IN_QUESTION_ID
        );
        if (personal.length > 0 && !optedIn) {
          throw new Error("Ask whether the founder wants to answer personal questions before marking any answered.");
        }
      }

      const at = now();
      const checklist = Object.fromEntries(
        questions.map((question) => [questionEntryKey(question.id), { state: input.state, at }])
      );
      const openItems: Record<string, OnboardingOpenItem> = (OPEN_ITEM_STATES as readonly string[]).includes(input.state)
        ? Object.fromEntries(
            questions.map((question) => [question.id, { state: input.state as OnboardingOpenItem["state"], at }])
          )
        : {};

      await capability.sessions.record(identity, capability.sessionId, { checklist, openItems });
      return { marked: questions.map((question) => question.id), state: input.state };
    }),
  {
    name: MARK_QUESTION,
    description:
      "Record how checklist questions were resolved. 'answered' once the founder has covered it (including answers you recorded with another tool), 'deferred' when they want to come back to it or time is short, 'unsure' when they don't know yet, 'declined' when they would rather not say, 'not_applicable' when it does not apply to this company.",
    schema: z
      .object({
        questionIds: z.array(z.string()).min(1).max(10),
        state: z.enum(ONBOARDING_QUESTION_STATES),
      })
      .strict(),
  }
);

const COMPLETE_SECTION = "complete_section";

export const completeSectionTool = tool(
  async (input, runtime: Runtime) =>
    runTool(async () => {
      const { identity, capability, session } = await onboardingRun(runtime, COMPLETE_SECTION);
      const view = readChecklist(session.checklist);
      const current = currentSection(view);

      if (!current) throw new Error("Every onboarding section is already complete.");
      if (current.id !== input.sectionId) {
        throw new Error(`Sections are completed in order. The current section is "${current.id}".`);
      }

      const unresolved = unresolvedCoreQuestions(view, current.id, capability.facts);
      if (unresolved.length > 0) {
        throw new Error(
          `Resolve these questions first (answered, deferred, unsure, declined, or not_applicable): ${unresolved
            .map((question) => question.id)
            .join(", ")}.`
        );
      }

      const entry = { [sectionEntryKey(current.id)]: { state: "complete", at: now() } };
      await capability.sessions.record(identity, capability.sessionId, { checklist: entry });

      const next = currentSection(readChecklist({ ...session.checklist, ...entry }));
      return {
        completed: current.id,
        next: next
          ? {
              id: next.id,
              title: next.title,
              questions: unresolvedCoreQuestions(view, next.id, capability.facts).map((question) => ({
                id: question.id,
                find: question.find,
              })),
            }
          : null,
        onboardingComplete: next === null,
      };
    }),
  {
    name: COMPLETE_SECTION,
    description:
      "Close the current section once every core question in it is resolved. Returns the next section and what it needs to find out.",
    schema: z.object({ sectionId: z.enum(ONBOARDING_SECTION_IDS) }).strict(),
  }
);

const PRESENT_CHOICES = "present_choices";

export const presentChoicesTool = tool(
  async (input, runtime: Runtime) =>
    runTool(async () => {
      await onboardingRun(runtime, PRESENT_CHOICES);
      return { presented: input.questionId, options: ONBOARDING_CHOICES[input.questionId] };
    }),
  {
    name: PRESENT_CHOICES,
    description:
      "Show the founder quick-reply options for the question you are asking in this reply. Only for these questions, and only alongside asking it. The founder can still answer in their own words.",
    schema: z.object({ questionId: z.enum(CHOICE_QUESTION_IDS) }).strict(),
  }
);

export const ONBOARDING_TOOLS: ClientTool[] = [
  recordAssumptionTool,
  recordCompanyProfileTool,
  recordFounderPreferenceTool,
  markQuestionTool,
  completeSectionTool,
  presentChoicesTool,
];

/**
 * Every tool that saves an answer changes state, so none of those is retried by
 * the harness; `present_choices` only shows options. None needs approval: the
 * founder is the one giving the answers being saved.
 */
export const ONBOARDING_TOOL_POLICIES: SamToolPolicyRegistry = {
  [RECORD_ASSUMPTION]: { kind: "action", retryable: false, requiresApproval: false, label: "Saving a company assumption" },
  [RECORD_COMPANY_PROFILE]: { kind: "action", retryable: false, requiresApproval: false, label: "Saving company details" },
  [RECORD_FOUNDER_PREFERENCE]: { kind: "action", retryable: false, requiresApproval: false, label: "Saving how you like to work" },
  [MARK_QUESTION]: { kind: "action", retryable: false, requiresApproval: false, label: "Updating onboarding progress" },
  [COMPLETE_SECTION]: { kind: "action", retryable: false, requiresApproval: false, label: "Finishing an onboarding section" },
  [PRESENT_CHOICES]: { kind: "read_only", retryable: true, requiresApproval: false, label: "Offering answer options" },
};
