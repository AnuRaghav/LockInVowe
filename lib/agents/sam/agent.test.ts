import { ToolMessage } from "@langchain/core/messages";
import { FakeToolCallingModel } from "langchain";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createSamModel = vi.fn();

vi.mock("@/lib/agents/sam/model", () => ({ createSamModel }));

const { runSamAgent } = await import("@/lib/agents/sam/agent");

const TEST_CONTEXT = { companyId: "company_test_1" };

const runwayCall = {
  name: "calculate_runway",
  args: {
    cashOnHandUsd: 600_000,
    monthlyRevenueUsd: 20_000,
    monthlyExpensesUsd: 70_000,
  },
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
        netMonthlyBurnUsd: 50_000,
        runwayMonths: 12,
        status: "healthy",
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
});
