import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import type { ChatResult } from "@langchain/core/outputs";
import { FakeToolCallingModel } from "langchain";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SamRunEvent } from "@/lib/agents/sam/harness/events";

const createSamModel = vi.fn();
vi.mock("@/lib/agents/sam/model", () => ({ createSamModel }));

const { runSamAgent, runSamAgentStructured } = await import("@/lib/agents/sam/agent");
const { streamSamAgent } = await import("@/lib/agents/sam/stream");

const COMPANY_ID = "company_stream_1";
const CONTEXT = { companyId: COMPANY_ID };

const runwayCall = (id: string, cash = 600_000) => ({
  name: "calculate_runway",
  args: {
    cashOnHandUsd: cash,
    monthlyRevenueUsd: 20_000,
    monthlyExpensesUsd: 70_000,
  },
  id,
});

/** A model that can take its time, so cancellation and deadlines are reachable. */
class ScriptedModel extends FakeToolCallingModel {
  private delayMs: number;

  constructor(
    fields: ConstructorParameters<typeof FakeToolCallingModel>[0] & {
      delayMs?: number;
    } = {}
  ) {
    const { delayMs = 0, ...rest } = fields;
    super(rest);
    this.delayMs = delayMs;
  }

  bindTools(): this {
    return this;
  }

  async _generate(
    messages: BaseMessage[],
    options?: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    return super._generate(messages, options, runManager);
  }
}

/** Replies the way Claude does with adaptive thinking on: reasoning, then text. */
class ThinkingModel extends FakeToolCallingModel {
  bindTools(): this {
    return this;
  }

  async _generate(): Promise<ChatResult> {
    const message = new AIMessage({
      content: [
        { type: "thinking", thinking: "SECRET-SCRATCHPAD: the founder is overspending." },
        { type: "redacted_thinking", data: "SECRET-REDACTED" },
        { type: "text", text: "You have twelve months of runway." },
      ],
      id: "thinking_1",
    });

    return {
      generations: [{ text: "You have twelve months of runway.", message }],
      llmOutput: {},
    };
  }
}

const collect = async (
  input: Parameters<typeof streamSamAgent>[0]
): Promise<{ events: SamRunEvent[]; result: Awaited<ReturnType<typeof runSamAgent>> }> => {
  const stream = streamSamAgent(input);
  const events: SamRunEvent[] = [];

  let next = await stream.next();
  while (!next.done) {
    events.push(next.value);
    next = await stream.next();
  }

  return { events, result: next.value };
};

const typesOf = (events: SamRunEvent[]): string[] => events.map((event) => event.type);

const deltaText = (events: SamRunEvent[]): string =>
  events
    .filter((event): event is Extract<SamRunEvent, { type: "message_delta" }> =>
      event.type === "message_delta"
    )
    .map((event) => event.text)
    .join("");

describe("streamSamAgent", () => {
  beforeEach(() => {
    createSamModel.mockReset();
  });

  describe("event ordering", () => {
    it("reports a model -> tool -> model run in causal order", async () => {
      createSamModel.mockReturnValue(
        new ScriptedModel({ toolCalls: [[runwayCall("c1")], []] })
      );

      const { events, result } = await collect({
        messages: "What's our runway?",
        context: CONTEXT,
      });

      const types = typesOf(events);
      expect(types[0]).toBe("run_started");
      expect(types[1]).toBe("context_built");
      expect(types.at(-1)).toBe("run_completed");

      // The lifecycle of the tool call sits between two model calls.
      const order = types.filter((type) => type !== "message_delta");
      expect(order).toEqual([
        "run_started",
        "context_built",
        "model_started",
        "model_completed",
        "tool_started",
        "tool_completed",
        "model_started",
        "model_completed",
        "run_completed",
      ]);

      // Sequence numbers give a total order independent of delivery.
      expect(events.map((event) => event.seq)).toEqual(
        events.map((_, index) => index)
      );
      expect(new Set(events.map((event) => event.runId))).toEqual(
        new Set([result.run.runId])
      );
    });

    it("describes each tool call in words a UI can show", async () => {
      createSamModel.mockReturnValue(
        new ScriptedModel({ toolCalls: [[runwayCall("c1")], []] })
      );

      const { events } = await collect({
        messages: "What's our runway?",
        context: CONTEXT,
      });

      const started = events.find((event) => event.type === "tool_started");
      expect(started).toMatchObject({
        name: "calculate_runway",
        kind: "calculation",
        label: "Calculating runway",
      });

      const completed = events.find((event) => event.type === "tool_completed");
      // The declared, sanitized summary - a verdict, not the company's numbers.
      expect(completed).toMatchObject({
        name: "calculate_runway",
        summary: "status: healthy",
      });
      expect(completed).toHaveProperty("durationMs");
    });
  });

  describe("parity with runSamAgent", () => {
    it("produces the same answer and tool calls as the non-streaming path", async () => {
      const script = () =>
        new ScriptedModel({ toolCalls: [[runwayCall("c1")], []] });

      createSamModel.mockReturnValue(script());
      const direct = await runSamAgent({
        messages: "What's our runway?",
        context: CONTEXT,
      });

      createSamModel.mockReturnValue(script());
      const { events, result } = await collect({
        messages: "What's our runway?",
        context: CONTEXT,
      });

      expect(result.outcome).toBe(direct.outcome);
      expect(result.text).toBe(direct.text);
      expect(result.toolCalls).toEqual(direct.toolCalls);
      expect(result.run.toolNames).toEqual(direct.run.toolNames);
      expect(result.run.modelCallCount).toBe(direct.run.modelCallCount);

      // The terminal event says the same thing the returned result does.
      const terminal = events.at(-1);
      expect(terminal).toMatchObject({
        type: "run_completed",
        outcome: "completed",
        text: direct.text,
      });

      // The streamed text ends with the answer the caller would have received.
      expect(deltaText(events).endsWith(direct.text)).toBe(true);
    });

    it("leaves the structured, non-streaming path unchanged", async () => {
      createSamModel.mockReturnValue(
        new ScriptedModel({ toolCalls: [[runwayCall("c1")], []] })
      );

      const result = await runSamAgentStructured({
        messages: "What's our runway?",
        context: CONTEXT,
      });

      // The fake model does not implement provider structured output, so this
      // asserts the path itself: same loop, same harness, same result shape,
      // falling back to the final message when no typed answer was produced.
      expect(result.outcome).toBe("completed");
      expect(result.run.toolNames).toEqual(["calculate_runway"]);
      expect(result.text).toEqual(expect.any(String));
    });
  });

  describe("privacy", () => {
    it("never streams private reasoning, only the visible reply", async () => {
      createSamModel.mockReturnValue(new ThinkingModel());

      const { events, result } = await collect({
        messages: "What's our runway?",
        context: CONTEXT,
      });

      const serialised = JSON.stringify(events);
      expect(serialised).not.toContain("SECRET-SCRATCHPAD");
      expect(serialised).not.toContain("SECRET-REDACTED");
      expect(serialised).not.toContain("thinking");

      expect(deltaText(events)).toBe("You have twelve months of runway.");
      expect(result.outcome).toBe("completed");
    });

    it("never streams a raw tool payload in a tool event", async () => {
      createSamModel.mockReturnValue(
        new ScriptedModel({ toolCalls: [[runwayCall("c1")], []] })
      );

      const { events } = await collect({
        messages: "What's our runway?",
        context: CONTEXT,
      });

      // Sam's own reply may of course quote the figures it was asked for; the
      // guarantee is about the lifecycle events, which describe a tool call
      // without carrying what went into or came out of it.
      const lifecycle = JSON.stringify(
        events.filter(
          (event) =>
            event.type !== "message_delta" && event.type !== "run_completed"
        )
      );

      // Neither the arguments the model chose...
      expect(lifecycle).not.toContain("600000");
      // ...nor the figures the tool produced.
      expect(lifecycle).not.toContain("netMonthlyBurnUsd");
      expect(lifecycle).not.toContain("zeroCashDate");
      // Only the declared summary.
      expect(lifecycle).toContain("status: healthy");
    });
  });

  describe("failures and termination", () => {
    it("emits a tool failure with safe metadata and keeps the run going", async () => {
      createSamModel.mockReturnValue(
        new ScriptedModel({
          toolCalls: [[{ name: "get_memory", args: { id: "mem_missing" }, id: "g1" }], []],
        })
      );

      const { events, result } = await collect({
        messages: "Read me that note.",
        context: CONTEXT,
      });

      const failed = events.find((event) => event.type === "tool_failed");
      expect(failed).toMatchObject({
        type: "tool_failed",
        name: "get_memory",
        kind: "read_only",
        // A retrieval that found nothing does not invalidate the answer.
        critical: false,
      });
      expect(failed).toHaveProperty("durationMs");
      expect(typesOf(events)).not.toContain("tool_completed");

      // Read-only retrieval is optional, so the run still finishes - degraded.
      expect(result.outcome).toBe("completed");
      expect(result.degraded).toBe(true);
    });

    it("surfaces a budget stop as a termination, not an answer", async () => {
      createSamModel.mockReturnValue(
        new ScriptedModel({
          toolCalls: [
            [runwayCall("b1", 100_000)],
            [runwayCall("b2", 200_000)],
            [runwayCall("b3", 300_000)],
          ],
        })
      );

      const { events, result } = await collect({
        messages: "Keep going.",
        context: CONTEXT,
        policy: { maxModelCalls: 2, maxToolCalls: 50, maxRepeatedToolCalls: 50 },
      });

      const terminal = events.at(-1);
      expect(terminal).toMatchObject({
        type: "run_terminated",
        outcome: "max_model_calls",
      });
      expect(typesOf(events)).not.toContain("run_completed");
      expect(result.ok).toBe(false);
      expect(result.run.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("surfaces a deadline as a timeout termination", async () => {
      createSamModel.mockReturnValue(
        new ScriptedModel({ toolCalls: [[]], delayMs: 80 })
      );

      const { events, result } = await collect({
        messages: "Take your time.",
        context: CONTEXT,
        policy: { runDeadlineMs: 20, maxModelRetries: 0 },
      });

      expect(events.at(-1)).toMatchObject({
        type: "run_terminated",
        outcome: "timeout",
      });
      expect(result.outcome).toBe("timeout");
    });
  });

  describe("cancellation", () => {
    it("stops the run when the consumer walks away", async () => {
      createSamModel.mockReturnValue(
        new ScriptedModel({ toolCalls: [[runwayCall("c1")], []], delayMs: 40 })
      );

      const seen: SamRunEvent[] = [];
      const stream = streamSamAgent({
        messages: "Never mind.",
        context: CONTEXT,
        policy: { maxModelRetries: 0 },
        observer: { record: (event) => seen.push(event) },
      });

      for await (const event of stream) {
        // Walk away as soon as Sam starts thinking.
        if (event.type === "model_started") break;
      }

      // Abandoning the iterator cancelled the run through the harness.
      const terminal = seen.at(-1);
      expect(terminal).toMatchObject({
        type: "run_terminated",
        outcome: "cancelled",
      });
      expect(typesOf(seen)).not.toContain("run_completed");
    });

    it("stops the run when the caller's signal aborts", async () => {
      createSamModel.mockReturnValue(
        new ScriptedModel({ toolCalls: [[]], delayMs: 60 })
      );

      const controller = new AbortController();
      const pending = collect({
        messages: "Never mind.",
        context: CONTEXT,
        signal: controller.signal,
        policy: { maxModelRetries: 0 },
      });
      controller.abort();

      const { events, result } = await pending;
      expect(result.outcome).toBe("cancelled");
      expect(events.at(-1)).toMatchObject({ type: "run_terminated", outcome: "cancelled" });
    });
  });
});
