import { describe, expect, it } from "vitest";

import { InMemoryOnboardingSessionStore } from "@/lib/onboarding/in-memory";
import {
  OnboardingSessionNotFoundError,
  redactOnboardingMessage,
  type OnboardingMessage,
} from "@/lib/onboarding/sessions";

const SCOPE = { founderId: "founder-a", companyId: "company-a" };

const at = "2026-09-14T09:00:00Z";

describe("onboarding transcript redaction", () => {
  it("keeps ordinary turns verbatim", () => {
    const message: OnboardingMessage = { role: "founder", text: "We sell payroll software to clinics.", sectionId: "company", at };
    expect(redactOnboardingMessage(message)).toEqual(message);
  });

  it("drops the text of a sensitive turn and records only that it happened", () => {
    const stored = redactOnboardingMessage({
      role: "founder",
      text: "I pay myself $60K and have about 8 months of savings.",
      sectionId: "personal",
      sensitive: true,
      at,
    });

    expect(stored).toEqual({ role: "founder", sectionId: "personal", at, sensitive: true, redacted: true });
    expect(JSON.stringify(stored)).not.toContain("60K");
  });
});

describe("onboarding session store", () => {
  it("resumes the in-progress session instead of starting another", async () => {
    const store = new InMemoryOnboardingSessionStore();

    const first = await store.start(SCOPE);
    const again = await store.start(SCOPE);
    expect(again.id).toBe(first.id);

    const otherCompany = await store.start({ ...SCOPE, companyId: "company-b" });
    expect(otherCompany.id).not.toBe(first.id);
  });

  it("appends turns and merges progress without storing sensitive text", async () => {
    const store = new InMemoryOnboardingSessionStore();
    const session = await store.start(SCOPE);

    await store.record(SCOPE, session.id, {
      messages: [
        { role: "sam", text: "What do you sell, and to whom?", sectionId: "company", at },
        { role: "founder", text: "Scheduling software for clinics.", sectionId: "company", at },
      ],
      checklist: { "company.what-you-sell": { state: "answered" } },
    });

    const updated = await store.record(SCOPE, session.id, {
      messages: [{ role: "founder", text: "My salary is $60K.", sectionId: "personal", sensitive: true, at }],
      checklist: { "personal.salary": { state: "answered" } },
      openItems: { "personal.guarantees": { state: "declined", at } },
    });

    expect(updated.transcript).toHaveLength(3);
    expect(JSON.stringify(updated.transcript)).not.toContain("$60K");
    expect(Object.keys(updated.checklist)).toEqual(["company.what-you-sell", "personal.salary"]);
    expect(updated.openItems["personal.guarantees"].state).toBe("declined");
  });

  it("only lets the session's own founder and company advance it", async () => {
    const store = new InMemoryOnboardingSessionStore();
    const session = await store.start(SCOPE);

    await expect(
      store.record({ ...SCOPE, founderId: "founder-b" }, session.id, { checklist: { x: 1 } })
    ).rejects.toThrow(OnboardingSessionNotFoundError);
    await expect(
      store.finish({ ...SCOPE, companyId: "company-b" }, session.id, "completed")
    ).rejects.toThrow(OnboardingSessionNotFoundError);
  });

  it("closes a session, after which it can no longer be advanced", async () => {
    const store = new InMemoryOnboardingSessionStore();
    const session = await store.start(SCOPE);

    const finished = await store.finish(SCOPE, session.id, "completed");
    expect(finished.status).toBe("completed");
    expect(finished.completedAt).toBeDefined();

    expect(await store.getCurrent(SCOPE)).toBeNull();
    await expect(store.record(SCOPE, session.id, { checklist: { x: 1 } })).rejects.toThrow(
      OnboardingSessionNotFoundError
    );
    expect((await store.start(SCOPE)).id).not.toBe(session.id);
  });
});
