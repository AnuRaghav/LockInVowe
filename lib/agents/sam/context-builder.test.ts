import { describe, expect, it } from "vitest";

import { createSamContextBuilder } from "@/lib/agents/sam/context-builder";
import { buildSamSystemPrompt } from "@/lib/agents/sam/prompt";
import { InMemoryThreadMemory } from "@/lib/memory/in-memory";
import { createSeededPersistentMemory } from "@/lib/memory/seed";

const COMPANY_ID = "company_test_1";

/**
 * No brief by default.
 *
 * These cases are about selection and thread scoping, and `loadBrief` is
 * injected so none of them reach for a database. The brief's own behaviour is
 * covered in `lib/semantic/brief/brief.test.ts` and in the end-to-end flow.
 */
const noBrief = async () => null;

const builder = (threadMemory = new InMemoryThreadMemory()) => ({
  threadMemory,
  contextBuilder: createSamContextBuilder({
    persistentMemory: createSeededPersistentMemory(COMPANY_ID),
    threadMemory,
    loadBrief: noBrief,
  }),
});

describe("SamContextBuilder", () => {
  it("opens a brand-new conversation with relevant company memory", async () => {
    const { contextBuilder } = builder();

    const context = await contextBuilder.build({
      runtime: { companyId: COMPANY_ID, threadId: "thread_new" },
      request: "Can we afford to hire a senior engineer?",
    });

    expect(context.thread).toBeNull();
    expect(context.memories.map((memory) => memory.id)).toContain("mem_senior_engineer");
    expect(context.memories.map((memory) => memory.id)).toContain("mem_runway_floor");
  });

  it("keeps the selection small rather than dumping everything known", async () => {
    const contextBuilder = createSamContextBuilder({
      persistentMemory: createSeededPersistentMemory(COMPANY_ID),
      maxMemories: 1,
      loadBrief: noBrief,
    });

    const context = await contextBuilder.build({
      runtime: { companyId: COMPANY_ID },
      request: "When are we raising?",
    });

    expect(context.memories.map((memory) => memory.id)).toEqual(["mem_raise_march"]);
  });

  it("returns nothing for a company with no memories", async () => {
    const { contextBuilder } = builder();

    const context = await contextBuilder.build({
      runtime: { companyId: "company_unknown" },
      request: "What's our runway?",
    });

    expect(context.memories).toEqual([]);
  });

  it("carries company memory across threads while thread state stays local", async () => {
    const { threadMemory, contextBuilder } = builder();
    const first = { companyId: COMPANY_ID, threadId: "thread_a" };
    const second = { companyId: COMPANY_ID, threadId: "thread_b" };

    await threadMemory.appendNote(first, "Comparing a March raise against a bridge.");

    const firstContext = await contextBuilder.build({
      runtime: first,
      request: "When are we raising?",
    });
    const secondContext = await contextBuilder.build({
      runtime: second,
      request: "When are we raising?",
    });

    // The company fact is reachable from either conversation...
    const raisePlan = (context: typeof firstContext) =>
      context.memories.find((memory) => memory.id === "mem_raise_march");
    expect(raisePlan(firstContext)?.content).toContain("March");
    expect(raisePlan(secondContext)?.content).toContain("March");

    // ...while the working note belongs to the thread that wrote it.
    expect(firstContext.thread?.notes).toEqual([
      "Comparing a March raise against a bridge.",
    ]);
    expect(secondContext.thread).toBeNull();
  });

  it("formats structured context into the prompt only at the model boundary", async () => {
    const { threadMemory, contextBuilder } = builder();
    const runtime = { companyId: COMPANY_ID, threadId: "thread_a" };
    await threadMemory.appendNote(runtime, "Founder wants a hiring answer today.");

    const context = await contextBuilder.build({
      runtime,
      request: "When are we raising?",
    });
    const prompt = buildSamSystemPrompt(context);

    expect(prompt).toContain("The company plans to raise a Series A in March.");
    expect(prompt).toContain("Founder wants a hiring answer today.");
    // The context itself stays structured - formatting happens here, not upstream.
    expect(context.memories[0]).toMatchObject({ id: expect.any(String), kind: "plan" });
  });
});

describe("SamContextBuilder and the company brief", () => {
  const brief = {
    id: "brief_1",
    version: 3,
    body: "Financial posture: ~$1.8M cash, ~$170K MRR, ~$210K/month burn.\nHiring: frozen until the Series A closes.",
    sections: [],
    fingerprint: "fp",
    sourceBlockIds: [],
    generator: { kind: "deterministic" },
    generatedAt: "2026-11-04T10:00:00Z",
  };

  it("opens every turn with the brief as baseline context", async () => {
    const contextBuilder = createSamContextBuilder({
      persistentMemory: createSeededPersistentMemory(COMPANY_ID),
      loadBrief: async () => brief,
    });

    const context = await contextBuilder.build({
      runtime: { companyId: COMPANY_ID },
      request: "Can we hire another engineer?",
    });

    expect(context.brief?.version).toBe(3);

    const prompt = buildSamSystemPrompt(context);
    expect(prompt).toContain("Company brief");
    expect(prompt).toContain("frozen until the Series A closes");
  });

  it("keeps the brief apart from the topics selected for this question", async () => {
    const contextBuilder = createSamContextBuilder({
      persistentMemory: createSeededPersistentMemory(COMPANY_ID),
      loadBrief: async () => brief,
    });

    const prompt = buildSamSystemPrompt(
      await contextBuilder.build({
        runtime: { companyId: COMPANY_ID },
        request: "When are we raising?",
      })
    );

    // Two labelled sections, doing different jobs. A model that cannot tell
    // standing context from question-specific context cannot weigh them.
    const briefAt = prompt.indexOf("Company brief");
    const relevantAt = prompt.indexOf("Relevant to this question");
    expect(briefAt).toBeGreaterThan(-1);
    expect(relevantAt).toBeGreaterThan(briefAt);
  });

  it("still opens the turn when the brief cannot be loaded", async () => {
    const contextBuilder = createSamContextBuilder({
      persistentMemory: createSeededPersistentMemory(COMPANY_ID),
      loadBrief: async () => null,
    });

    const context = await contextBuilder.build({
      runtime: { companyId: COMPANY_ID },
      request: "When are we raising?",
    });

    expect(context.brief).toBeNull();
    expect(context.memories.length).toBeGreaterThan(0);
  });
});
