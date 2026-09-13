import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import {
  createCommunicationContractStore,
  createFounderBlockStore,
} from "@/lib/founder/store";
import {
  FounderSensitivityDowngradeError,
  UnknownFounderBlockError,
  type FounderBlockStore,
} from "@/lib/founder/types";
import type { CommunicationContractStore } from "@/lib/founder/contract";
import { createServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/lib/supabase/types";

/**
 * The Founder Model against real Postgres.
 *
 * Opt-in (`npm run test:integration`). Covers what only SQL can prove: that
 * personal blocks are filtered in the database functions themselves, that
 * sensitivity cannot be downgraded, that history is append-only yet erasable
 * with its block, that the contract merge happens under the database's rules,
 * and that none of it is reachable with the anon key.
 */
const enabled = Boolean(process.env.SUPABASE_INTEGRATION);

const FOUNDER = { founderId: "00000000-0000-4000-8000-0000000000a1" };
const COFOUNDER = { founderId: "00000000-0000-4000-8000-0000000000a2" };

describe.skipIf(!enabled)("Founder Model against Postgres", () => {
  const supabase = enabled ? createServiceClient() : (null as never);
  let blocks: FounderBlockStore;
  let contracts: CommunicationContractStore;

  beforeAll(async () => {
    blocks = createFounderBlockStore(supabase);
    contracts = createCommunicationContractStore(supabase);

    for (const scope of [FOUNDER, COFOUNDER]) {
      for (const table of ["founder_blocks", "founder_communication_contract_revisions"] as const) {
        const { error } = await supabase.from(table).delete().eq("founder_id", scope.founderId);
        if (error) throw error;
      }
    }

    await blocks.reviseBlock(FOUNDER, {
      key: "risk-and-values",
      title: "Risk and values",
      body: "Will not take venture debt. Would rather cut burn than raise at a lower valuation.",
      labels: ["risk", "values"],
      salience: 0.8,
      recordedAt: "2026-09-14T09:00:00Z",
    });

    await blocks.reviseBlock(FOUNDER, {
      key: "personal-runway",
      title: "Personal runway",
      body: "Takes a $60K salary and could go about 8 months on savings.",
      labels: ["salary", "runway"],
      sensitivity: "personal",
      salience: 0.7,
      recordedAt: "2026-09-14T09:05:00Z",
    });
  }, 60_000);

  it("filters personal blocks in every read path unless asked", async () => {
    expect(await blocks.getBlock(FOUNDER, { key: "personal-runway" })).toBeNull();
    expect((await blocks.listCurrentBlocks(FOUNDER)).map((block) => block.key)).toEqual(["risk-and-values"]);
    expect(await blocks.searchCurrentBlocks(FOUNDER, { text: "salary savings" })).toEqual([]);
    await expect(blocks.getBlockHistory(FOUNDER, { key: "personal-runway" })).rejects.toThrow(
      UnknownFounderBlockError
    );

    const [found] = await blocks.searchCurrentBlocks(FOUNDER, { text: "salary", includePersonal: true });
    expect(found?.key).toBe("personal-runway");
    expect(found?.sensitivity).toBe("personal");
  });

  it("keeps sensitivity when a revision omits it, and refuses a downgrade", async () => {
    await blocks.reviseBlock(FOUNDER, {
      key: "personal-runway",
      title: "Personal runway",
      body: "Cut salary to $40K; savings now last about 10 months.",
      recordedAt: "2026-09-20T09:00:00Z",
    });

    const revised = await blocks.getBlock(FOUNDER, { key: "personal-runway" }, { includePersonal: true });
    expect(revised).toMatchObject({ sensitivity: "personal", revision: 2 });

    await expect(
      blocks.reviseBlock(FOUNDER, {
        key: "personal-runway",
        title: "Personal runway",
        body: "Fine to share now.",
        sensitivity: "standard",
        recordedAt: "2026-09-21T09:00:00Z",
      })
    ).rejects.toThrow(FounderSensitivityDowngradeError);
  });

  it("will not let history be edited or a single revision be deleted", async () => {
    const [newest] = await blocks.getBlockHistory(FOUNDER, { key: "personal-runway" }, { includePersonal: true });

    const { error } = await supabase.from("founder_block_revisions").update({ body: "tampered" }).eq("id", newest.id);
    expect(error?.message).toMatch(/append-only/);

    const { error: deleteError } = await supabase.from("founder_block_revisions").delete().eq("id", newest.id);
    expect(deleteError?.message).toMatch(/append-only/);
  });

  it("confines blocks to one founder", async () => {
    expect(await blocks.listCurrentBlocks(COFOUNDER, { includePersonal: true })).toEqual([]);
    const ours = await blocks.getBlock(FOUNDER, { key: "risk-and-values" });
    expect(await blocks.getBlock(COFOUNDER, { id: ours!.id })).toBeNull();
    expect(await blocks.deleteBlock(COFOUNDER, { id: ours!.id })).toBe(false);
  });

  it("erases a block together with its history", async () => {
    await blocks.reviseBlock(FOUNDER, {
      key: "personal-guarantees",
      title: "Personal guarantees",
      body: "Personally guaranteed the office lease.",
      sensitivity: "personal",
      recordedAt: "2026-09-14T10:00:00Z",
    });
    const block = await blocks.getBlock(FOUNDER, { key: "personal-guarantees" }, { includePersonal: true });

    expect(await blocks.deleteBlock(FOUNDER, { key: "personal-guarantees" })).toBe(true);

    const { count, error } = await supabase
      .from("founder_block_revisions")
      .select("id", { count: "exact", head: true })
      .eq("block_id", block!.id);
    expect(error).toBeNull();
    expect(count).toBe(0);
  });

  it("merges contract patches into full revisions", async () => {
    const first = await contracts.revise(FOUNDER, {
      patch: { badNews: "news_with_options", alerts: [{ metric: "runway_months", direction: "below", threshold: 9 }] },
      provenance: { kind: "onboarding" },
    });
    expect(first).toMatchObject({ revision: 1, changeKind: "created", badNews: "news_with_options" });

    const second = await contracts.revise(FOUNDER, { patch: { detail: "headline" } });
    expect(second).toMatchObject({
      revision: 2,
      changeKind: "revised",
      badNews: "news_with_options",
      detail: "headline",
      alerts: [{ metric: "runway_months", direction: "below", threshold: 9 }],
    });

    const third = await contracts.revise(FOUNDER, { patch: { badNews: null, alerts: null }, changeKind: "corrected" });
    expect(third.badNews).toBeUndefined();
    expect(third.alerts).toEqual([]);
    expect(third.detail).toBe("headline");

    expect((await contracts.getCurrent(FOUNDER))?.revision).toBe(3);
    expect((await contracts.getHistory(FOUNDER)).map((contract) => contract.revision)).toEqual([3, 2, 1]);
    expect(await contracts.getCurrent(COFOUNDER)).toBeNull();
  });

  it("does not lose either of two concurrent contract answers", async () => {
    await Promise.all([
      contracts.revise(COFOUNDER, { patch: { pushback: "challenge_hard" } }),
      contracts.revise(COFOUNDER, { patch: { financeFluency: "plain" } }),
    ]);

    const current = await contracts.getCurrent(COFOUNDER);
    expect(current).toMatchObject({ revision: 2, pushback: "challenge_hard", financeFluency: "plain" });
  });

  it("refuses unknown contract fields at the database too", async () => {
    const { error } = await supabase.rpc("founder_contract_revise", {
      p_founder_id: FOUNDER.founderId,
      p_patch: { tone: "warm" },
    });
    expect(error?.message).toMatch(/unknown founder contract field/);
  });

  it("is not reachable with the anon key", async () => {
    const anon = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } }
    );

    const { data } = await anon.from("founder_blocks").select("id").eq("founder_id", FOUNDER.founderId);
    expect(data ?? []).toEqual([]);

    const { error } = await anon.rpc("founder_block_search", {
      p_founder_id: FOUNDER.founderId,
      p_include_personal: true,
    });
    expect(error).not.toBeNull();
  });
});
