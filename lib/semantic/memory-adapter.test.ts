import { beforeEach, describe, expect, it } from "vitest";

import { supportsMemoryHistory } from "@/lib/memory/types";
import { createSeededPersistentMemory } from "@/lib/memory/seed";
import { InMemorySemanticBlockStore } from "@/lib/semantic/in-memory";
import { SemanticPersistentMemory } from "@/lib/semantic/memory-adapter";
import type { SemanticBlockStore } from "@/lib/semantic/types";

/**
 * Semantic state seen through the older memory boundary.
 *
 * The property worth defending: a caller that only knows `PersistentMemory`
 * gets current understanding, never a superseded one - unless it explicitly
 * asks for history, which is a different method.
 */

const SCOPE = { companyId: "company_adapter_test" };
const OTHER = { companyId: "company_adapter_other" };

let store: SemanticBlockStore;
let memory: SemanticPersistentMemory;

beforeEach(async () => {
  store = new InMemorySemanticBlockStore();
  memory = new SemanticPersistentMemory({ reader: store });

  await store.reviseBlock(SCOPE, {
    key: "hiring",
    title: "Hiring",
    body: "The company plans to hire two engineers in Q4.",
    labels: ["hiring", "headcount"],
    salience: 0.75,
    recordedAt: "2026-09-03T10:00:00Z",
    asOf: "2026-09-03",
  });

  await store.reviseBlock(SCOPE, {
    key: "hiring",
    title: "Hiring",
    body: "Engineering hiring is frozen until the Series A closes.",
    labels: ["hiring", "headcount", "runway"],
    salience: 0.9,
    contextPolicy: "always",
    changeNote: "Frozen pending the raise.",
    recordedAt: "2026-11-04T10:00:00Z",
    asOf: "2026-11-04",
    provenance: { kind: "conversation" },
  });

  await store.reviseBlock(SCOPE, {
    key: "fundraising",
    title: "Fundraising",
    body: "The company intends to raise an $8M Series A, opening conversations in Q1.",
    labels: ["fundraising"],
    salience: 0.9,
    recordedAt: "2026-09-10T10:00:00Z",
  });
});

describe("SemanticPersistentMemory", () => {
  it("answers a plain-language search with the relevant topic", async () => {
    const results = await memory.search(SCOPE, { text: "can we afford another engineer?" });

    expect(results[0].id).toBe("hiring");
    expect(results[0].content).toContain("frozen until the Series A closes");
  });

  it("returns only the current understanding, never a superseded one", async () => {
    const results = await memory.search(SCOPE, { text: "hiring plan" });

    expect(results[0].content).not.toContain("two engineers");
  });

  it("identifies a record by its topic key, not a uuid", async () => {
    const [record] = await memory.search(SCOPE, { text: "fundraising" });

    expect(record.id).toBe("fundraising");
    expect(record.attributes).toMatchObject({ key: "fundraising", revision: 1 });
  });

  it("resolves a topic by key, by block id, and by revision id", async () => {
    const block = await store.getBlock(SCOPE, { key: "hiring" });
    const [current, previous] = await store.getBlockHistory(SCOPE, { key: "hiring" });

    expect((await memory.get(SCOPE, "hiring"))?.content).toContain("frozen");
    expect((await memory.get(SCOPE, block!.id))?.content).toContain("frozen");

    // A revision id returns what was believed then, flagged as not current.
    const historical = await memory.get(SCOPE, previous.id);
    expect(historical?.content).toContain("two engineers");
    expect(historical?.attributes).toMatchObject({ current: false });

    expect((await memory.get(SCOPE, current.id))?.attributes).toMatchObject({ current: true });
  });

  it("returns null for an id that names nothing", async () => {
    expect(await memory.get(SCOPE, "no-such-topic")).toBeNull();
    expect(await memory.get(SCOPE, "not a key at all!")).toBeNull();
  });

  it("scopes every read to one company", async () => {
    expect(await memory.search(OTHER, { text: "hiring" })).toEqual([]);
    expect(await memory.get(OTHER, "hiring")).toBeNull();
    expect(await memory.history(OTHER, "hiring")).toEqual([]);
  });

  it("exposes revision history as a distinct, opt-in capability", async () => {
    expect(supportsMemoryHistory(memory)).toBe(true);

    const revisions = await memory.history(SCOPE, "hiring");

    expect(revisions).toHaveLength(2);
    expect(revisions[0].content).toContain("frozen");
    expect(revisions[0].supersededAt).toBeUndefined();
    expect(revisions[1].content).toContain("two engineers");
    expect(revisions[1].supersededAt).toBe("2026-11-04T10:00:00Z");
    expect(revisions[0].changeNote).toBe("Frozen pending the raise.");
  });

  it("treats an unknown topic's history as empty rather than an error", async () => {
    expect(await memory.history(SCOPE, "imaginary")).toEqual([]);
  });

  it("carries selection metadata without exposing storage", async () => {
    const [record] = await memory.search(SCOPE, { text: "hiring" });

    expect(record.importance).toBe(0.9);
    expect(record.kind).toBe("semantic_block");
    expect(record.source).toBe("conversation");
    expect(record.attributes).toMatchObject({ status: "active", contextPolicy: "always" });
  });
});

describe("memory history capability", () => {
  it("is absent from a memory that has no revisions to offer", () => {
    // The fallback used when no database is configured. Asking it "how has this
    // changed?" must be answerable with "it cannot say", not with a guess.
    expect(supportsMemoryHistory(createSeededPersistentMemory())).toBe(false);
  });
});
