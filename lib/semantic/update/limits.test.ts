import { describe, expect, it } from "vitest";

import { InMemorySemanticBlockStore } from "@/lib/semantic/in-memory";
import { applySemanticProposal } from "@/lib/semantic/update/apply";
import {
  createSemanticProposalSchema,
  semanticProposalSchema,
  type SemanticProposal,
  type StoredSemanticInteraction,
} from "@/lib/semantic/update/types";

const SCOPE = { companyId: "company_limits" };

const interaction: StoredSemanticInteraction = {
  id: "00000000-0000-4000-8000-0000000000c1",
  externalKey: "onboarding:session:company-basics",
  source: "onboarding",
  occurredAt: "2026-09-14T09:00:00Z",
  messages: [{ role: "founder", text: "We sell scheduling software to clinics." }],
  status: "pending",
};

const creates = (count: number): SemanticProposal => ({
  assessment: "New topics.",
  operations: Array.from({ length: count }, (_, i) => ({
    op: "create" as const,
    key: `topic-${i}`,
    title: `Topic ${i}`,
    body: `What the founder said about topic ${i}.`,
  })),
});

describe("semantic update limits", () => {
  it("keeps the conversation defaults when no limits are given", async () => {
    const { applied, rejected } = await applySemanticProposal({
      scope: SCOPE,
      store: new InMemorySemanticBlockStore(),
      proposal: creates(3),
      interaction,
    });

    expect(applied).toHaveLength(2);
    expect(rejected.map((operation) => operation.reason)).toEqual(["too_many_creates"]);
    expect(semanticProposalSchema.safeParse(creates(5)).success).toBe(false);
  });

  it("lets a caller that asks for more room create more topics at once", async () => {
    const proposal = createSemanticProposalSchema(6).parse(creates(5));

    const { applied, rejected } = await applySemanticProposal({
      scope: SCOPE,
      store: new InMemorySemanticBlockStore(),
      proposal,
      interaction,
      limits: { maxOperations: 6, maxCreates: 6 },
    });

    expect(applied).toHaveLength(5);
    expect(rejected).toEqual([]);
  });
});
