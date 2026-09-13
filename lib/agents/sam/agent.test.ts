import { ToolMessage } from "@langchain/core/messages";
import { FakeToolCallingModel } from "langchain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testFinancialSession } from "@/lib/finance/testing";

const createSamModel = vi.fn();

vi.mock("@/lib/agents/sam/model", () => ({ createSamModel }));

const { runSamAgent } = await import("@/lib/agents/sam/agent");
const { createSamContextBuilder } = await import("@/lib/agents/sam/context-builder");
const { createSeededPersistentMemory } = await import("@/lib/memory/seed");
const { InMemoryThreadMemory } = await import("@/lib/memory/in-memory");

const COMPANY_ID = "company_test_1";
const TEST_CONTEXT = { companyId: COMPANY_ID, financials: testFinancialSession(COMPANY_ID) };

/** A run wired to seeded company memory, as the application wires it in production. */
const withMemory = (overrides: { maxDirectoryEntries?: number; threadId?: string } = {}) => {
  const persistentMemory = createSeededPersistentMemory(COMPANY_ID);

  return {
    context: { companyId: COMPANY_ID, threadId: overrides.threadId, persistentMemory, financials: testFinancialSession(COMPANY_ID) },
    contextBuilder: createSamContextBuilder({
      persistentMemory,
      threadMemory: new InMemoryThreadMemory(),
      maxDirectoryEntries: overrides.maxDirectoryEntries,
      loadBrief: async () => null,
      loadOperating: async () => null,
    }),
  };
};

const runwayCall = {
  name: "financial_burn_runway",
  args: { currency: "USD", trailingMonths: 3 },
  id: "call_1",
};

const toolPayload = (messages: Awaited<ReturnType<typeof runSamAgent>>["messages"]) => {
  const toolMessage = messages.find(
    (message): message is ToolMessage => message instanceof ToolMessage
  );
  expect(toolMessage).toBeDefined();
  return JSON.parse(toolMessage!.text) as { ok: boolean; data?: unknown; error?: string };
};

describe("runSamAgent", () => {
  beforeEach(() => {
    createSamModel.mockReset();
  });

  it("routes a runway question through the tool and returns the deterministic result", async () => {
    createSamModel.mockReturnValue(
      new FakeToolCallingModel({ toolCalls: [[runwayCall], []] })
    );

    const result = await runSamAgent({
      messages: "We have $600k, $20k MRR, $70k monthly spend. How long do we have?",
      context: TEST_CONTEXT,
    });

    expect(result.toolCalls).toEqual([
      { name: runwayCall.name, args: runwayCall.args },
    ]);

    expect(toolPayload(result.messages)).toMatchObject({
      ok: true,
      data: {
        cash: { minor: 876138, display: "USD 8761.38" },
        runway: { months: null, status: "unavailable" },
      },
    });
  });

  it("injects the trusted company context into the tool instead of taking it from the model", async () => {
    createSamModel.mockReturnValue(
      new FakeToolCallingModel({ toolCalls: [[runwayCall], []] })
    );

    const result = await runSamAgent({
      messages: "How long do we have?",
      context: TEST_CONTEXT,
    });

    // The model never sent a companyId...
    expect(result.toolCalls[0].args).not.toHaveProperty("companyId");
    // ...yet the tool ran against the one the caller supplied.
    expect(toolPayload(result.messages)).toMatchObject({
      ok: true,
      data: { companyId: TEST_CONTEXT.companyId },
    });
  });

  it("rejects a run with no company context", async () => {
    createSamModel.mockReturnValue(new FakeToolCallingModel({ toolCalls: [[]] }));

    await expect(
      runSamAgent({
        messages: "Who are you?",
        context: { companyId: "" },
      })
    ).rejects.toThrow();
  });

  it("answers without calling a tool when no calculation is needed", async () => {
    createSamModel.mockReturnValue(new FakeToolCallingModel({ toolCalls: [[]] }));

    const result = await runSamAgent({
      messages: "Who are you?",
      context: TEST_CONTEXT,
    });

    expect(result.toolCalls).toEqual([]);
    expect(result.text).toEqual(expect.any(String));
  });

  it("opens the run knowing which topics exist, without their bodies", async () => {
    createSamModel.mockReturnValue(new FakeToolCallingModel({ toolCalls: [[]] }));

    const result = await runSamAgent({
      messages: "Should we hire a senior engineer?",
      ...withMemory(),
    });

    // The directory listed it...
    expect(result.initialContext.directory?.entries.map((entry) => entry.id)).toContain(
      "mem_runway_floor"
    );
    // ...and reached the model as a retrievable id. (The fake echoes its input.)
    expect(result.text).toContain("COMPANY KNOWLEDGE DIRECTORY");
    expect(result.text).toContain("mem_runway_floor");
    // ...as an id it can pass to get_memory, alongside the instruction to do so.
    expect(result.text).toContain("call get_memory with an id");
  });

  it("discovers memory mid-loop that the initial context did not include", async () => {
    const searchCall = {
      name: "search_memory",
      args: { query: "fundraising plans" },
      id: "call_memory_1",
    };
    createSamModel.mockReturnValue(
      new FakeToolCallingModel({ toolCalls: [[searchCall], []] })
    );

    const result = await runSamAgent({
      messages: "How much cash do we need to get to our next milestone?",
      // A directory clipped to one entry, so the raise plan is genuinely not
      // listed and the tool is the only way to it.
      ...withMemory({ maxDirectoryEntries: 1 }),
    });

    expect(result.initialContext.directory?.entries.map((entry) => entry.id)).not.toContain(
      "mem_raise_march"
    );
    expect(result.toolCalls).toEqual([{ name: searchCall.name, args: searchCall.args }]);

    const payload = toolPayload(result.messages) as {
      ok: boolean;
      data?: { topics?: Array<{ id: string; content: string }> };
    };
    expect(payload.ok).toBe(true);
    expect(payload.data?.topics?.[0]).toMatchObject({
      id: "mem_raise_march",
      content: expect.stringContaining("March"),
    });
  });

  it("reaches the same company knowledge from a different thread", async () => {
    const searchCall = {
      name: "search_memory",
      args: { query: "when are we raising" },
      id: "call_memory_2",
    };

    const idsFor = async (threadId: string) => {
      createSamModel.mockReturnValue(
        new FakeToolCallingModel({ toolCalls: [[searchCall], []] })
      );
      const result = await runSamAgent({
        messages: "Remind me what the plan is.",
        ...withMemory({ threadId }),
      });
      const payload = toolPayload(result.messages) as {
        data?: { topics?: Array<{ id: string }> };
      };
      return payload.data?.topics?.map((topic) => topic.id) ?? [];
    };

    expect(await idsFor("thread_a")).toContain("mem_raise_march");
    expect(await idsFor("thread_b")).toContain("mem_raise_march");
  });
});
