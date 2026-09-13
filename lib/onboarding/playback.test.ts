import { beforeEach, describe, expect, it } from "vitest";

import type { CompanyProfile, StoredCompanyProfile } from "@/lib/company/profile";
import { InvalidAssumptionError } from "@/lib/company/assumptions";
import { InMemoryCommunicationContractStore, InMemoryFounderBlockStore } from "@/lib/founder/in-memory";
import { ONBOARDING_QUESTIONS, ONBOARDING_SECTIONS, questionEntryKey, sectionEntryKey } from "@/lib/onboarding/checklist";
import { InMemoryOnboardingSessionStore } from "@/lib/onboarding/in-memory";
import {
  OnboardingNotReadyError,
  completeOnboarding,
  correctPlayback,
  loadOnboardingPlayback,
  skipOnboarding,
  type PlaybackDeps,
} from "@/lib/onboarding/playback";
import { InMemorySemanticBlockStore, InMemorySemanticInteractionStore } from "@/lib/semantic/in-memory";
import { createScriptedSemanticProposer } from "@/lib/semantic/update/proposer";

const IDENTITY = { founderId: "founder-a", companyId: "company-a" };
const at = "2026-09-14T09:00:00Z";

describe("onboarding playback", () => {
  let semanticStore: InMemorySemanticBlockStore;
  let founderBlocks: InMemoryFounderBlockStore;
  let contracts: InMemoryCommunicationContractStore;
  let sessions: InMemoryOnboardingSessionStore;
  let assumptions: Record<string, unknown>;
  let profile: StoredCompanyProfile;
  let completedAt: string | null;
  let deps: PlaybackDeps;

  const finishAllSections = async () => {
    const session = await sessions.start(IDENTITY);
    await sessions.record(IDENTITY, session.id, {
      checklist: Object.fromEntries(ONBOARDING_SECTIONS.map((section) => [sectionEntryKey(section.id), { state: "complete", at }])),
    });
    return session;
  };

  beforeEach(async () => {
    semanticStore = new InMemorySemanticBlockStore();
    founderBlocks = new InMemoryFounderBlockStore();
    contracts = new InMemoryCommunicationContractStore();
    sessions = new InMemoryOnboardingSessionStore();
    assumptions = { gross_margin_pct: 72, cash_on_hand_usd: 900_000 };
    profile = { name: "Clinicly", description: "Scheduling software for clinics." };
    completedAt = null;

    await semanticStore.reviseBlock({ companyId: IDENTITY.companyId }, {
      key: "financial-posture",
      title: "Financial posture",
      body: "Raised a $2M seed in March 2026.",
      contextPolicy: "always",
      recordedAt: at,
    });
    await founderBlocks.reviseBlock({ founderId: IDENTITY.founderId }, {
      key: "risk-and-values",
      title: "Risk and values",
      body: "Will not take venture debt.",
      recordedAt: at,
    });
    await founderBlocks.reviseBlock({ founderId: IDENTITY.founderId }, {
      key: "personal-finances",
      title: "Personal finances",
      body: "Takes a $60K salary.",
      sensitivity: "personal",
      recordedAt: at,
    });
    await contracts.revise({ founderId: IDENTITY.founderId }, { patch: { badNews: "lead_with_it" } });

    deps = {
      semanticStore,
      founderBlocks,
      contracts,
      sessions,
      loadAssumptions: async () => assumptions,
      setAssumption: async (_companyId, key, value) => void (assumptions[key] = value),
      loadProfile: async () => profile,
      saveProfile: async (_companyId, next: CompanyProfile) => void (profile = { ...profile, ...next } as StoredCompanyProfile),
      markCompleted: async (_companyId, when) => void (completedAt = when),
      now: () => new Date("2026-09-14T10:00:00Z"),
    };
  });

  it("shows what was understood, keeping personal topics apart and cash out", async () => {
    const playback = await loadOnboardingPlayback(IDENTITY, deps);

    expect(playback.company).toEqual(profile);
    expect(playback.companyTopics.map((topic) => topic.key)).toEqual(["financial-posture"]);
    expect(playback.founderTopics.map((topic) => topic.key)).toEqual(["risk-and-values"]);
    expect(playback.personalTopics.map((topic) => topic.key)).toEqual(["personal-finances"]);
    expect(playback.preferences).toMatchObject({ badNews: "lead_with_it", alerts: [] });
    expect(playback.assumptions).toEqual({ gross_margin_pct: 72 });
    expect(playback.readyToComplete).toBe(false);
  });

  it("records a fixed company topic as a correction, not a change of plan", async () => {
    await correctPlayback(IDENTITY, { kind: "company-topic", key: "financial-posture", body: "Raised a $2.5M seed in March 2026." }, deps);

    const [latest, original] = await semanticStore.getBlockHistory({ companyId: IDENTITY.companyId }, { key: "financial-posture" });
    expect(latest).toMatchObject({ changeKind: "corrected", body: "Raised a $2.5M seed in March 2026.", contextPolicy: "always" });
    expect(original.body).toContain("$2M");
  });

  it("keeps a corrected personal topic personal, and can remove it entirely", async () => {
    await correctPlayback(IDENTITY, { kind: "founder-topic", key: "personal-finances", body: "Takes a $50K salary." }, deps);
    const scope = { founderId: IDENTITY.founderId };
    expect(await founderBlocks.getBlock(scope, { key: "personal-finances" })).toBeNull();
    expect(await founderBlocks.getBlock(scope, { key: "personal-finances" }, { includePersonal: true })).toMatchObject({
      body: "Takes a $50K salary.",
      sensitivity: "personal",
    });

    const playback = await correctPlayback(IDENTITY, { kind: "remove-founder-topic", key: "personal-finances" }, deps);
    expect(playback.personalTopics).toEqual([]);
  });

  it("corrects preferences and validated numbers", async () => {
    const playback = await correctPlayback(IDENTITY, { kind: "preference", patch: { badNews: "news_with_options" } }, deps);
    expect(playback.preferences?.badNews).toBe("news_with_options");
    expect((await contracts.getCurrent({ founderId: IDENTITY.founderId }))?.changeKind).toBe("corrected");

    await correctPlayback(IDENTITY, { kind: "assumption", key: "gross_margin_pct", value: 68 }, deps);
    expect(assumptions.gross_margin_pct).toBe(68);

    await expect(
      correctPlayback(IDENTITY, { kind: "assumption", key: "monthly_revenue_churn_pct", value: 400 }, deps)
    ).rejects.toThrow(InvalidAssumptionError);
  });

  it("will not finish until every section is covered", async () => {
    await expect(completeOnboarding(IDENTITY, deps)).rejects.toThrow(OnboardingNotReadyError);

    const session = await sessions.start(IDENTITY);
    await expect(completeOnboarding(IDENTITY, deps)).rejects.toThrow('"What the company does" is still open');
    expect(session.status).toBe("in_progress");
  });

  it("finishes, leaving unasked questions open for Sam to raise later", async () => {
    await finishAllSections();
    expect((await loadOnboardingPlayback(IDENTITY, deps)).readyToComplete).toBe(true);

    const result = await completeOnboarding(IDENTITY, deps);

    expect(result.openItems).toBeGreaterThan(0);
    expect(completedAt).toBe("2026-09-14T10:00:00.000Z");
    expect(await sessions.getCurrent(IDENTITY)).toBeNull();
  });

  it("skips the rest of the interview, keeping what was said and deferring everything else", async () => {
    const session = await sessions.start(IDENTITY);
    await sessions.record(IDENTITY, session.id, {
      messages: [
        { role: "sam", text: "What do you sell, and to whom?", sectionId: "company-basics", at },
        { role: "founder", text: "Scheduling software for independent clinics.", sectionId: "company-basics", at },
      ],
      checklist: { [questionEntryKey("what-you-sell")]: { state: "answered", at } },
    });

    const result = await skipOnboarding(IDENTITY, {
      ...deps,
      semanticInteractions: new InMemorySemanticInteractionStore(),
      semanticProposer: createScriptedSemanticProposer([
        {
          assessment: "The founder described the company.",
          operations: [{ op: "create", key: "company-overview", title: "Company overview", body: "Scheduling software for independent clinics." }],
        },
      ]),
    });

    expect(result.extractions).toEqual([expect.objectContaining({ sectionId: "company-basics", status: "applied" })]);
    expect(result.openItems).toBe(ONBOARDING_QUESTIONS.length - 1);
    expect(completedAt).toBe("2026-09-14T10:00:00.000Z");
    expect(await sessions.getCurrent(IDENTITY)).toBeNull();
    expect(await semanticStore.getBlock({ companyId: IDENTITY.companyId }, { key: "company-overview" })).not.toBeNull();
  });

  it("skips before the interview has even started", async () => {
    const result = await skipOnboarding(IDENTITY, deps);

    expect(result.extractions).toEqual([]);
    expect(result.openItems).toBe(ONBOARDING_QUESTIONS.length);
    expect(completedAt).not.toBeNull();
  });
});
