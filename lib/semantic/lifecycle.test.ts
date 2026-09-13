import { beforeEach, describe, expect, it } from "vitest";

import { createSamContextBuilder } from "@/lib/agents/sam/context-builder";
import { buildSamSystemPrompt } from "@/lib/agents/sam/prompt";
import {
  createDeterministicBriefWriter,
  ensureCompanyBrief,
  type CompanyBrief,
  type CompanyBriefStore,
  type SaveCompanyBriefInput,
} from "@/lib/semantic/brief";
import {
  InMemorySemanticBlockStore,
  InMemorySemanticInteractionStore,
} from "@/lib/semantic/in-memory";
import { SemanticPersistentMemory } from "@/lib/semantic/memory-adapter";
import type { SemanticBlockStore } from "@/lib/semantic/types";
import { updateSemanticState } from "@/lib/semantic/update";
import { createScriptedSemanticProposer } from "@/lib/semantic/update/proposer";
import type { SemanticInteraction, SemanticProposal } from "@/lib/semantic/update/types";

/**
 * The whole semantic lifecycle, in one flow.
 *
 *   a conversation happens
 *        v
 *   the updater consolidates it into durable state   (create, then revise)
 *        v
 *   the brief is rebuilt, because what changed was baseline context
 *        v
 *   a later question opens with the brief + the topics that question needs
 *        v
 *   the superseded plan is nowhere in Sam's context, but is still retrievable
 *
 * The last two steps are the ones that justify all the machinery. A founder who
 * froze hiring in November must not be answered in December out of a September
 * plan, and the system has to be able to show that it is not doing so.
 */

const COMPANY = { companyId: "company_lifecycle" };

class InMemoryBriefStore implements CompanyBriefStore {
  private briefs: CompanyBrief[] = [];

  async getCurrent(): Promise<CompanyBrief | null> {
    return this.briefs[this.briefs.length - 1] ?? null;
  }

  async save(_scope: unknown, input: SaveCompanyBriefInput): Promise<CompanyBrief> {
    const brief: CompanyBrief = {
      ...input,
      id: `brief_${this.briefs.length + 1}`,
      version: this.briefs.length + 1,
      generatedAt: new Date().toISOString(),
    };
    this.briefs.push(brief);
    return brief;
  }
}

let store: SemanticBlockStore;
let interactions: InMemorySemanticInteractionStore;
let briefs: InMemoryBriefStore;

const conversation = (
  externalKey: string,
  founder: string,
  occurredAt: string
): SemanticInteraction => ({
  externalKey,
  source: "conversation",
  threadId: "thread_lifecycle",
  occurredAt,
  messages: [{ role: "founder", text: founder }],
});

const PLAN_TWO_HIRES: SemanticProposal = {
  assessment: "The company set out a Q4 engineering hiring plan.",
  operations: [
    {
      op: "create",
      key: "hiring",
      title: "Hiring",
      summary: "Two engineering hires planned for Q4.",
      body: "The company plans to hire two engineers in Q4 for the platform team, at roughly $205K fully loaded each.",
      labels: ["hiring", "headcount", "engineering"],
      salience: 0.75,
      changeNote: "Q4 hiring plan set out.",
    },
  ],
};

const FREEZE_HIRING: SemanticProposal = {
  assessment: "Engineering hiring is frozen until the raise closes.",
  operations: [
    {
      op: "revise",
      key: "hiring",
      summary: "Engineering hiring is frozen until the Series A closes.",
      body: "Engineering hiring is frozen until the Series A closes. Neither Q4 platform hire will be made before then. The freeze is a runway decision, not a change of roadmap.",
      labels: ["hiring", "headcount", "engineering", "runway", "fundraising"],
      salience: 0.9,
      contextPolicy: "always",
      changeNote: "Hiring frozen until after the raise.",
    },
  ],
};

const consolidate = (interaction: SemanticInteraction, proposal: SemanticProposal) =>
  updateSemanticState({
    scope: COMPANY,
    interaction,
    proposer: createScriptedSemanticProposer([proposal]),
    store,
    interactions,
    now: interaction.occurredAt,
  });

const refreshBrief = () =>
  ensureCompanyBrief({
    scope: COMPANY,
    reader: store,
    briefs,
    writer: createDeterministicBriefWriter(),
  });

/** A turn, built exactly as `prepareSamRun` builds one. */
const openTurn = async (request: string) => {
  const contextBuilder = createSamContextBuilder({
    persistentMemory: new SemanticPersistentMemory({ reader: store }),
    loadBrief: async () => (await briefs.getCurrent()) ?? null,
    loadOperating: async () => null,
  });

  const context = await contextBuilder.build({
    runtime: { companyId: COMPANY.companyId },
    request,
  });

  return { context, prompt: buildSamSystemPrompt(context) };
};

beforeEach(async () => {
  store = new InMemorySemanticBlockStore();
  interactions = new InMemorySemanticInteractionStore();
  briefs = new InMemoryBriefStore();

  // Standing financial context, so the brief has more than one topic to weigh.
  await store.reviseBlock(COMPANY, {
    key: "financial-posture",
    title: "Financial posture",
    summary: "~$1.8M in the bank, ~$170K MRR, burning ~$210K/month.",
    body: "The company holds roughly $1.8M in cash, MRR is about $170K, and net burn is around $210K/month. Management treats 12 months of runway as a floor.",
    labels: ["cash", "burn", "runway"],
    salience: 0.95,
    contextPolicy: "always",
    recordedAt: "2026-09-01T09:00:00Z",
  });

  await store.reviseBlock(COMPANY, {
    key: "fundraising",
    title: "Fundraising",
    summary: "Targeting an $8M Series A, conversations opening in Q1.",
    body: "The company intends to raise an $8M Series A, opening conversations in Q1 and aiming to close by mid-year.",
    labels: ["fundraising", "series-a", "runway"],
    salience: 0.9,
    contextPolicy: "always",
    recordedAt: "2026-09-10T11:00:00Z",
  });
});

describe("the semantic lifecycle, conversation to context", () => {
  it("carries a plan into state, then a change of mind over it", async () => {
    const first = await consolidate(
      conversation("conv_plan", "We're hiring two engineers in Q4.", "2026-09-03T14:30:00Z"),
      PLAN_TWO_HIRES
    );
    const planBrief = await refreshBrief();

    // Step 1-2: the plan is durable state.
    expect(first.status).toBe("applied");
    expect((await store.getBlock(COMPANY, { key: "hiring" }))?.body).toContain("two engineers");
    // Not baseline context yet: a 0.75 hiring plan is worth retrieving, not
    // worth paying for on every unrelated conversation.
    expect(planBrief.brief?.body).not.toContain("two engineers");

    // Step 3-4: the freeze replaces it.
    const second = await consolidate(
      conversation(
        "conv_freeze",
        "We've changed our minds. Freeze engineering hiring until after the raise.",
        "2026-11-04T09:30:00Z"
      ),
      FREEZE_HIRING
    );

    expect(second.applied[0]).toMatchObject({ op: "revise", key: "hiring", revision: 2 });

    const hiring = await store.getBlock(COMPANY, { key: "hiring" });
    expect(hiring?.body).toContain("frozen until the Series A closes");
    expect(hiring?.body).not.toContain("two engineers");

    // Step 5: the earlier plan is still there.
    const history = await store.getBlockHistory(COMPANY, { key: "hiring" });
    expect(history).toHaveLength(2);
    expect(history[1].body).toContain("two engineers");
  });

  it("rebuilds the brief when the change matters enough", async () => {
    await consolidate(
      conversation("conv_plan", "We're hiring two engineers in Q4.", "2026-09-03T14:30:00Z"),
      PLAN_TWO_HIRES
    );
    const before = await refreshBrief();

    await consolidate(
      conversation(
        "conv_freeze",
        "Freeze engineering hiring until after the raise.",
        "2026-11-04T09:30:00Z"
      ),
      FREEZE_HIRING
    );
    const after = await refreshBrief();

    // Step 6: the freeze was promoted to `always`, so it is now baseline.
    expect(after.regenerated).toBe(true);
    expect(after.brief?.version).toBe((before.brief?.version ?? 0) + 1);
    expect(after.brief?.body).toContain("frozen until the Series A closes");
  });

  it("gives a later question the brief and the topics it needs, and nothing stale", async () => {
    await consolidate(
      conversation("conv_plan", "We're hiring two engineers in Q4.", "2026-09-03T14:30:00Z"),
      PLAN_TWO_HIRES
    );
    await refreshBrief();
    await consolidate(
      conversation(
        "conv_freeze",
        "Freeze engineering hiring until after the raise.",
        "2026-11-04T09:30:00Z"
      ),
      FREEZE_HIRING
    );
    await refreshBrief();

    // Step 7: a question that never says "freeze" or "Series A".
    const { context, prompt } = await openTurn("Can we hire another engineer?");

    expect(context.brief).not.toBeNull();
    expect(prompt).toContain("COMPANY BRIEF");

    // The brief carries the standing picture the question never mentions: the
    // cash position, and the raise the hiring answer actually hinges on.
    expect(context.brief?.body).toContain("$1.8M");
    expect(context.brief?.body).toContain("Series A");

    // The directory lists every current topic by key, so Sam can see that
    // hiring and fundraising exist and retrieve either on purpose. The bodies
    // stay behind get_memory - listing what exists is not the same as paying
    // for what it says, which is the whole orientation/detail split.
    const keys = context.directory?.entries.map((entry) => entry.id) ?? [];
    expect(keys).toContain("hiring");
    expect(keys).toContain("financial-posture");
    expect(keys).toContain("fundraising");

    // Step 8: the September plan is not in front of the model anywhere.
    expect(prompt).not.toContain("two engineers");
    expect(prompt).not.toContain("$205K");
    expect(prompt).toContain("frozen until the Series A closes");
  });

  it("surfaces the superseded plan only when history is explicitly retrieved", async () => {
    await consolidate(
      conversation("conv_plan", "We're hiring two engineers in Q4.", "2026-09-03T14:30:00Z"),
      PLAN_TWO_HIRES
    );
    await consolidate(
      conversation(
        "conv_freeze",
        "Freeze engineering hiring until after the raise.",
        "2026-11-04T09:30:00Z"
      ),
      FREEZE_HIRING
    );

    const memory = new SemanticPersistentMemory({ reader: store });

    // What Sam's ordinary retrieval returns: current understanding only.
    const searched = await memory.search(COMPANY, { text: "hiring plan" });
    expect(searched[0].content).not.toContain("two engineers");

    // What the history tool returns, and only when Sam asks for it.
    const revisions = await memory.history(COMPANY, "hiring");
    expect(revisions).toHaveLength(2);
    expect(revisions[1].content).toContain("two engineers");
    expect(revisions[1].supersededAt).toBe("2026-11-04T09:30:00Z");
    expect(revisions[0].changeNote).toBe("Hiring frozen until after the raise.");
  });

  it("keeps the standing cost of the brief bounded", async () => {
    await consolidate(
      conversation("conv_freeze", "Freeze hiring until the raise.", "2026-11-04T09:30:00Z"),
      {
        ...FREEZE_HIRING,
        operations: [{ ...FREEZE_HIRING.operations[0], op: "create", title: "Hiring" }],
      }
    );

    const { brief } = await refreshBrief();
    const { prompt } = await openTurn("What's our runway?");

    expect(brief!.body.length).toBeLessThanOrEqual(2000);
    // The whole opening context, brief included, stays a prompt rather than a
    // document. This is the number that regresses first if selection slips.
    // Raised from 6000 when orientation replaced relevance injection: the
    // capability index and epistemic rules cost ~1.1k of system prompt, and the
    // knowledge directory costs a line per topic instead of three bodies.
    expect(prompt.length).toBeLessThan(7000);
  });
});
