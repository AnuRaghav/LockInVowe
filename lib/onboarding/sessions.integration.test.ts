import { beforeAll, describe, expect, it } from "vitest";

import {
  OnboardingSessionNotFoundError,
  createOnboardingSessionStore,
  type OnboardingSessionStore,
} from "@/lib/onboarding/sessions";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Onboarding sessions against real Postgres.
 *
 * Opt-in (`npm run test:integration`). Proves the one-in-progress rule, the
 * atomic merge, and that the database itself refuses unredacted sensitive text.
 */
const enabled = Boolean(process.env.SUPABASE_INTEGRATION);

const SCOPE = {
  founderId: "00000000-0000-4000-8000-0000000000b1",
  companyId: "00000000-0000-4000-8000-0000000000b1",
};
const at = "2026-09-14T09:00:00Z";

describe.skipIf(!enabled)("Onboarding sessions against Postgres", () => {
  const supabase = enabled ? createServiceClient() : (null as never);
  let store: OnboardingSessionStore;

  beforeAll(async () => {
    store = createOnboardingSessionStore(supabase);
    const { error } = await supabase.from("onboarding_sessions").delete().eq("founder_id", SCOPE.founderId);
    if (error) throw error;
  });

  it("gives concurrent starts the same in-progress session", async () => {
    const [a, b] = await Promise.all([store.start(SCOPE), store.start(SCOPE)]);
    expect(a.id).toBe(b.id);
    expect((await store.getCurrent(SCOPE))?.id).toBe(a.id);
  });

  it("merges concurrent progress without losing any of it, and stores no sensitive text", async () => {
    const session = await store.start(SCOPE);

    await Promise.all([
      store.record(SCOPE, session.id, {
        messages: [{ role: "founder", text: "Scheduling software for clinics.", sectionId: "company", at }],
        checklist: { "company.what-you-sell": { state: "answered" } },
      }),
      store.record(SCOPE, session.id, {
        messages: [{ role: "founder", text: "My salary is $60K.", sectionId: "personal", sensitive: true, at }],
        checklist: { "personal.salary": { state: "answered" } },
        openItems: { "personal.guarantees": { state: "declined", at } },
      }),
    ]);

    const current = await store.getCurrent(SCOPE);
    expect(current?.transcript).toHaveLength(2);
    expect(JSON.stringify(current?.transcript)).not.toContain("$60K");
    expect(Object.keys(current!.checklist).sort()).toEqual(["company.what-you-sell", "personal.salary"]);
    expect(current?.openItems["personal.guarantees"]).toEqual({ state: "declined", at });
  });

  it("refuses unredacted sensitive text at the database", async () => {
    const session = await store.start(SCOPE);
    const { error } = await supabase.rpc("onboarding_session_record", {
      p_session_id: session.id,
      p_founder_id: SCOPE.founderId,
      p_messages: [{ role: "founder", text: "My salary is $60K.", sensitive: true }],
    });
    expect(error?.message).toMatch(/must be redacted/);
  });

  it("does not let another founder advance the session", async () => {
    const session = await store.start(SCOPE);
    await expect(
      store.record(
        { founderId: "00000000-0000-4000-8000-0000000000b2", companyId: SCOPE.companyId },
        session.id,
        { checklist: { x: 1 } }
      )
    ).rejects.toThrow(OnboardingSessionNotFoundError);
  });

  it("completes a session and starts fresh afterwards", async () => {
    const session = await store.start(SCOPE);
    const finished = await store.finish(SCOPE, session.id, "completed");

    expect(finished.status).toBe("completed");
    expect(finished.completedAt).toBeDefined();
    await expect(store.finish(SCOPE, session.id, "completed")).rejects.toThrow(OnboardingSessionNotFoundError);
    expect((await store.start(SCOPE)).id).not.toBe(session.id);
  });
});
