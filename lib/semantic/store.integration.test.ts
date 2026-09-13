import { beforeAll, describe, expect, it } from "vitest";

import { SemanticPersistentMemory } from "@/lib/semantic/memory-adapter";
import { SEED_SEMANTIC_KEYS, seedSemanticBlocks } from "@/lib/semantic/seed";
import { createSemanticBlockStore } from "@/lib/semantic/store";
import { UnknownSemanticBlockError, type SemanticBlockStore } from "@/lib/semantic/types";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * The Semantic Company Model against real Postgres.
 *
 * Opt-in, because it needs a running `supabase start`:
 *
 *   SUPABASE_INTEGRATION=1 npm test
 *
 * The unit tests cover the decisions; this covers the guarantees that only
 * exist in SQL and that a fake store cannot prove: that the head and the
 * history are written atomically, that the revision counter is monotonic, that
 * history is append-only against a direct UPDATE, that ranked full-text search
 * actually ranks, and that a company cannot read another's state.
 *
 * A schema that does not work will pass every unit test in this repository.
 */
const enabled = Boolean(process.env.SUPABASE_INTEGRATION);

const COMPANY = { companyId: "00000000-0000-4000-8000-0000000000f1" };
const OTHER = { companyId: "00000000-0000-4000-8000-0000000000f2" };

describe.skipIf(!enabled)("Semantic Company Model against Postgres", () => {
  const supabase = enabled ? createServiceClient() : (null as never);
  let store: SemanticBlockStore;

  beforeAll(async () => {
    store = createSemanticBlockStore(supabase);

    for (const scope of [COMPANY, OTHER]) {
      for (const table of [
        // Revisions cascade from their block; the append-only trigger permits
        // that and only that. Errors are checked because a silent cleanup
        // failure makes every assertion below meaningless.
        "semantic_blocks",
        "company_briefs",
        "semantic_interactions",
      ] as const) {
        const { error } = await supabase
          .from(table)
          .delete()
          .eq("company_id", scope.companyId);

        if (error) throw error;
      }
    }

    await seedSemanticBlocks(store, COMPANY);

    await store.reviseBlock(OTHER, {
      key: "hiring",
      title: "Hiring",
      body: "A different company is hiring a designer.",
      labels: ["hiring"],
      recordedAt: "2026-09-03T10:00:00Z",
    });
  }, 60_000);

  it("keeps one block per topic however many times it is revised", async () => {
    const blocks = await store.listCurrentBlocks(COMPANY);

    expect(blocks.map((block) => block.key).sort()).toEqual([...SEED_SEMANTIC_KEYS].sort());

    const hiring = blocks.find((block) => block.key === "hiring");
    expect(hiring?.revision).toBe(3);
  });

  it("projects the newest revision onto the block itself", async () => {
    const hiring = await store.getBlock(COMPANY, { key: "hiring" });
    const [newest] = await store.getBlockHistory(COMPANY, { key: "hiring" });

    expect(hiring?.body).toContain("frozen until the Series A closes");
    expect(hiring?.currentRevisionId).toBe(newest.id);
    expect(hiring?.revision).toBe(newest.revision);
    expect(hiring?.body).toBe(newest.body);
    // Promoted to baseline context by the freeze.
    expect(hiring?.contextPolicy).toBe("always");
  });

  it("keeps every earlier understanding, chained and closed out", async () => {
    const history = await store.getBlockHistory(COMPANY, { key: "hiring" });

    expect(history.map((revision) => revision.revision)).toEqual([3, 2, 1]);
    expect(history[2].body).toContain("two engineers");
    expect(history[1].body).toContain("may only make one");

    expect(history[2].supersededAt).toBe(history[1].recordedAt);
    expect(history[1].supersededAt).toBe(history[0].recordedAt);
    expect(history[0].supersededAt).toBeUndefined();

    expect(history[1].supersedesRevisionId).toBe(history[2].id);
    expect(history.map((revision) => revision.changeKind)).toEqual([
      "revised",
      "revised",
      "created",
    ]);
  });

  it("answers what was believed at a past moment", async () => {
    const september = await store.getBlockAsOf(
      COMPANY,
      { key: "hiring" },
      "2026-09-20T00:00:00Z"
    );
    const october = await store.getBlockAsOf(COMPANY, { key: "hiring" }, "2026-10-15T00:00:00Z");
    const now = await store.getBlockAsOf(COMPANY, { key: "hiring" }, "2027-01-01T00:00:00Z");

    expect(september?.body).toContain("two engineers");
    expect(october?.body).toContain("may only make one");
    expect(now?.body).toContain("frozen");

    // Before the topic existed at all.
    expect(await store.getBlockAsOf(COMPANY, { key: "hiring" }, "2026-01-01T00:00:00Z")).toBeNull();
  });

  it("refuses to write a revision before the one it follows", async () => {
    await expect(
      store.reviseBlock(COMPANY, {
        key: "hiring",
        title: "Hiring",
        body: "A revision smuggled in underneath the ones already recorded.",
        recordedAt: "2026-01-01T00:00:00Z",
      })
    ).rejects.toThrow(/moves forward/);
  });

  it("will not let history be edited", async () => {
    const [, previous] = await store.getBlockHistory(COMPANY, { key: "hiring" });

    const { error } = await supabase
      .from("semantic_block_revisions")
      .update({ body: "tampered" })
      .eq("id", previous.id);

    expect(error?.message).toMatch(/append-only/);

    const { error: deleteError } = await supabase
      .from("semantic_block_revisions")
      .delete()
      .eq("id", previous.id);

    expect(deleteError?.message).toMatch(/append-only/);
  });

  it("ranks a plain-language question onto the right topic", async () => {
    const results = await store.searchCurrentBlocks(COMPANY, {
      text: "can we afford to hire another engineer?",
      limit: 3,
    });

    expect(results[0].key).toBe("hiring");
    expect(results[0].body).toContain("frozen");
  });

  it("finds a topic by a word that only appears in its body", async () => {
    const results = await store.searchCurrentBlocks(COMPANY, { text: "SOC 2", limit: 3 });

    expect(results.map((block) => block.key)).toContain("enterprise-launch");
  });

  it("returns nothing rather than something plausible when nothing matches", async () => {
    const results = await store.searchCurrentBlocks(COMPANY, {
      text: "zeppelin refurbishment",
      limit: 5,
    });

    expect(results).toEqual([]);
  });

  it("falls back to the most load-bearing state when given no query", async () => {
    const results = await store.searchCurrentBlocks(COMPANY, { limit: 3 });

    // `always` blocks first, then salience. This is what a cold-open gets.
    expect(results[0].contextPolicy).toBe("always");
    expect(results.map((block) => block.key)).toContain("financial-posture");
  });

  it("confines every read to one company", async () => {
    const theirs = await store.getBlock(OTHER, { key: "hiring" });
    const ours = await store.getBlock(COMPANY, { key: "hiring" });

    expect(theirs?.body).toContain("designer");
    expect(ours?.body).toContain("frozen");

    expect(await store.getBlock(OTHER, { key: "customer-acme" })).toBeNull();
    expect(await store.searchCurrentBlocks(OTHER, { text: "Acme" })).toEqual([]);

    // A block id from another company resolves to nothing, not to their block.
    await expect(store.getBlockHistory(OTHER, { id: ours!.id })).rejects.toThrow(
      UnknownSemanticBlockError
    );
  });

  it("reaches all of it through the PersistentMemory boundary", async () => {
    const memory = new SemanticPersistentMemory({ reader: store });

    const [top] = await memory.search(COMPANY, { text: "are we still hiring?" });
    expect(top.id).toBe("hiring");
    expect(top.content).toContain("frozen");
    expect(top.content).not.toContain("two engineers");

    const revisions = await memory.history(COMPANY, "hiring");
    expect(revisions).toHaveLength(3);
    expect(revisions[2].content).toContain("two engineers");

    // A revision id fetches the wording of the day, flagged as superseded.
    const historical = await memory.get(COMPANY, revisions[2].id);
    expect(historical?.attributes).toMatchObject({ current: false, revision: 1 });
  });
});
