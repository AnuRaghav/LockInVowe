import { describe, expect, it, vi, beforeEach } from "vitest";

const semantic = vi.hoisted(() => vi.fn(async () => ({
  status: "unchanged",
  interactionId: "interaction-1",
  consideredKeys: [],
  applied: [],
  rejected: [],
})));

vi.mock("@/lib/semantic/update", () => ({ updateSemanticState: semantic }));

const {
  buildSemanticInteractionForCompletedTurn,
  updateSemanticMemoryAfterCompletedTurn,
} = await import("./semantic-updates");

beforeEach(() => {
  semantic.mockClear();
  semantic.mockResolvedValue({
    status: "unchanged",
    interactionId: "interaction-1",
    consideredKeys: [],
    applied: [],
    rejected: [],
  });
});

describe("semantic updates from conversations", () => {
  it("passes only the immediately relevant exchange plus the completed answer", () => {
    const interaction = buildSemanticInteractionForCompletedTurn({
      run: { id: "run-2", threadId: "thread-1", startedAt: "2026-09-13T10:00:00Z" },
      assistantText: "Understood — hiring is frozen until the raise closes.",
      messages: [
        { role: "user", content: "What's the current hiring plan?" },
        { role: "assistant", content: "You were considering two platform hires." },
        { role: "user", content: "Actually freeze hiring until the raise closes." },
      ],
    });

    expect(interaction).toMatchObject({
      externalKey: "conversation-run:run-2",
      source: "conversation",
      threadId: "thread-1",
      runId: "run-2",
      occurredAt: "2026-09-13T10:00:00Z",
    });
    expect(interaction.messages).toEqual([
      { role: "founder", text: "What's the current hiring plan?" },
      { role: "sam", text: "You were considering two platform hires." },
      { role: "founder", text: "Actually freeze hiring until the raise closes." },
      { role: "sam", text: "Understood — hiring is frozen until the raise closes." },
    ]);
  });

  it("uses the run id as the idempotency key when calling the existing updater", async () => {
    await updateSemanticMemoryAfterCompletedTurn({
      companyId: "company-1",
      run: { id: "run-1", threadId: "thread-1", startedAt: "2026-09-13T10:00:00Z" },
      assistantText: "Done.",
      messages: [{ role: "user", content: "We're targeting an $8M Series A." }],
    });

    expect(semantic).toHaveBeenCalledWith({
      scope: { companyId: "company-1" },
      interaction: expect.objectContaining({
        externalKey: "conversation-run:run-1",
        runId: "run-1",
        threadId: "thread-1",
      }),
    });
  });

  it("logs and swallows updater exceptions", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    semantic.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(updateSemanticMemoryAfterCompletedTurn({
      companyId: "company-1",
      run: { id: "run-1", threadId: "thread-1", startedAt: "2026-09-13T10:00:00Z" },
      assistantText: "Done.",
      messages: [{ role: "user", content: "Freeze hiring." }],
    })).resolves.toBeNull();

    expect(spy).toHaveBeenCalledWith("semantic memory update failed", expect.objectContaining({
      companyId: "company-1",
      threadId: "thread-1",
      runId: "run-1",
      error: expect.any(Error),
    }));
    spy.mockRestore();
  });
});
