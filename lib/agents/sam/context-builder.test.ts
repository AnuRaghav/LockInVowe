import { describe, expect, it } from "vitest";

import { createSamContextBuilder } from "@/lib/agents/sam/context-builder";
import { buildSamSystemPrompt } from "@/lib/agents/sam/prompt";
import { InMemoryPersistentMemory, InMemoryThreadMemory } from "@/lib/memory/in-memory";
import { createSeededPersistentMemory } from "@/lib/memory/seed";
import type { MemoryRecord } from "@/lib/memory/types";

const COMPANY_ID = "company_test_1";

/**
 * No brief and no stored plan by default.
 *
 * These cases are about the directory and thread scoping, and both loaders are
 * injected so none of them reach for a database. The brief's own behaviour is
 * covered in `lib/semantic/brief/brief.test.ts`, and the plan projection in
 * `lib/company/operating.test.ts`.
 */
const noBrief = async () => null;
const noOperating = async () => null;

const builder = (threadMemory = new InMemoryThreadMemory()) => ({
  threadMemory,
  contextBuilder: createSamContextBuilder({
    persistentMemory: createSeededPersistentMemory(COMPANY_ID),
    threadMemory,
    loadBrief: noBrief,
    loadOperating: noOperating,
  }),
});

describe("SamContextBuilder: the company-knowledge directory", () => {
  it("opens a turn knowing every topic exists, whatever the question was about", async () => {
    const { contextBuilder } = builder();

    const context = await contextBuilder.build({
      runtime: { companyId: COMPANY_ID, threadId: "thread_new" },
      // A question with no lexical overlap with the fundraising topic at all.
      request: "How much cash do we have?",
    });

    const ids = context.directory?.entries.map((entry) => entry.id) ?? [];

    // This is the whole point: the raise plan is discoverable even though
    // nothing in the question would have matched it. Under the previous
    // top-3-lexical-search context it would have been invisible.
    expect(ids).toContain("mem_raise_march");
    expect(ids).toContain("mem_runway_floor");
    expect(ids).toContain("mem_senior_engineer");
    expect(context.directory?.truncated).toBe(false);
  });

  it("lists a topic as an addressable id, not as a body", async () => {
    const { contextBuilder } = builder();

    const context = await contextBuilder.build({
      runtime: { companyId: COMPANY_ID },
      request: "What's our runway?",
    });

    const entry = context.directory?.entries.find((item) => item.id === "mem_runway_floor");

    // `id` is the argument get_memory takes - that is what makes the topic
    // reachable, and it is the reason the directory exists.
    expect(entry).toMatchObject({
      id: "mem_runway_floor",
      title: expect.any(String),
      importance: 0.9,
    });
    // Bodies being withheld is a property of the real semantic store, where a
    // block has a title and a body to keep apart; the seeded dev stub holds
    // single-sentence records with nothing to withhold. See
    // `lib/semantic/memory-adapter.test.ts`.
  });

  it("says so when the directory is clipped rather than silently dropping topics", async () => {
    const contextBuilder = createSamContextBuilder({
      persistentMemory: createSeededPersistentMemory(COMPANY_ID),
      maxDirectoryEntries: 2,
      loadBrief: noBrief,
      loadOperating: noOperating,
    });

    const context = await contextBuilder.build({
      runtime: { companyId: COMPANY_ID },
      request: "When are we raising?",
    });

    expect(context.directory?.entries).toHaveLength(2);
    expect(context.directory?.truncated).toBe(true);
    expect(buildSamSystemPrompt(context)).toContain("use search_memory");
  });

  it("is company-scoped", async () => {
    const { contextBuilder } = builder();

    const context = await contextBuilder.build({
      runtime: { companyId: "company_unknown" },
      request: "What's our runway?",
    });

    expect(context.directory?.entries).toEqual([]);
  });

  it("falls back to search when the backend cannot enumerate topics", async () => {
    const record: MemoryRecord = {
      id: "mem_1",
      kind: "plan",
      content: "We plan to raise in March.",
    };
    // A PersistentMemory with no `list` - the boundary's optional capability.
    const listless = {
      search: async () => [record],
      get: async () => record,
    };

    const context = await createSamContextBuilder({
      persistentMemory: listless,
      loadBrief: noBrief,
      loadOperating: noOperating,
    }).build({ runtime: { companyId: COMPANY_ID }, request: "When are we raising?" });

    expect(context.directory).toBeNull();
    // The section is simply absent; nothing invents an empty directory.
    expect(buildSamSystemPrompt(context)).not.toContain("COMPANY KNOWLEDGE DIRECTORY");
  });
});

describe("SamContextBuilder: thread scoping", () => {
  it("carries company knowledge across threads while thread state stays local", async () => {
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

    // The company topic is reachable from either conversation...
    const raisePlan = (context: typeof firstContext) =>
      context.directory?.entries.find((entry) => entry.id === "mem_raise_march");
    expect(raisePlan(firstContext)).toBeDefined();
    expect(raisePlan(secondContext)).toBeDefined();

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

    const context = await contextBuilder.build({ runtime, request: "When are we raising?" });
    const prompt = buildSamSystemPrompt(context);

    expect(prompt).toContain("mem_raise_march");
    expect(prompt).toContain("Founder wants a hiring answer today.");
    // The context itself stays structured - formatting happens here, not upstream.
    expect(context.directory?.entries[0]).toMatchObject({ id: expect.any(String) });
  });
});

describe("SamContextBuilder: the brief and the stated plan", () => {
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
      loadOperating: noOperating,
    });

    const context = await contextBuilder.build({
      runtime: { companyId: COMPANY_ID },
      request: "Can we hire another engineer?",
    });

    expect(context.brief?.version).toBe(3);

    const prompt = buildSamSystemPrompt(context);
    expect(prompt).toContain("COMPANY BRIEF");
    expect(prompt).toContain("frozen until the Series A closes");
  });

  it("keeps the standing brief, the directory and the plan as separate labelled sections", async () => {
    const contextBuilder = createSamContextBuilder({
      persistentMemory: createSeededPersistentMemory(COMPANY_ID),
      loadBrief: async () => brief,
      loadOperating: async () => ({
        status: "available" as const,
        class: "management_context" as const,
        runwayFloorMonths: 12,
        monthlyGrowthTargetPct: 7,
        mrr: null,
        monthlyExpenses: null,
        statedMonthlyPayrollCost: null,
        plannedHires: {
          count: 2,
          totalMonthlyCost: "USD 34166.00",
          earliestStartDate: "2026-11-01",
        },
        team: { headcount: 9 },
        payroll: {
          connected: true,
          activeEmployeeCount: 9,
          lastProcessedRunEmployerCost: "USD 98000.00",
          lastSyncedAt: "2026-09-12T00:00:00Z",
        },
        missingFields: [],
        more: "Use get_company_plan for detail.",
      }),
    });

    const prompt = buildSamSystemPrompt(
      await contextBuilder.build({
        runtime: { companyId: COMPANY_ID },
        request: "Can we afford the hires?",
      })
    );

    // Four sections doing four different jobs, in orientation order. A model
    // that cannot tell observed state from standing context from an index from
    // a stated plan cannot weigh them.
    const at = (heading: string) => prompt.indexOf(heading);
    expect(at("NUMERICAL MODEL")).toBeGreaterThan(-1);
    expect(at("COMPANY BRIEF")).toBeGreaterThan(at("NUMERICAL MODEL"));
    expect(at("COMPANY KNOWLEDGE DIRECTORY")).toBeGreaterThan(at("COMPANY BRIEF"));
    expect(at("COMPANY PLAN")).toBeGreaterThan(at("COMPANY KNOWLEDGE DIRECTORY"));

    // The plan headline carries the constraint and the cost, so "can we afford
    // the planned hires?" is answerable without a lucky search first.
    expect(prompt).toContain('"runwayFloorMonths":12');
    expect(prompt).toContain("USD 34166.00");
  });

  it("still opens the turn when the brief and the plan cannot be loaded", async () => {
    const contextBuilder = createSamContextBuilder({
      persistentMemory: createSeededPersistentMemory(COMPANY_ID),
      loadBrief: async () => null,
      loadOperating: async () => null,
    });

    const context = await contextBuilder.build({
      runtime: { companyId: COMPANY_ID },
      request: "When are we raising?",
    });

    expect(context.brief).toBeNull();
    expect(context.operating).toBeNull();
    // The directory is independent of both, so discovery survives.
    expect(context.directory?.entries.length).toBeGreaterThan(0);
  });
});

describe("InMemoryPersistentMemory directory", () => {
  it("orders by importance and reports truncation", async () => {
    const memory = new InMemoryPersistentMemory({
      [COMPANY_ID]: [
        { id: "low", kind: "fact", content: "Minor thing", importance: 0.1 },
        { id: "high", kind: "constraint", content: "Big thing\nIt matters a lot.", importance: 0.9 },
      ],
    });

    expect(await memory.list({ companyId: COMPANY_ID })).toEqual({
      entries: [
        { id: "high", title: "Big thing", summary: "It matters a lot.", asOf: undefined, importance: 0.9 },
        { id: "low", title: "Minor thing", summary: "fact", asOf: undefined, importance: 0.1 },
      ],
      truncated: false,
    });

    expect(await memory.list({ companyId: COMPANY_ID }, { limit: 1 })).toMatchObject({
      truncated: true,
    });
  });
});
