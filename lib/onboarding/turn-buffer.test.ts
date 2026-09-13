import { beforeEach, describe, expect, it } from "vitest";

import { InMemoryCommunicationContractStore } from "@/lib/founder/in-memory";
import { questionEntryKey } from "@/lib/onboarding/checklist";
import { InMemoryOnboardingSessionStore } from "@/lib/onboarding/in-memory";
import { createTurnBuffer } from "@/lib/onboarding/turn-buffer";

const SCOPE = { founderId: "founder-a", companyId: "company-a" };
const at = "2026-09-14T09:00:00Z";

describe("turn buffer", () => {
  let sessions: InMemoryOnboardingSessionStore;
  let contracts: InMemoryCommunicationContractStore;
  let written: string[];
  let assumptions: Map<string, unknown>;

  beforeEach(() => {
    sessions = new InMemoryOnboardingSessionStore();
    contracts = new InMemoryCommunicationContractStore();
    written = [];
    assumptions = new Map();
  });

  const buffer = () =>
    createTurnBuffer({
      sessions: {
        start: (scope) => sessions.start(scope),
        getCurrent: (scope) => sessions.getCurrent(scope),
        record: (scope, id, progress) => {
          written.push("checklist");
          return sessions.record(scope, id, progress);
        },
        finish: (scope, id, status) => sessions.finish(scope, id, status),
      },
      contracts: {
        getCurrent: (scope) => contracts.getCurrent(scope),
        getHistory: (scope, query) => contracts.getHistory(scope, query),
        revise: (scope, input) => {
          written.push("contract");
          return contracts.revise(scope, input);
        },
      },
      assumptions: {
        set: async (_companyId, key, value) => {
          written.push("assumption");
          assumptions.set(key, value);
        },
      },
      companies: { saveProfile: async () => void written.push("profile") },
    });

  it("lets a turn see its own writes while keeping them out of the real stores", async () => {
    const session = await sessions.start(SCOPE);
    const turn = buffer();

    await turn.stores.sessions.record(SCOPE, session.id, {
      checklist: { [questionEntryKey("what-you-sell")]: { state: "answered", at } },
      openItems: { "gross-margin": { state: "unsure", at } },
    });
    await turn.stores.contracts.revise({ founderId: SCOPE.founderId }, { patch: { badNews: "lead_with_it" } });
    await turn.stores.assumptions.set(SCOPE.companyId, "gross_margin_pct", 72);

    const staged = await turn.stores.sessions.getCurrent(SCOPE);
    expect(staged?.checklist).toHaveProperty(questionEntryKey("what-you-sell"));
    expect((await turn.stores.contracts.getCurrent({ founderId: SCOPE.founderId }))?.badNews).toBe("lead_with_it");

    expect((await sessions.getCurrent(SCOPE))?.checklist).toEqual({});
    expect(await contracts.getCurrent({ founderId: SCOPE.founderId })).toBeNull();
    expect(written).toEqual([]);
    expect(turn.hasChanges()).toBe(true);
  });

  it("commits everything, with the checklist last", async () => {
    const session = await sessions.start(SCOPE);
    const turn = buffer();

    await turn.stores.sessions.record(SCOPE, session.id, {
      checklist: { [questionEntryKey("gross-margin")]: { state: "answered", at } },
    });
    await turn.stores.assumptions.set(SCOPE.companyId, "gross_margin_pct", 70);
    await turn.stores.assumptions.set(SCOPE.companyId, "gross_margin_pct", 72);
    await turn.stores.companies.saveProfile(SCOPE.companyId, { name: "Clinicly" });
    await turn.stores.contracts.revise({ founderId: SCOPE.founderId }, { patch: { detail: "headline" } });

    await turn.commit(SCOPE, session.id);

    expect(written).toEqual(["assumption", "profile", "contract", "checklist"]);
    expect(assumptions.get("gross_margin_pct")).toBe(72);
    expect((await sessions.getCurrent(SCOPE))?.checklist).toHaveProperty(questionEntryKey("gross-margin"));
  });

  it("refuses transcript writes and finishing during a turn", async () => {
    const session = await sessions.start(SCOPE);
    const turn = buffer();

    await expect(
      turn.stores.sessions.record(SCOPE, session.id, { messages: [{ role: "founder", text: "hi", at }] })
    ).rejects.toThrow("Transcript");
    await expect(turn.stores.sessions.finish(SCOPE, session.id, "completed")).rejects.toThrow();
    expect(turn.hasChanges()).toBe(false);
  });
});
