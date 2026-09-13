import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authenticated: true,
  runOnboardingTurn: vi.fn(),
  getCurrent: vi.fn(),
}));

vi.mock("@/lib/company/context", () => ({
  resolveCompanyContext: async () => {
    if (!state.authenticated) throw new Error("Not signed in.");
    return { companyId: "trusted-company", founderId: "trusted-founder" };
  },
}));
vi.mock("@/lib/onboarding/interview", () => ({ runOnboardingTurn: state.runOnboardingTurn }));
vi.mock("@/lib/onboarding/sessions", () => ({
  createOnboardingSessionStore: () => ({ getCurrent: state.getCurrent }),
}));

const { GET, POST } = await import("./route");

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/onboarding/interview", { method: "POST", body: JSON.stringify(body) }));

const turn = (overrides: Record<string, unknown> = {}) => ({
  sessionId: "session-1",
  outcome: "completed",
  ok: true,
  reply: "What do you sell, and to whom?",
  currentSection: "company-basics",
  completedSections: [],
  onboardingComplete: false,
  extractions: [],
  choices: null,
  ...overrides,
});

describe("onboarding interview route", () => {
  beforeEach(() => {
    state.authenticated = true;
    state.runOnboardingTurn.mockReset();
    state.getCurrent.mockReset().mockResolvedValue(null);
  });

  it("requires a signed-in founder", async () => {
    state.authenticated = false;

    expect((await GET(new Request("http://localhost/api/onboarding/interview"))).status).toBe(401);
    expect((await post({ message: "hi" })).status).toBe(401);
    expect(state.runOnboardingTurn).not.toHaveBeenCalled();
  });

  it("describes an interview that has not started", async () => {
    const response = await GET(new Request("http://localhost/api/onboarding/interview"));

    expect(await response.json()).toMatchObject({
      sessionId: null,
      currentSection: "company-basics",
      onboardingComplete: false,
      transcript: [],
    });
  });

  it("rejects a message that is not text or is too long", async () => {
    expect((await post({ message: 42 })).status).toBe(400);
    expect((await post({ message: "x".repeat(4001) })).status).toBe(400);
    expect(state.runOnboardingTurn).not.toHaveBeenCalled();
  });

  it("runs the turn for the authenticated founder, whatever the body claims", async () => {
    state.runOnboardingTurn.mockResolvedValue(turn());

    const response = await post({ message: "We sell to clinics.", founderId: "someone-else", companyId: "other" });

    expect(response.status).toBe(200);
    expect(state.runOnboardingTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: { companyId: "trusted-company", founderId: "trusted-founder" },
        message: "We sell to clinics.",
      })
    );
    expect(await response.json()).toMatchObject({ ok: true, reply: "What do you sell, and to whom?", interview: { sessionId: null } });
  });

  it("opens the interview when no message is sent", async () => {
    state.runOnboardingTurn.mockResolvedValue(turn());

    await post({});

    expect(state.runOnboardingTurn).toHaveBeenCalledWith(expect.objectContaining({ message: undefined }));
  });

  it("tells the founder to try again when Sam could not reply", async () => {
    state.runOnboardingTurn.mockResolvedValue(turn({ ok: false, outcome: "timeout", reply: "" }));

    const body = await (await post({ message: "Hello?" })).json();

    expect(body).toMatchObject({ ok: false, error: expect.stringContaining("Try sending that again") });
  });
});
