import { beforeEach, describe, expect, it } from "vitest";

import {
  InMemorySemanticBlockStore,
  InMemorySemanticInteractionStore,
} from "@/lib/semantic/in-memory";
import type { SemanticBlockStore } from "@/lib/semantic/types";
import { createScriptedSemanticProposer } from "@/lib/semantic/update/proposer";
import { updateSemanticState } from "@/lib/semantic/update";
import type {
  SemanticInteraction,
  SemanticProposal,
  SemanticProposer,
} from "@/lib/semantic/update/types";

/**
 * The semantic updater, end to end, with the model's judgement supplied
 * deterministically.
 *
 * What is being tested here is *not* whether Claude extracts hiring plans well.
 * It is everything around that: that a changed plan revises the topic it
 * belongs to instead of appending a second one, that current state reflects
 * only the latest understanding, that the earlier understandings stay
 * recoverable, and that the conservative paths - nothing said, nothing changed,
 * already processed - genuinely write nothing.
 *
 * Those are the properties that make the company's understanding trustworthy,
 * and they are properties of application code, so they are tested without a
 * model in the loop.
 */

const COMPANY = { companyId: "company_semantic_test" };
const OTHER_COMPANY = { companyId: "company_semantic_other" };

let store: SemanticBlockStore;
let interactions: InMemorySemanticInteractionStore;

beforeEach(() => {
  store = new InMemorySemanticBlockStore();
  interactions = new InMemorySemanticInteractionStore();
});

const conversation = (
  externalKey: string,
  founder: string,
  occurredAt: string
): SemanticInteraction => ({
  externalKey,
  source: "conversation",
  threadId: "thread_1",
  occurredAt,
  messages: [
    { role: "founder", text: founder },
    { role: "sam", text: "Understood." },
  ],
});

const run = (interaction: SemanticInteraction, proposer: SemanticProposer) =>
  updateSemanticState({
    scope: COMPANY,
    interaction,
    proposer,
    store,
    interactions,
    now: interaction.occurredAt,
  });

const hiringProposals: SemanticProposal[] = [
  {
    assessment: "The company set out a Q4 engineering hiring plan.",
    operations: [
      {
        op: "create",
        key: "hiring",
        title: "Hiring",
        summary: "Two engineering hires planned for Q4.",
        body: "The company plans to hire two engineers in Q4, both for the platform team, at roughly $205K fully loaded each.",
        labels: ["hiring", "headcount"],
        salience: 0.75,
        changeNote: "Q4 hiring plan set out.",
      },
    ],
  },
  {
    assessment: "The hiring plan narrowed from two engineers to one.",
    operations: [
      {
        op: "revise",
        key: "hiring",
        summary: "Possibly one engineering hire in Q4.",
        body: "The company is reconsidering the two Q4 engineering hires and may only make one, weighing the second against runway.",
        changeNote: "Narrowed from two hires to possibly one.",
      },
    ],
  },
  {
    assessment: "Engineering hiring is frozen until the raise closes.",
    operations: [
      {
        op: "revise",
        key: "hiring",
        summary: "Engineering hiring is frozen until the Series A closes.",
        body: "Engineering hiring is frozen until the Series A closes. Neither Q4 platform hire will be made before then. The freeze is a runway decision, not a change in roadmap.",
        salience: 0.9,
        contextPolicy: "always",
        changeNote: "Hiring frozen until after the raise.",
      },
    ],
  },
];

/** The three-step story from the design, as three interactions. */
const evolveHiring = async () => {
  const proposer = createScriptedSemanticProposer(hiringProposals);

  return [
    await run(
      conversation("conv_1", "We're going to hire two engineers in Q4.", "2026-09-03T14:30:00Z"),
      proposer
    ),
    await run(
      conversation("conv_2", "We might only do one of those hires.", "2026-10-11T15:45:00Z"),
      proposer
    ),
    await run(
      conversation(
        "conv_3",
        "We've changed our minds. Freeze engineering hiring until after the raise.",
        "2026-11-04T09:30:00Z"
      ),
      proposer
    ),
  ];
};

describe("updateSemanticState", () => {
  it("creates a block the first time a topic is discussed", async () => {
    const proposer = createScriptedSemanticProposer([hiringProposals[0]]);

    const result = await run(
      conversation("conv_1", "We're going to hire two engineers in Q4.", "2026-09-03T14:30:00Z"),
      proposer
    );

    expect(result.status).toBe("applied");
    expect(result.applied).toEqual([
      expect.objectContaining({ op: "create", key: "hiring", revision: 1, created: true }),
    ]);

    const block = await store.getBlock(COMPANY, { key: "hiring" });
    expect(block?.body).toContain("two engineers");
  });

  it("consolidates each change into the same block rather than adding new ones", async () => {
    const results = await evolveHiring();

    expect(results.map((result) => result.status)).toEqual(["applied", "applied", "applied"]);
    expect(results.map((result) => result.applied[0].revision)).toEqual([1, 2, 3]);

    // The whole point: three conversations about hiring, one hiring topic.
    const blocks = await store.listCurrentBlocks(COMPANY);
    expect(blocks.map((block) => block.key)).toEqual(["hiring"]);
    expect(blocks[0].revision).toBe(3);
  });

  it("leaves current state reflecting only the latest understanding", async () => {
    await evolveHiring();

    const block = await store.getBlock(COMPANY, { key: "hiring" });

    expect(block?.body).toContain("frozen until the Series A closes");
    expect(block?.body).not.toContain("two engineers");
    expect(block?.body).not.toContain("may only make one");
    // The freeze was important enough to become baseline context.
    expect(block?.contextPolicy).toBe("always");
  });

  it("keeps every earlier understanding recoverable", async () => {
    await evolveHiring();

    const history = await store.getBlockHistory(COMPANY, { key: "hiring" });

    expect(history.map((revision) => revision.revision)).toEqual([3, 2, 1]);
    expect(history[2].body).toContain("two engineers");
    expect(history[1].body).toContain("may only make one");
    expect(history[0].body).toContain("frozen");

    expect(history.map((revision) => revision.changeNote)).toEqual([
      "Hiring frozen until after the raise.",
      "Narrowed from two hires to possibly one.",
      "Q4 hiring plan set out.",
    ]);

    // Each revision was current until the next one replaced it.
    expect(history[2].supersededAt).toBe("2026-10-11T15:45:00Z");
    expect(history[1].supersededAt).toBe("2026-11-04T09:30:00Z");
    expect(history[0].supersededAt).toBeUndefined();
  });

  it("reconstructs what the company believed at a past moment", async () => {
    await evolveHiring();

    const inOctober = await store.getBlockAsOf(COMPANY, { key: "hiring" }, "2026-10-15T00:00:00Z");
    const inSeptember = await store.getBlockAsOf(COMPANY, { key: "hiring" }, "2026-09-20T00:00:00Z");

    expect(inOctober?.revision).toBe(2);
    expect(inSeptember?.revision).toBe(1);
    expect(inSeptember?.body).toContain("two engineers");
  });

  it("writes nothing when an interaction says nothing durable", async () => {
    await run(
      conversation("conv_1", "We're going to hire two engineers in Q4.", "2026-09-03T14:30:00Z"),
      createScriptedSemanticProposer([hiringProposals[0]])
    );

    const result = await run(
      conversation("conv_small_talk", "What's our runway again?", "2026-09-04T09:00:00Z"),
      createScriptedSemanticProposer([
        {
          assessment: "The founder asked a question. Nothing durable changed.",
          operations: [{ op: "none", reason: "A question, not a decision." }],
        },
      ])
    );

    expect(result.status).toBe("unchanged");
    expect(result.applied).toEqual([]);

    const block = await store.getBlock(COMPANY, { key: "hiring" });
    expect(block?.revision).toBe(1);
  });

  it("refuses to record a restatement as a change", async () => {
    await run(
      conversation("conv_1", "We're going to hire two engineers in Q4.", "2026-09-03T14:30:00Z"),
      createScriptedSemanticProposer([hiringProposals[0]])
    );

    // The same understanding, differently wrapped. Not a revision.
    const result = await run(
      conversation("conv_restate", "So, two engineers in Q4 then.", "2026-09-05T09:00:00Z"),
      createScriptedSemanticProposer([
        {
          assessment: "Restates the existing plan.",
          operations: [
            {
              op: "revise",
              key: "hiring",
              summary: "Two engineering hires planned for Q4.",
              body: "The  company plans to hire TWO engineers in Q4, both for the platform team,\nat roughly $205K fully loaded each.",
              changeNote: "Restated.",
            },
          ],
        },
      ])
    );

    expect(result.status).toBe("unchanged");
    expect(result.rejected[0]).toMatchObject({ reason: "no_material_change", key: "hiring" });
    expect((await store.getBlock(COMPANY, { key: "hiring" }))?.revision).toBe(1);
  });

  it("creates a separate block for a genuinely new topic", async () => {
    await evolveHiring();

    const result = await run(
      conversation(
        "conv_acme",
        "Acme's champion left and they're 18% of MRR. Renewal is in January.",
        "2026-11-06T10:00:00Z"
      ),
      createScriptedSemanticProposer([
        {
          assessment: "A new customer-concentration risk.",
          operations: [
            {
              op: "create",
              key: "customer-acme",
              title: "Customer concentration: Acme",
              summary: "Acme is ~18% of MRR and renews in January.",
              body: "Acme accounts for roughly 18% of MRR and renews in January. Their champion left and the new owner has not re-engaged.",
              labels: ["customers", "risk"],
              salience: 0.85,
              changeNote: "Acme concentration risk recorded.",
            },
          ],
        },
      ])
    );

    expect(result.applied).toEqual([
      expect.objectContaining({ op: "create", key: "customer-acme", revision: 1 }),
    ]);

    // The new topic did not disturb the old one.
    const hiring = await store.getBlock(COMPANY, { key: "hiring" });
    expect(hiring?.revision).toBe(3);
    expect(hiring?.body).toContain("frozen");

    const keys = (await store.listCurrentBlocks(COMPANY)).map((block) => block.key);
    expect(keys.sort()).toEqual(["customer-acme", "hiring"]);
  });

  it("archives a topic without destroying it", async () => {
    await evolveHiring();

    const result = await run(
      conversation("conv_closed", "The raise closed. We're done with that.", "2026-12-01T10:00:00Z"),
      createScriptedSemanticProposer([
        {
          assessment: "Hiring freeze is over; the topic ran its course.",
          operations: [
            {
              op: "archive",
              key: "hiring",
              status: "resolved",
              changeNote: "Freeze lifted; the raise closed.",
            },
          ],
        },
      ])
    );

    expect(result.applied[0]).toMatchObject({ op: "archive", revision: 4 });

    const block = await store.getBlock(COMPANY, { key: "hiring" });
    expect(block?.status).toBe("resolved");
    // Resolved is not deleted: the body and the whole history are still there.
    expect(block?.body).toContain("frozen");
    expect(await store.getBlockHistory(COMPANY, { key: "hiring" })).toHaveLength(4);

    // ...but it is no longer part of current state.
    expect(await store.listCurrentBlocks(COMPANY)).toEqual([]);
  });

  it("does not consolidate the same interaction twice", async () => {
    const interaction = conversation(
      "conv_1",
      "We're going to hire two engineers in Q4.",
      "2026-09-03T14:30:00Z"
    );

    const first = await run(interaction, createScriptedSemanticProposer([hiringProposals[0]]));
    // A scripted proposer with nothing left to give: reaching it would throw,
    // which is exactly the assertion - the replay must not consult the model.
    const second = await run(interaction, createScriptedSemanticProposer([]));

    expect(first.status).toBe("applied");
    expect(second.status).toBe("skipped");
    expect(second.interactionId).toBe(first.interactionId);
    expect((await store.getBlock(COMPANY, { key: "hiring" }))?.revision).toBe(1);
  });
});

describe("updateSemanticState validation", () => {
  it("refuses to revise a topic that does not exist", async () => {
    const result = await run(
      conversation("conv_x", "Something about a thing.", "2026-09-03T14:30:00Z"),
      createScriptedSemanticProposer([
        {
          assessment: "Revising a topic that was never created.",
          operations: [
            { op: "revise", key: "imaginary", body: "Something the model made up." },
          ],
        },
      ])
    );

    expect(result.status).toBe("unchanged");
    expect(result.rejected[0]).toMatchObject({ reason: "unknown_topic", key: "imaginary" });
    expect(await store.listCurrentBlocks(COMPANY)).toEqual([]);
  });

  it("turns a create for an existing topic into a revision", async () => {
    await run(
      conversation("conv_1", "We're going to hire two engineers in Q4.", "2026-09-03T14:30:00Z"),
      createScriptedSemanticProposer([hiringProposals[0]])
    );

    const result = await run(
      conversation("conv_dup", "Hiring is frozen now.", "2026-11-04T09:30:00Z"),
      createScriptedSemanticProposer([
        {
          assessment: "The model proposed a second hiring block.",
          operations: [
            {
              op: "create",
              key: "hiring",
              title: "Hiring",
              body: "Engineering hiring is frozen until the raise closes.",
              changeNote: "Frozen.",
            },
          ],
        },
      ])
    );

    expect(result.applied[0]).toMatchObject({ op: "revise", key: "hiring", revision: 2 });
    expect((await store.listCurrentBlocks(COMPANY)).map((block) => block.key)).toEqual(["hiring"]);
  });

  it("normalizes a loosely-written key onto the topic it names", async () => {
    const result = await run(
      conversation("conv_key", "Acme is a concentration risk.", "2026-09-03T14:30:00Z"),
      createScriptedSemanticProposer([
        {
          assessment: "New topic with an untidy key.",
          operations: [
            {
              op: "create",
              key: "Customer Acme",
              title: "Customer Acme",
              body: "Acme is about 18% of MRR.",
            },
          ],
        },
      ])
    );

    expect(result.applied[0].key).toBe("customer-acme");
  });

  it("keeps fields the proposal did not mention", async () => {
    await run(
      conversation("conv_1", "We're going to hire two engineers in Q4.", "2026-09-03T14:30:00Z"),
      createScriptedSemanticProposer([hiringProposals[0]])
    );

    await run(
      conversation("conv_2", "Make that one hire.", "2026-10-11T15:45:00Z"),
      createScriptedSemanticProposer([
        {
          assessment: "Narrowed to one hire.",
          operations: [{ op: "revise", key: "hiring", body: "The company will make one Q4 hire." }],
        },
      ])
    );

    const block = await store.getBlock(COMPANY, { key: "hiring" });
    // Labels, salience, and title were never restated and must survive.
    expect(block?.labels).toEqual(["hiring", "headcount"]);
    expect(block?.salience).toBe(0.75);
    expect(block?.title).toBe("Hiring");
  });

  it("records provenance pointing at the interaction, not the transcript", async () => {
    const result = await run(
      conversation("conv_1", "We're going to hire two engineers in Q4.", "2026-09-03T14:30:00Z"),
      createScriptedSemanticProposer([hiringProposals[0]])
    );

    const [revision] = await store.getBlockHistory(COMPANY, { key: "hiring" });

    expect(revision.provenance).toMatchObject({
      kind: "conversation",
      interactionId: result.interactionId,
      threadId: "thread_1",
    });
    expect(revision.sourceInteractionId).toBe(result.interactionId);
    // A short quote, not the conversation. Sam's side is never copied in.
    expect(revision.provenance.excerpt).toBe("We're going to hire two engineers in Q4.");
    expect(JSON.stringify(revision.provenance)).not.toContain("Understood.");
  });

  it("keeps one company's understanding out of another's", async () => {
    await run(
      conversation("conv_1", "We're going to hire two engineers in Q4.", "2026-09-03T14:30:00Z"),
      createScriptedSemanticProposer([hiringProposals[0]])
    );

    expect(await store.getBlock(OTHER_COMPANY, { key: "hiring" })).toBeNull();
    expect(await store.listCurrentBlocks(OTHER_COMPANY)).toEqual([]);
  });

  it("records the proposal and the outcome against the interaction", async () => {
    const result = await run(
      conversation("conv_1", "We're going to hire two engineers in Q4.", "2026-09-03T14:30:00Z"),
      createScriptedSemanticProposer([hiringProposals[0]])
    );

    expect(interactions.completions.get(result.interactionId)).toMatchObject({
      status: "processed",
      proposal: { assessment: "The company set out a Q4 engineering hiring plan." },
      result: { applied: [expect.objectContaining({ key: "hiring" })] },
    });
  });

  it("reports a proposer failure without taking down the caller", async () => {
    const broken: SemanticProposer = {
      async propose() {
        throw new Error("model unavailable");
      },
    };

    const result = await run(
      conversation("conv_1", "We're going to hire two engineers in Q4.", "2026-09-03T14:30:00Z"),
      broken
    );

    expect(result.status).toBe("failed");
    expect(result.error).toBe("model unavailable");
    expect(await store.listCurrentBlocks(COMPANY)).toEqual([]);
  });
});
