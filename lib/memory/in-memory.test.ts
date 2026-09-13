import { describe, expect, it } from "vitest";

import { InMemoryPersistentMemory, InMemoryThreadMemory } from "@/lib/memory/in-memory";
import { SEEDED_MEMORIES, createSeededPersistentMemory } from "@/lib/memory/seed";

const COMPANY = "company_test_1";
const OTHER_COMPANY = "company_test_2";
const scope = { companyId: COMPANY };

const memory = () => createSeededPersistentMemory(COMPANY);

describe("InMemoryPersistentMemory", () => {
  it("ranks the relevant memory first for a question", async () => {
    const results = await memory().search(scope, { text: "when are we raising?" });

    expect(results[0].id).toBe("mem_raise_march");
  });

  it("falls back to the most important knowledge when nothing matches", async () => {
    const results = await memory().search(scope, { text: "office snacks", limit: 1 });

    expect(results[0].id).toBe("mem_runway_floor");
  });

  it("filters by kind", async () => {
    const results = await memory().search(scope, { kinds: ["plan"] });

    expect(results.map((record) => record.id)).toEqual(["mem_raise_march"]);
  });

  it("scopes every read to one company", async () => {
    const store = memory();

    expect(await store.search({ companyId: OTHER_COMPANY }, { text: "runway" })).toEqual([]);
    expect(await store.get({ companyId: OTHER_COMPANY }, "mem_runway_floor")).toBeNull();
    expect(await store.get(scope, "mem_runway_floor")).toMatchObject({
      content: expect.stringContaining("12 months of runway"),
    });
  });

  it("returns null for an unknown id", async () => {
    expect(await memory().get(scope, "mem_nope")).toBeNull();
  });

  it("seeds the memories the architecture demo relies on", () => {
    expect(SEEDED_MEMORIES.map((record) => record.id)).toEqual([
      "mem_runway_floor",
      "mem_raise_march",
      "mem_senior_engineer",
    ]);
  });

  it("starts empty when nothing is seeded", async () => {
    expect(await new InMemoryPersistentMemory().search(scope, { text: "anything" })).toEqual([]);
  });
});

describe("InMemoryThreadMemory", () => {
  it("keeps working state to the thread that wrote it", async () => {
    const threads = new InMemoryThreadMemory();
    const first = { companyId: COMPANY, threadId: "thread_a" };
    const second = { companyId: COMPANY, threadId: "thread_b" };

    await threads.appendNote(first, "Founder is comparing two hiring plans.");

    expect(await threads.load(first)).toMatchObject({
      threadId: "thread_a",
      notes: ["Founder is comparing two hiring plans."],
    });
    expect(await threads.load(second)).toBeNull();
  });

  it("does not leak a thread across companies", async () => {
    const threads = new InMemoryThreadMemory();
    await threads.appendNote({ companyId: COMPANY, threadId: "thread_a" }, "note");

    expect(await threads.load({ companyId: OTHER_COMPANY, threadId: "thread_a" })).toBeNull();
  });
});
