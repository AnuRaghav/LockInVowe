import { beforeAll, describe, expect, it } from "vitest";

import {
  createDeterministicBriefWriter,
  createCompanyBriefStore,
  ensureCompanyBrief,
} from "@/lib/semantic/brief";
import { createSemanticBlockStore } from "@/lib/semantic/store";
import type { SemanticBlockStore } from "@/lib/semantic/types";
import { updateSemanticState } from "@/lib/semantic/update";
import { createSemanticInteractionStore } from "@/lib/semantic/update/interactions";
import { createScriptedSemanticProposer } from "@/lib/semantic/update/proposer";
import type { SemanticInteraction, SemanticProposal } from "@/lib/semantic/update/types";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Consolidation and the brief, against real Postgres.
 *
 * The unit tests prove the logic; this proves the wiring - that an interaction
 * is claimed idempotently by a unique constraint rather than by a Map, that a
 * revision's `source_interaction_id` foreign key actually resolves to the
 * conversation that caused it, and that brief versions are written as rows.
 *
 *   SUPABASE_INTEGRATION=1 npm test
 */
const enabled = Boolean(process.env.SUPABASE_INTEGRATION);

const COMPANY = { companyId: "00000000-0000-4000-8000-0000000000f3" };

const conversation = (
  externalKey: string,
  founder: string,
  occurredAt: string
): SemanticInteraction => ({
  externalKey,
  source: "conversation",
  threadId: "thread_integration",
  runId: "run_integration",
  occurredAt,
  messages: [
    { role: "founder", text: founder },
    { role: "sam", text: "Understood." },
  ],
});

const PLAN: SemanticProposal = {
  assessment: "A Q4 hiring plan was set out.",
  operations: [
    {
      op: "create",
      key: "hiring",
      title: "Hiring",
      summary: "Two engineering hires planned for Q4.",
      body: "The company plans to hire two engineers in Q4 for the platform team.",
      labels: ["hiring", "headcount"],
      salience: 0.75,
      changeNote: "Q4 hiring plan set out.",
    },
  ],
};

const FREEZE: SemanticProposal = {
  assessment: "Hiring is frozen until the raise closes.",
  operations: [
    {
      op: "revise",
      key: "hiring",
      summary: "Engineering hiring is frozen until the Series A closes.",
      body: "Engineering hiring is frozen until the Series A closes. Neither Q4 platform hire will be made before then.",
      salience: 0.9,
      contextPolicy: "always",
      changeNote: "Hiring frozen until after the raise.",
    },
  ],
};

describe.skipIf(!enabled)("semantic consolidation against Postgres", () => {
  const supabase = enabled ? createServiceClient() : (null as never);
  let store: SemanticBlockStore;

  const consolidate = (interaction: SemanticInteraction, proposal: SemanticProposal) =>
    updateSemanticState({
      scope: COMPANY,
      interaction,
      proposer: createScriptedSemanticProposer([proposal]),
      store,
      interactions: createSemanticInteractionStore(supabase),
      now: interaction.occurredAt,
    });

  beforeAll(async () => {
    store = createSemanticBlockStore(supabase);

    for (const table of [
      "semantic_blocks",
      "company_briefs",
      "semantic_interactions",
    ] as const) {
      const { error } = await supabase.from(table).delete().eq("company_id", COMPANY.companyId);
      if (error) throw error;
    }
  }, 60_000);

  it("consolidates two conversations into one topic with two revisions", async () => {
    const first = await consolidate(
      conversation("int_plan", "We're hiring two engineers in Q4.", "2026-09-03T14:30:00Z"),
      PLAN
    );
    const second = await consolidate(
      conversation("int_freeze", "Freeze hiring until the raise.", "2026-11-04T09:30:00Z"),
      FREEZE
    );

    expect(first.applied[0]).toMatchObject({ op: "create", revision: 1 });
    expect(second.applied[0]).toMatchObject({ op: "revise", revision: 2 });

    const blocks = await store.listCurrentBlocks(COMPANY);
    expect(blocks.map((block) => block.key)).toEqual(["hiring"]);
    expect(blocks[0].body).toContain("frozen");
  });

  it("links every revision back to the conversation that caused it", async () => {
    const history = await store.getBlockHistory(COMPANY, { key: "hiring" });

    const { data, error } = await supabase
      .from("semantic_interactions")
      .select("id, external_key, transcript, status, proposal, outcome")
      .eq("company_id", COMPANY.companyId)
      .eq("id", history[0].sourceInteractionId!)
      .single();

    if (error) throw error;

    expect(data.external_key).toBe("int_freeze");
    expect(data.status).toBe("processed");
    // The transcript lives here, once...
    expect(JSON.stringify(data.transcript)).toContain("Freeze hiring until the raise.");
    // ...and the revision carries a reference plus a short quote, not the
    // conversation. Sam's own turn never reaches the block.
    expect(history[0].provenance).toMatchObject({
      kind: "conversation",
      threadId: "thread_integration",
      excerpt: "Freeze hiring until the raise.",
    });
    expect(JSON.stringify(history[0].provenance)).not.toContain("Understood.");

    // The proposal that produced it is recorded whole, for diagnosing a bad one.
    expect(JSON.stringify(data.proposal)).toContain("Hiring is frozen until the raise closes.");
    expect(JSON.stringify(data.outcome)).toContain("hiring");
  });

  it("refuses to consolidate the same conversation twice", async () => {
    const replay = await updateSemanticState({
      scope: COMPANY,
      interaction: conversation(
        "int_freeze",
        "Freeze hiring until the raise.",
        "2026-11-04T09:30:00Z"
      ),
      // Exhausted on purpose: reaching the model would throw.
      proposer: createScriptedSemanticProposer([]),
      store,
      interactions: createSemanticInteractionStore(supabase),
    });

    expect(replay.status).toBe("skipped");
    expect((await store.getBlock(COMPANY, { key: "hiring" }))?.revision).toBe(2);
  });

  it("materializes the brief and re-materializes it only when state moves", async () => {
    const briefs = createCompanyBriefStore(supabase);
    const writer = createDeterministicBriefWriter();

    const first = await ensureCompanyBrief({ scope: COMPANY, reader: store, briefs, writer });
    const second = await ensureCompanyBrief({ scope: COMPANY, reader: store, briefs, writer });

    expect(first.regenerated).toBe(true);
    expect(first.brief?.version).toBe(1);
    expect(first.brief?.body).toContain("frozen until the Series A closes");
    expect(first.brief?.sourceBlockIds).toHaveLength(1);
    expect(first.brief!.body.length).toBeLessThanOrEqual(2000);

    // Nothing changed, so nothing was written.
    expect(second.regenerated).toBe(false);
    expect(second.brief?.version).toBe(1);

    await consolidate(
      conversation("int_reopen", "Hiring is back on, two roles.", "2026-12-02T09:00:00Z"),
      {
        assessment: "The freeze is lifted.",
        operations: [
          {
            op: "revise",
            key: "hiring",
            summary: "Hiring has reopened; two platform roles are live.",
            body: "The freeze is lifted and two platform roles are open.",
            salience: 0.9,
            contextPolicy: "always",
            changeNote: "Freeze lifted after the raise closed.",
          },
        ],
      }
    );

    const third = await ensureCompanyBrief({ scope: COMPANY, reader: store, briefs, writer });

    expect(third.regenerated).toBe(true);
    expect(third.brief?.version).toBe(2);
    expect(third.brief?.body).toContain("reopened");
    expect(third.brief?.body).not.toContain("frozen");

    // Earlier briefs are kept, so what Sam opened with can be reconstructed.
    const { count } = await supabase
      .from("company_briefs")
      .select("*", { count: "exact", head: true })
      .eq("company_id", COMPANY.companyId);

    expect(count).toBe(2);
  });
});
