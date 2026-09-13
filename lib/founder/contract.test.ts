import { describe, expect, it } from "vitest";

import { applyContractPatch, contractPatchSchema } from "@/lib/founder/contract";
import { InMemoryCommunicationContractStore } from "@/lib/founder/in-memory";

const FOUNDER = { founderId: "founder-a" };

describe("communication contract patches", () => {
  it("refuses an empty patch", () => {
    expect(contractPatchSchema.safeParse({}).success).toBe(false);
  });

  it("refuses fields and values the contract does not have", () => {
    expect(contractPatchSchema.safeParse({ tone: "warm" }).success).toBe(false);
    expect(contractPatchSchema.safeParse({ badNews: "never" }).success).toBe(false);
    expect(
      contractPatchSchema.safeParse({ alerts: [{ metric: "vibes", direction: "below", threshold: 1 }] }).success
    ).toBe(false);
  });

  it("accepts a known alert", () => {
    expect(
      contractPatchSchema.safeParse({
        alerts: [{ metric: "runway_months", direction: "below", threshold: 9 }],
      }).success
    ).toBe(true);
  });

  it("replaces present keys, clears nulls, and leaves absent keys alone", () => {
    const previous = applyContractPatch(null, {
      badNews: "lead_with_it",
      detail: "show_work",
      alerts: [{ metric: "runway_months", direction: "below", threshold: 9 }],
    });

    expect(applyContractPatch(previous, { detail: null, pushback: "challenge_hard" })).toEqual({
      badNews: "lead_with_it",
      pushback: "challenge_hard",
      alerts: [{ metric: "runway_months", direction: "below", threshold: 9 }],
    });

    expect(applyContractPatch(previous, { alerts: null }).alerts).toEqual([]);
  });
});

describe("communication contract store", () => {
  it("records each change as a new revision of the whole contract", async () => {
    const store = new InMemoryCommunicationContractStore();

    expect(await store.getCurrent(FOUNDER)).toBeNull();

    const first = await store.revise(FOUNDER, { patch: { badNews: "news_with_options" } });
    expect(first).toMatchObject({ revision: 1, changeKind: "created", badNews: "news_with_options", alerts: [] });

    const second = await store.revise(FOUNDER, {
      patch: { recommendations: "tell_me_what_to_do" },
      provenance: { kind: "onboarding" },
    });
    expect(second).toMatchObject({
      revision: 2,
      changeKind: "revised",
      badNews: "news_with_options",
      recommendations: "tell_me_what_to_do",
    });

    const corrected = await store.revise(FOUNDER, {
      patch: { badNews: null },
      changeKind: "corrected",
      changeNote: "Misread during playback.",
    });
    expect(corrected.badNews).toBeUndefined();
    expect(corrected.changeKind).toBe("corrected");

    const history = await store.getHistory(FOUNDER);
    expect(history.map((contract) => contract.revision)).toEqual([3, 2, 1]);
    expect(await store.getCurrent({ founderId: "founder-b" })).toBeNull();
  });

  it("rejects an invalid patch before writing anything", async () => {
    const store = new InMemoryCommunicationContractStore();

    await expect(store.revise(FOUNDER, { patch: {} })).rejects.toThrow();
    expect(await store.getHistory(FOUNDER)).toEqual([]);
  });
});
