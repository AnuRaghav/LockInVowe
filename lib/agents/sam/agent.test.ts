import { ToolMessage } from "@langchain/core/messages";
import { FakeToolCallingModel } from "langchain";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createSamModel = vi.fn();

vi.mock("@/lib/agents/sam/model", () => ({ createSamModel }));

const { runSamAgent } = await import("@/lib/agents/sam/agent");

describe("runSamAgent", () => {
  beforeEach(() => {
    createSamModel.mockReset();
  });

  it("routes a runway question through the tool and returns the deterministic result", async () => {
    createSamModel.mockReturnValue(
      new FakeToolCallingModel({
        toolCalls: [
          [
            {
              name: "calculate_runway",
              args: {
                cashOnHandUsd: 600_000,
                monthlyRevenueUsd: 20_000,
                monthlyExpensesUsd: 70_000,
              },
              id: "call_1",
            },
          ],
          [],
        ],
      })
    );

    const result = await runSamAgent({
      messages: "We have $600k, $20k MRR, $70k monthly spend. How long do we have?",
    });

    expect(result.toolCalls).toEqual([
      {
        name: "calculate_runway",
        args: {
          cashOnHandUsd: 600_000,
          monthlyRevenueUsd: 20_000,
          monthlyExpensesUsd: 70_000,
        },
      },
    ]);

    const toolMessage = result.messages.find(
      (message): message is ToolMessage => message instanceof ToolMessage
    );
    expect(toolMessage).toBeDefined();
    expect(JSON.parse(toolMessage!.text)).toMatchObject({
      netMonthlyBurnUsd: 50_000,
      runwayMonths: 12,
      status: "healthy",
    });
  });

  it("answers without calling a tool when no calculation is needed", async () => {
    createSamModel.mockReturnValue(new FakeToolCallingModel({ toolCalls: [[]] }));

    const result = await runSamAgent({ messages: "Who are you?" });

    expect(result.toolCalls).toEqual([]);
    expect(result.text).toEqual(expect.any(String));
  });
});
