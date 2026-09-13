import { beforeEach, describe, expect, it } from "vitest";

import { InMemoryFounderBlockStore } from "@/lib/founder/in-memory";
import {
  FounderSensitivityDowngradeError,
  UnknownFounderBlockError,
  type FounderBlockStore,
} from "@/lib/founder/types";

/**
 * Founder blocks, and the rule that personal ones stay out of sight.
 *
 * The SQL functions implement the same rules; `store.integration.test.ts` holds
 * the real store to these behaviours against Postgres.
 */

const FOUNDER = { founderId: "founder-a" };
const COFOUNDER = { founderId: "founder-b" };

describe("founder blocks", () => {
  let store: FounderBlockStore;

  beforeEach(async () => {
    store = new InMemoryFounderBlockStore();

    await store.reviseBlock(FOUNDER, {
      key: "risk-and-values",
      title: "Risk and values",
      body: "Will not take venture debt. Would rather cut burn than raise at a lower valuation.",
      labels: ["risk", "values"],
      salience: 0.8,
      recordedAt: "2026-09-14T09:00:00Z",
    });

    await store.reviseBlock(FOUNDER, {
      key: "personal-runway",
      title: "Personal runway",
      body: "Takes a $60K salary and could go about 8 months on savings if it stopped.",
      labels: ["salary", "runway"],
      sensitivity: "personal",
      salience: 0.7,
      recordedAt: "2026-09-14T09:05:00Z",
    });
  });

  it("hides personal blocks from every read that does not ask for them", async () => {
    expect(await store.getBlock(FOUNDER, { key: "personal-runway" })).toBeNull();
    expect((await store.listCurrentBlocks(FOUNDER)).map((block) => block.key)).toEqual(["risk-and-values"]);
    expect(await store.searchCurrentBlocks(FOUNDER, { text: "runway salary" })).toEqual([]);
    await expect(store.getBlockHistory(FOUNDER, { key: "personal-runway" })).rejects.toThrow(
      UnknownFounderBlockError
    );
  });

  it("returns personal blocks when the caller opts in", async () => {
    const personal = await store.getBlock(FOUNDER, { key: "personal-runway" }, { includePersonal: true });
    expect(personal?.sensitivity).toBe("personal");

    const listed = await store.listCurrentBlocks(FOUNDER, { includePersonal: true });
    expect(listed.map((block) => block.key)).toEqual(["risk-and-values", "personal-runway"]);

    const [found] = await store.searchCurrentBlocks(FOUNDER, { text: "salary", includePersonal: true });
    expect(found.key).toBe("personal-runway");

    const history = await store.getBlockHistory(FOUNDER, { key: "personal-runway" }, { includePersonal: true });
    expect(history).toHaveLength(1);
  });

  it("keeps a personal block personal when a revision does not restate it", async () => {
    await store.reviseBlock(FOUNDER, {
      key: "personal-runway",
      title: "Personal runway",
      body: "Cut salary to $40K; savings now last about 10 months.",
      recordedAt: "2026-09-20T09:00:00Z",
    });

    const block = await store.getBlock(FOUNDER, { key: "personal-runway" }, { includePersonal: true });
    expect(block?.sensitivity).toBe("personal");
    expect(block?.revision).toBe(2);
    expect(await store.getBlock(FOUNDER, { key: "personal-runway" })).toBeNull();
  });

  it("refuses to make a personal block standard", async () => {
    await expect(
      store.reviseBlock(FOUNDER, {
        key: "personal-runway",
        title: "Personal runway",
        body: "Now fine to share.",
        sensitivity: "standard",
        recordedAt: "2026-09-20T09:00:00Z",
      })
    ).rejects.toThrow(FounderSensitivityDowngradeError);
  });

  it("lets a standard block become personal", async () => {
    await store.reviseBlock(FOUNDER, {
      key: "risk-and-values",
      title: "Risk and values",
      body: "Personally guaranteed the office lease, so will not risk missing rent.",
      sensitivity: "personal",
      recordedAt: "2026-09-20T09:00:00Z",
    });

    expect(await store.getBlock(FOUNDER, { key: "risk-and-values" })).toBeNull();
  });

  it("keeps full history for a revised block", async () => {
    await store.reviseBlock(FOUNDER, {
      key: "risk-and-values",
      title: "Risk and values",
      body: "Open to venture debt if it bridges to a Series A.",
      recordedAt: "2026-10-01T09:00:00Z",
    });

    const history = await store.getBlockHistory(FOUNDER, { key: "risk-and-values" });
    expect(history.map((revision) => revision.changeKind)).toEqual(["revised", "created"]);
    expect(history[1].body).toContain("Will not take venture debt");
    expect(history[1].supersededAt).toBe(history[0].recordedAt);
  });

  it("erases a block and its history, personal ones included, without opting in", async () => {
    expect(await store.deleteBlock(FOUNDER, { key: "personal-runway" })).toBe(true);
    expect(await store.getBlock(FOUNDER, { key: "personal-runway" }, { includePersonal: true })).toBeNull();
    await expect(
      store.getBlockHistory(FOUNDER, { key: "personal-runway" }, { includePersonal: true })
    ).rejects.toThrow(UnknownFounderBlockError);
    expect(await store.deleteBlock(FOUNDER, { key: "personal-runway" })).toBe(false);
  });

  it("confines every read to one founder", async () => {
    expect(await store.listCurrentBlocks(COFOUNDER, { includePersonal: true })).toEqual([]);
    expect(await store.getBlock(COFOUNDER, { key: "risk-and-values" })).toBeNull();
    expect(await store.deleteBlock(COFOUNDER, { key: "risk-and-values" })).toBe(false);
    expect(await store.getBlock(FOUNDER, { key: "risk-and-values" })).not.toBeNull();
  });
});
