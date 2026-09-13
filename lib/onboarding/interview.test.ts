import { AIMessage } from "@langchain/core/messages";
import { FakeToolCallingModel } from "langchain";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CompanyProfile } from "@/lib/company/profile";
import { testFinancialSession } from "@/lib/finance/testing";
import { InMemoryCommunicationContractStore, InMemoryFounderBlockStore } from "@/lib/founder/in-memory";
import { createScriptedFounderProposer } from "@/lib/founder/update";
import {
  ONBOARDING_SECTIONS,
  extractionEntryKey,
  questionEntryKey,
  questionsInSection,
  sectionEntryKey,
} from "@/lib/onboarding/checklist";
import type { OnboardingFacts } from "@/lib/onboarding/facts";
import { InMemoryOnboardingSessionStore } from "@/lib/onboarding/in-memory";
import { InMemorySemanticBlockStore, InMemorySemanticInteractionStore } from "@/lib/semantic/in-memory";
import { createScriptedSemanticProposer } from "@/lib/semantic/update/proposer";
import type { SemanticProposal } from "@/lib/semantic/update/types";

const createSamModel = vi.fn();
vi.mock("@/lib/agents/sam/model", () => ({ createSamModel }));

const { runOnboardingTurn } = await import("@/lib/onboarding/interview");

/**
 * The onboarding interview end to end, with a scripted model.
 *
 * The model's words are not the point - FakeToolCallingModel echoes its input -
 * so these assert on what the application does around it: which tool writes
 * land, which section a turn is filed under, what gets consolidated, and above
 * all that personal answers never survive as text.
 */

const IDENTITY = { founderId: "founder_onboarding", companyId: "company_test_1" };

const FACTS: OnboardingFacts = {
  bankConnected: true,
  cashOnHandUsd: 8_761,
  stripeConnected: false,
  revenueLast30DaysUsd: null,
  payrollConnected: false,
  monthlyPayrollCostUsd: null,
  teamSize: null,
  company: { name: null, description: null },
};

type ToolCall = { name: string; args: Record<string, unknown> };

/** One model turn: a list of tool-calling steps, then a final reply. */
const scriptTurn = (...steps: ToolCall[][]) =>
  createSamModel.mockReturnValueOnce(
    new FakeToolCallingModel({
      toolCalls: [...steps.map((calls, step) => calls.map((call, i) => ({ ...call, id: `call_${step}_${i}` }))), []],
    })
  );

const setup = ({ semantic = [], founder = [] }: { semantic?: SemanticProposal[]; founder?: SemanticProposal[] } = {}) => {
  let tick = 0;
  const sessions = new InMemoryOnboardingSessionStore();
  const founderBlocks = new InMemoryFounderBlockStore();
  const semanticStore = new InMemorySemanticBlockStore();
  const semanticInteractions = new InMemorySemanticInteractionStore();
  const assumptions = new Map<string, unknown>();
  const profiles: CompanyProfile[] = [];

  return {
    sessions,
    founderBlocks,
    semanticStore,
    semanticInteractions,
    assumptions,
    profiles,
    deps: {
      sessions,
      contracts: new InMemoryCommunicationContractStore(),
      founderBlocks,
      semanticStore,
      semanticInteractions,
      assumptions: { set: async (_companyId: string, key: string, value: unknown) => void assumptions.set(key, value) },
      companies: { saveProfile: async (_companyId: string, profile: CompanyProfile) => void profiles.push(profile) },
      loadFacts: async () => FACTS,
      financials: testFinancialSession(IDENTITY.companyId),
      semanticProposer: createScriptedSemanticProposer(semantic),
      founderProposer: createScriptedFounderProposer(founder),
      now: () => new Date(Date.parse("2026-09-14T09:00:00Z") + 20_000 * tick++),
    },
  };
};

/** Every non-personal section done and consolidated, as if the founder had got this far. */
const reachPersonalSection = async (sessions: InMemoryOnboardingSessionStore, { optedIn }: { optedIn: boolean }) => {
  const at = "2026-09-14T08:50:00Z";
  const session = await sessions.start(IDENTITY);
  const checklist: Record<string, unknown> = Object.fromEntries(
    ONBOARDING_SECTIONS.filter((section) => !section.sensitive).flatMap((section) => [
      [sectionEntryKey(section.id), { state: "complete", at }],
      [extractionEntryKey(section.id), { state: "applied", at }],
    ])
  );
  if (optedIn) checklist[questionEntryKey("personal-opt-in")] = { state: "answered", at };
  await sessions.record(IDENTITY, session.id, { checklist });
};

describe("runOnboardingTurn", () => {
  beforeEach(() => {
    createSamModel.mockReset();
  });

  it("opens the interview and files Sam's first turn under the first section", async () => {
    const { deps, sessions } = setup();
    scriptTurn([{ name: "present_choices", args: { questionId: "pricing-and-billing" } }]);

    const result = await runOnboardingTurn({ identity: IDENTITY, deps });

    expect(result).toMatchObject({
      ok: true,
      currentSection: "company-basics",
      onboardingComplete: false,
      choices: { questionId: "pricing-and-billing", options: expect.arrayContaining(["Annual prepay"]) },
    });
    expect(result.reply).not.toBe("");

    const session = await sessions.getCurrent(IDENTITY);
    expect(session?.transcript).toEqual([
      expect.objectContaining({ role: "sam", sectionId: "company-basics", text: result.reply }),
    ]);
  });

  it("records answers, closes a section, and consolidates it into company topics once", async () => {
    const { deps, sessions, assumptions, profiles, semanticStore } = setup({
      semantic: [
        {
          assessment: "The founder described the company.",
          operations: [
            {
              op: "create",
              key: "company-overview",
              title: "Company overview",
              body: "Clinicly sells scheduling software to independent clinics.",
            },
          ],
        },
      ],
    });

    scriptTurn();
    await runOnboardingTurn({ identity: IDENTITY, deps });

    scriptTurn(
      [
        { name: "record_company_profile", args: { name: "Clinicly", description: "Scheduling software for clinics.", questionId: "what-you-sell" } },
        { name: "record_assumption", args: { key: "gross_margin_pct", value: 72, questionId: "gross-margin" } },
        { name: "record_assumption", args: { key: "mrr_usd", value: 42_000, questionId: "current-revenue" } },
        { name: "mark_question", args: { questionIds: ["pricing-and-billing", "customer-concentration"], state: "answered" } },
      ],
      [{ name: "complete_section", args: { sectionId: "company-basics" } }]
    );

    const result = await runOnboardingTurn({
      identity: IDENTITY,
      deps,
      message: "We're Clinicly: scheduling software for clinics, $42K MRR, about 72% margin.",
    });

    expect(result).toMatchObject({
      ok: true,
      completedSections: ["company-basics"],
      currentSection: "company-position",
      extractions: [{ sectionId: "company-basics", status: "applied", applied: 1 }],
    });
    expect(profiles).toEqual([{ name: "Clinicly", description: "Scheduling software for clinics." }]);
    expect(Object.fromEntries(assumptions)).toEqual({ gross_margin_pct: 72, mrr_usd: 42_000 });

    const overview = await semanticStore.getBlock({ companyId: IDENTITY.companyId }, { key: "company-overview" });
    expect(overview?.provenance).toMatchObject({ kind: "onboarding" });

    const session = await sessions.getCurrent(IDENTITY);
    expect(session?.transcript[1]).toMatchObject({ role: "founder", sectionId: "company-basics" });
    expect(session?.transcript[2]).toMatchObject({ role: "sam", sectionId: "company-position" });

    // The scripted proposer has nothing left; a second extraction would fail the turn.
    scriptTurn();
    const next = await runOnboardingTurn({ identity: IDENTITY, deps, message: "Our last raise was a $2M seed." });
    expect(next.extractions).toEqual([]);
  });

  it("lets a founder decline every personal question, and keeps nothing they said", async () => {
    const { deps, sessions, founderBlocks, semanticInteractions } = setup({
      founder: [{ assessment: "The founder declined the personal questions.", operations: [] }],
    });
    await reachPersonalSection(sessions, { optedIn: false });

    scriptTurn(
      [{ name: "mark_question", args: { questionIds: questionsInSection("personal").map((question) => question.id), state: "declined" } }],
      [{ name: "complete_section", args: { sectionId: "personal" } }]
    );

    const result = await runOnboardingTurn({
      identity: IDENTITY,
      deps,
      message: "I'd rather keep my finances private, thanks.",
    });

    expect(result).toMatchObject({
      ok: true,
      onboardingComplete: true,
      currentSection: null,
      personalExtraction: { status: "unchanged", applied: 0 },
    });

    const session = await sessions.getCurrent(IDENTITY);
    expect(session?.transcript).toHaveLength(2);
    expect(session?.transcript.every((turn) => "redacted" in turn && turn.redacted)).toBe(true);
    expect(JSON.stringify(session)).not.toContain("private");
    expect(Object.values(session!.openItems).map((item) => item.state)).toEqual(Array(5).fill("declined"));

    expect(await founderBlocks.listCurrentBlocks({ founderId: IDENTITY.founderId }, { includePersonal: true })).toEqual([]);
    expect(semanticInteractions.completions.size).toBe(0);
  });

  it("keeps a personal answer only as a personal founder topic", async () => {
    const { deps, sessions, founderBlocks, semanticInteractions } = setup({
      founder: [
        {
          assessment: "The founder shared their salary and personal runway.",
          operations: [
            {
              op: "create",
              key: "personal-finances",
              title: "Personal finances",
              body: "The founder pays themselves $60K a year and could last about 8 months on savings.",
            },
          ],
        },
      ],
    });
    await reachPersonalSection(sessions, { optedIn: true });

    scriptTurn([
      { name: "mark_question", args: { questionIds: ["founder-salary", "personal-runway"], state: "answered" } },
    ]);

    const result = await runOnboardingTurn({
      identity: IDENTITY,
      deps,
      message: "I take $60K and could last about 8 months on savings.",
    });

    expect(result).toMatchObject({ ok: true, currentSection: "personal", personalExtraction: { status: "applied", applied: 1 } });

    // Sam's reply echoes the founder in this fake model, so it must be redacted too.
    const stored = JSON.stringify(await sessions.getCurrent(IDENTITY));
    expect(stored).not.toContain("60K");
    expect(stored).not.toContain("8 months");

    const scope = { founderId: IDENTITY.founderId };
    expect(await founderBlocks.getBlock(scope, { key: "personal-finances" })).toBeNull();
    expect(await founderBlocks.getBlock(scope, { key: "personal-finances" }, { includePersonal: true })).toMatchObject({
      sensitivity: "personal",
      provenance: { kind: "onboarding", sectionId: "personal" },
    });
    expect(semanticInteractions.completions.size).toBe(0);
  });

  it("stores nothing from a turn that did not complete", async () => {
    const { deps, sessions } = setup();
    createSamModel.mockImplementationOnce(() => {
      throw new Error("model unavailable");
    });

    const result = await runOnboardingTurn({ identity: IDENTITY, deps, message: "Hello?" });

    expect(result).toMatchObject({ ok: false, reply: "", extractions: [] });
    expect((await sessions.getCurrent(IDENTITY))?.transcript).toEqual([]);
  });
});

/**
 * Replays exact model messages - text and tool calls together - the way Claude
 * actually responds. The echoing fake above cannot show what happens when the
 * question is written alongside a tool call and the final message is empty.
 */
class ExactScriptModel extends FakeToolCallingModel {
  private step = 0;

  constructor(private readonly script: AIMessage[]) {
    super({ toolCalls: [] });
  }

  // The base class returns a fresh instance, which would lose the script.
  bindTools() {
    return this;
  }

  async _generate() {
    const message = this.script[this.step] ?? new AIMessage("");
    this.step += 1;
    return { generations: [{ text: message.text, message }], llmOutput: {} };
  }
}

const toolCall = (id: string, name: string, args: Record<string, unknown>) => ({ id, name, args, type: "tool_call" as const });

describe("runOnboardingTurn with Claude-shaped responses", () => {
  beforeEach(() => {
    createSamModel.mockReset();
  });

  it("keeps a question Sam writes alongside a tool call", async () => {
    const { deps, sessions } = setup();
    createSamModel.mockReturnValueOnce(
      new ExactScriptModel([
        new AIMessage({
          content: "Thanks! How do customers pay you?",
          tool_calls: [toolCall("c1", "present_choices", { questionId: "pricing-and-billing" })],
        }),
        new AIMessage(""),
      ])
    );

    const result = await runOnboardingTurn({ identity: IDENTITY, deps, message: "We sell scheduling software to clinics." });

    expect(result).toMatchObject({ ok: true, reply: "Thanks! How do customers pay you?", choices: { questionId: "pricing-and-billing" } });
    expect((await sessions.getCurrent(IDENTITY))?.transcript[1]).toMatchObject({
      role: "sam",
      text: "Thanks! How do customers pay you?",
    });
  });

  it("discards every write from a turn that does not complete", async () => {
    const { deps, sessions, assumptions } = setup();
    createSamModel.mockReturnValueOnce(
      new ExactScriptModel([
        new AIMessage({ content: "", tool_calls: [toolCall("a", "record_assumption", { key: "gross_margin_pct", value: 72, questionId: "gross-margin" })] }),
        new AIMessage({ content: "", tool_calls: [toolCall("b", "mark_question", { questionIds: ["what-you-sell"], state: "answered" })] }),
        new AIMessage({ content: "", tool_calls: [toolCall("c", "mark_question", { questionIds: ["pricing-and-billing"], state: "answered" })] }),
      ])
    );

    const result = await runOnboardingTurn({
      identity: IDENTITY,
      deps,
      message: "Here's a lot of detail at once.",
      policy: { maxModelCalls: 2 },
    });

    expect(result).toMatchObject({ ok: false, outcome: "max_model_calls" });
    expect(assumptions.size).toBe(0);
    const session = await sessions.getCurrent(IDENTITY);
    expect(session?.checklist).toEqual({});
    expect(session?.transcript).toEqual([]);
  });

  it("will not mark a section's questions answered in the turn that opened it", async () => {
    const { deps, sessions } = setup({ semantic: [{ assessment: "Nothing durable yet.", operations: [] }] });
    createSamModel.mockReturnValueOnce(
      new ExactScriptModel([
        new AIMessage({
          content: "",
          tool_calls: [
            toolCall("a", "mark_question", {
              questionIds: ["what-you-sell", "pricing-and-billing", "current-revenue", "gross-margin", "customer-concentration"],
              state: "answered",
            }),
          ],
        }),
        new AIMessage({ content: "", tool_calls: [toolCall("b", "complete_section", { sectionId: "company-basics" })] }),
        new AIMessage({ content: "", tool_calls: [toolCall("c", "mark_question", { questionIds: ["monthly-spend"], state: "answered" })] }),
        new AIMessage("Got it. What did you last raise?"),
      ])
    );

    const result = await runOnboardingTurn({
      identity: IDENTITY,
      deps,
      message: "That covers the basics, and we spend about $40K a month.",
    });

    expect(result).toMatchObject({ ok: true, currentSection: "company-position", reply: "Got it. What did you last raise?" });
    const session = await sessions.getCurrent(IDENTITY);
    expect(session?.checklist[sectionEntryKey("company-basics")]).toMatchObject({ state: "complete" });
    expect(session?.checklist[questionEntryKey("monthly-spend")]).toBeUndefined();
  });
});
