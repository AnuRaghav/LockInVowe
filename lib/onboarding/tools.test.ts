import { beforeEach, describe, expect, it } from "vitest";

import type { CompanyProfile } from "@/lib/company/profile";
import { InMemoryCommunicationContractStore } from "@/lib/founder/in-memory";
import type { OnboardingCapability } from "@/lib/onboarding/capability";
import { questionEntryKey, readChecklist, sectionEntryKey } from "@/lib/onboarding/checklist";
import type { OnboardingFacts } from "@/lib/onboarding/facts";
import { InMemoryOnboardingSessionStore } from "@/lib/onboarding/in-memory";
import {
  completeSectionTool,
  markQuestionTool,
  presentChoicesTool,
  recordAssumptionTool,
  recordCompanyProfileTool,
  recordFounderPreferenceTool,
} from "@/lib/onboarding/tools";

const IDENTITY = { founderId: "founder-a", companyId: "company-a" };

const FACTS: OnboardingFacts = {
  bankConnected: true,
  cashOnHandUsd: 250_000,
  stripeConnected: false,
  revenueLast30DaysUsd: null,
  payrollConnected: false,
  monthlyPayrollCostUsd: null,
  teamSize: null,
  company: { name: null, description: null },
};

type Payload = { ok: boolean; data?: Record<string, unknown>; error?: string };
const parse = (raw: string) => JSON.parse(raw) as Payload;

describe("onboarding tools", () => {
  let sessions: InMemoryOnboardingSessionStore;
  let contracts: InMemoryCommunicationContractStore;
  let assumptions: Map<string, unknown>;
  let profiles: CompanyProfile[];
  let config: { context: Record<string, unknown> };

  const progress = async () => readChecklist((await sessions.getCurrent(IDENTITY))!.checklist);

  beforeEach(async () => {
    sessions = new InMemoryOnboardingSessionStore();
    contracts = new InMemoryCommunicationContractStore();
    assumptions = new Map();
    profiles = [];

    const session = await sessions.start(IDENTITY);
    const onboarding: OnboardingCapability = {
      sessionId: session.id,
      sessions,
      contracts,
      assumptions: { set: async (_companyId, key, value) => void assumptions.set(key, value) },
      companies: { saveProfile: async (_companyId, profile) => void profiles.push(profile) },
      facts: FACTS,
    };
    config = { context: { ...IDENTITY, onboarding } };
  });

  it("records a validated assumption and marks its question answered", async () => {
    const result = parse(
      await recordAssumptionTool.invoke({ key: "gross_margin_pct", value: 72, questionId: "gross-margin" }, config)
    );

    expect(result).toMatchObject({ ok: true, data: { recorded: "gross_margin_pct", questionAnswered: "gross-margin" } });
    expect(assumptions.get("gross_margin_pct")).toBe(72);
    expect((await progress()).questions["gross-margin"]).toBe("answered");
  });

  it("refuses a value that does not fit its key, and writes nothing", async () => {
    const result = parse(await recordAssumptionTool.invoke({ key: "monthly_revenue_churn_pct", value: 140 }, config));

    expect(result.ok).toBe(false);
    expect(result.error).toContain("monthly_revenue_churn_pct");
    expect(assumptions.size).toBe(0);
  });

  it("does not let the interview write cash or say who the company is", async () => {
    await expect(recordAssumptionTool.invoke({ key: "cash_on_hand_usd" as never, value: 1 }, config)).rejects.toThrow();
    expect(Object.keys(recordAssumptionTool.schema.shape)).not.toContain("companyId");
  });

  it("refuses to run outside onboarding", async () => {
    const result = parse(
      await recordCompanyProfileTool.invoke({ name: "Clinicly" }, { context: { companyId: IDENTITY.companyId } })
    );

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("only available during onboarding") });
    expect(profiles).toEqual([]);
  });

  it("never files a personal answer as a company assumption", async () => {
    const result = parse(
      await recordAssumptionTool.invoke({ key: "monthly_expenses_usd", value: 5_000, questionId: "founder-salary" }, config)
    );

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("Personal answers") });
    expect(assumptions.size).toBe(0);
  });

  it("records stated preferences but only lets detail and fluency be inferred", async () => {
    const stated = parse(
      await recordFounderPreferenceTool.invoke(
        { patch: { badNews: "lead_with_it" }, basis: "stated", questionId: "bad-news" },
        config
      )
    );
    expect(stated.ok).toBe(true);
    expect((await contracts.getCurrent({ founderId: IDENTITY.founderId }))?.badNews).toBe("lead_with_it");

    const inferred = parse(
      await recordFounderPreferenceTool.invoke({ patch: { detail: "headline", pushback: "advisory" }, basis: "inferred" }, config)
    );
    expect(inferred).toMatchObject({ ok: false, error: expect.stringContaining("pushback") });
    expect((await contracts.getCurrent({ founderId: IDENTITY.founderId }))?.pushback).toBeUndefined();
  });

  it("will not mark a personal question answered before the founder opts in", async () => {
    const early = parse(await markQuestionTool.invoke({ questionIds: ["founder-salary"], state: "answered" }, config));
    expect(early).toMatchObject({ ok: false, error: expect.stringContaining("personal questions") });

    const declined = parse(
      await markQuestionTool.invoke({ questionIds: ["personal-opt-in", "founder-salary"], state: "declined" }, config)
    );
    expect(declined.ok).toBe(true);

    const session = await sessions.getCurrent(IDENTITY);
    expect(Object.keys(session!.openItems).sort()).toEqual(["founder-salary", "personal-opt-in"]);
  });

  it("closes sections in order, and only once every core question is resolved", async () => {
    const outOfOrder = parse(await completeSectionTool.invoke({ sectionId: "company-plans" }, config));
    expect(outOfOrder).toMatchObject({ ok: false, error: expect.stringContaining('"company-basics"') });

    const tooEarly = parse(await completeSectionTool.invoke({ sectionId: "company-basics" }, config));
    expect(tooEarly).toMatchObject({ ok: false, error: expect.stringContaining("current-revenue") });

    await markQuestionTool.invoke(
      {
        questionIds: ["what-you-sell", "pricing-and-billing", "current-revenue", "gross-margin"],
        state: "answered",
      },
      config
    );
    await markQuestionTool.invoke({ questionIds: ["customer-concentration"], state: "unsure" }, config);

    const done = parse(await completeSectionTool.invoke({ sectionId: "company-basics" }, config));
    expect(done).toMatchObject({
      ok: true,
      data: { completed: "company-basics", next: { id: "company-position" }, onboardingComplete: false },
    });

    const session = await sessions.getCurrent(IDENTITY);
    expect(session!.checklist[sectionEntryKey("company-basics")]).toMatchObject({ state: "complete" });
    expect(session!.checklist[questionEntryKey("customer-concentration")]).toMatchObject({ state: "unsure" });
  });

  it("offers quick replies only for questions that have them", async () => {
    const offered = parse(await presentChoicesTool.invoke({ questionId: "bad-news" }, config));
    expect(offered).toMatchObject({ ok: true, data: { presented: "bad-news", options: expect.arrayContaining(["Tell me first, bluntly"]) } });

    await expect(presentChoicesTool.invoke({ questionId: "gross-margin" as never }, config)).rejects.toThrow();
  });
});
