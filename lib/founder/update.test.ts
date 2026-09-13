import { beforeEach, describe, expect, it } from "vitest";

import { InMemoryFounderBlockStore } from "@/lib/founder/in-memory";
import { applyFounderProposal, renderFounderProposalRequest } from "@/lib/founder/update";
import type { SemanticProposal } from "@/lib/semantic/update/types";

const SCOPE = { founderId: "founder-a" };
const provenance = { kind: "onboarding", sessionId: "session-1" };

const create = (key: string, body: string): SemanticProposal => ({
  assessment: "Something durable was said.",
  operations: [{ op: "create", key, title: key, body }],
});

describe("applying founder proposals", () => {
  let store: InMemoryFounderBlockStore;

  beforeEach(async () => {
    store = new InMemoryFounderBlockStore();
    await applyFounderProposal({
      scope: SCOPE,
      store,
      proposal: create("risk-and-values", "The founder will not take venture debt."),
      sensitivity: "standard",
      provenance,
      occurredAt: "2026-09-14T09:00:00Z",
    });
  });

  it("writes every change from the personal section as personal", async () => {
    const { applied } = await applyFounderProposal({
      scope: SCOPE,
      store,
      proposal: create("personal-finances", "The founder takes a $60K salary."),
      sensitivity: "personal",
      provenance,
      occurredAt: "2026-09-14T09:10:00Z",
    });

    expect(applied).toHaveLength(1);
    expect(await store.getBlock(SCOPE, { key: "personal-finances" })).toBeNull();
    expect((await store.getBlock(SCOPE, { key: "personal-finances" }, { includePersonal: true }))?.sensitivity).toBe(
      "personal"
    );
  });

  it("will not let a personal answer rewrite a standard topic", async () => {
    const { applied, rejected } = await applyFounderProposal({
      scope: SCOPE,
      store,
      proposal: {
        assessment: "Personal guarantee changes their risk stance.",
        operations: [{ op: "revise", key: "risk-and-values", body: "Personally guaranteed the lease." }],
      },
      sensitivity: "personal",
      provenance,
      occurredAt: "2026-09-14T09:10:00Z",
    });

    expect(applied).toEqual([]);
    expect(rejected.map((operation) => operation.reason)).toEqual(["sensitivity_mismatch"]);
    expect((await store.getBlock(SCOPE, { key: "risk-and-values" }))?.body).toContain("venture debt");
  });

  it("does not revise a topic that already says the same thing", async () => {
    const { rejected } = await applyFounderProposal({
      scope: SCOPE,
      store,
      proposal: create("risk-and-values", "The founder will not take  venture debt."),
      sensitivity: "standard",
      provenance,
      occurredAt: "2026-09-14T09:10:00Z",
    });

    expect(rejected.map((operation) => operation.reason)).toEqual(["no_material_change"]);
  });

  it("refuses a proposal that tries to change too much at once", async () => {
    const { applied, rejected } = await applyFounderProposal({
      scope: SCOPE,
      store,
      proposal: {
        assessment: "Lots.",
        operations: Array.from({ length: 5 }, (_, i) => ({ op: "create" as const, key: `topic-${i}`, title: "T", body: "B" })),
      },
      sensitivity: "standard",
      provenance,
      occurredAt: "2026-09-14T09:10:00Z",
    });

    expect(applied).toEqual([]);
    expect(rejected).toHaveLength(5);
  });

  it("tells the model when it is reading the personal section", () => {
    const request = {
      messages: [{ role: "founder", text: "About eight months." }],
      blocks: [],
      questions: [{ id: "personal-runway", find: "How long they could keep going on their current salary." }],
      now: "2026-09-14T09:00:00Z",
    };

    expect(renderFounderProposalRequest({ ...request, sensitive: true })).toContain("personal section");
    expect(renderFounderProposalRequest({ ...request, sensitive: false })).not.toContain("personal section");
  });
});
