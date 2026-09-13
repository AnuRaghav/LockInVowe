import { ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import type { ChatResult } from "@langchain/core/outputs";
import { tool, type ToolRuntime } from "@langchain/core/tools";
import { FakeToolCallingModel } from "langchain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { samRuntimeContextSchema } from "@/lib/agents/sam/context";

const createSamModel = vi.fn();
vi.mock("@/lib/agents/sam/model", () => ({ createSamModel }));

const { runSamAgent } = await import("@/lib/agents/sam/agent");
const { requireSamContext } = await import("@/lib/agents/sam/context");
const { SAM_TOOLS } = await import("@/lib/agents/sam/tools");
const { SAM_TOOL_POLICIES } = await import("@/lib/agents/sam/tools/policy");
const { createSamContextBuilder } = await import("@/lib/agents/sam/context-builder");
const { createSeededPersistentMemory } = await import("@/lib/memory/seed");
const { InMemoryThreadMemory } = await import("@/lib/memory/in-memory");
const { runTool } = await import("@/lib/agents/sam/tools/result");

type RuntimeOf = ToolRuntime<unknown, typeof samRuntimeContextSchema>;
type SamRunResult = Awaited<ReturnType<typeof runSamAgent>>;

const COMPANY_ID = "company_harness_1";
const CONTEXT = { companyId: COMPANY_ID };

/** Retries are exercised for their behaviour, not their wall-clock backoff. */
const FAST_RETRIES = { retryInitialDelayMs: 1, retryMaxDelayMs: 2 } as const;

const httpError = (message: string, status: number): Error =>
  Object.assign(new Error(message), { status });

const runwayArgs = (cashOnHandUsd: number) => ({
  cashOnHandUsd,
  monthlyRevenueUsd: 20_000,
  monthlyExpensesUsd: 70_000,
});

const runwayCall = (id: string, cash = 600_000) => ({
  name: "calculate_runway",
  args: runwayArgs(cash),
  id,
});

/**
 * A model that can fail on cue and take time doing it.
 *
 * `bindTools` returns itself so the scripted behaviour survives the agent
 * binding its tool schemas.
 */
class ScriptedModel extends FakeToolCallingModel {
  private failures: Array<Error | null>;
  private delayMs: number;
  calls = 0;

  constructor(
    fields: ConstructorParameters<typeof FakeToolCallingModel>[0] & {
      failures?: Array<Error | null>;
      delayMs?: number;
    } = {}
  ) {
    const { failures = [], delayMs = 0, ...rest } = fields;
    super(rest);
    this.failures = failures;
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
    const failure = this.failures[this.calls];
    this.calls += 1;

    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    if (failure) throw failure;

    return super._generate(messages, options, runManager);
  }
}

/** Reports what the trusted runtime context actually looked like inside a tool. */
const probeTool = tool(
  async (_input: Record<string, never>, runtime: RuntimeOf) =>
    runTool(() => {
      const context = requireSamContext(runtime, "context_probe");
      return { companyId: context.companyId, runId: context.runId };
    }),
  {
    name: "context_probe",
    description: "Returns the trusted runtime context this run is scoped to.",
    schema: z.object({}),
  }
);

/** Fails transiently a fixed number of times, then succeeds. */
const createFlakyTool = (failuresBeforeSuccess: number) => {
  let attempts = 0;

  return tool(
    async () =>
      runTool(() => {
        attempts += 1;
        if (attempts <= failuresBeforeSuccess) {
          throw httpError("upstream unavailable", 503);
        }
        return { attempts };
      }),
    {
      name: "flaky_lookup",
      description: "Test tool that fails transiently before succeeding.",
      schema: z.object({}),
    }
  );
};

const hugeResultTool = tool(async () => runTool(() => ({ blob: "x".repeat(20_000) })), {
  name: "huge_result",
  description: "Test tool that returns more than the context can afford.",
  schema: z.object({}),
});

const writeTool = tool(async () => runTool(() => ({ written: true })), {
  name: "write_thing",
  description: "Test tool that changes company state.",
  schema: z.object({}),
});

const TEST_POLICIES = {
  ...SAM_TOOL_POLICIES,
  context_probe: { kind: "read_only", retryable: true, requiresApproval: false },
  flaky_lookup: { kind: "read_only", retryable: true, requiresApproval: false },
  huge_result: { kind: "read_only", retryable: false, requiresApproval: false },
  write_thing: { kind: "action", retryable: false, requiresApproval: true },
} as const;

const toolMessages = (result: SamRunResult): ToolMessage[] =>
  result.messages.filter((message): message is ToolMessage => message instanceof ToolMessage);

const payloadOf = (message: ToolMessage) =>
  JSON.parse(message.text) as { ok: boolean; data?: unknown; error?: string };

describe("Sam execution harness", () => {
  beforeEach(() => {
    createSamModel.mockReset();
  });

  describe("normal completion", () => {
    it("finishes a multi-step tool run and records what it did", async () => {
      createSamModel.mockReturnValue(
        new ScriptedModel({
          toolCalls: [[runwayCall("call_1")], [runwayCall("call_2", 900_000)], []],
        })
      );

      const result = await runSamAgent({
        messages: "How long do we have, and what if we raise?",
        context: CONTEXT,
      });

      expect(result.outcome).toBe("completed");
      expect(result.ok).toBe(true);
      expect(result.degraded).toBe(false);
      expect(result.toolCalls.map((call) => call.name)).toEqual([
        "calculate_runway",
        "calculate_runway",
      ]);

      expect(result.run.runId).toMatch(/^run_/);
      expect(result.run.requestId).toBe(result.run.runId);
      expect(result.run.companyId).toBe(COMPANY_ID);
      expect(result.run.modelCallCount).toBe(3);
      expect(result.run.toolCallCount).toBe(2);
      expect(result.run.toolNames).toEqual(["calculate_runway", "calculate_runway"]);
      expect(result.run.toolCalls[0]).toMatchObject({ kind: "calculation", ok: true });
      expect(result.run.toolCalls[0].durationMs).toBeGreaterThanOrEqual(0);
      expect(result.run.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.run.outcome).toBe("completed");
      expect(result.run.startedAt).toEqual(expect.any(String));
      expect(result.run.endedAt).toEqual(expect.any(String));
    });

    it("reports token usage when the provider exposes it", async () => {
      createSamModel.mockReturnValue(new FakeToolCallingModel({ toolCalls: [[]] }));

      const result = await runSamAgent({ messages: "Who are you?", context: CONTEXT });

      // The fake model reports no usage; the field is still present and summed,
      // so a real provider's numbers land without a shape change.
      expect(result.run.usage).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      });
    });
  });

  describe("budgets", () => {
    it("stops at the model-call limit with that termination reason", async () => {
      createSamModel.mockReturnValue(
        new ScriptedModel({
          toolCalls: [
            [runwayCall("m1", 100_000)],
            [runwayCall("m2", 200_000)],
            [runwayCall("m3", 300_000)],
            [runwayCall("m4", 400_000)],
          ],
        })
      );

      const result = await runSamAgent({
        messages: "Keep going forever.",
        context: CONTEXT,
        policy: { maxModelCalls: 2, maxToolCalls: 50, maxRepeatedToolCalls: 50 },
      });

      expect(result.outcome).toBe("max_model_calls");
      expect(result.ok).toBe(false);
      expect(result.text).toBe("");
      expect(result.run.modelCallCount).toBe(2);
    });

    it("stops at the tool-call limit with that termination reason", async () => {
      createSamModel.mockReturnValue(
        new ScriptedModel({
          toolCalls: [
            [runwayCall("t1", 100_000)],
            [runwayCall("t2", 200_000)],
            [runwayCall("t3", 300_000)],
            [runwayCall("t4", 400_000)],
          ],
        })
      );

      const result = await runSamAgent({
        messages: "Keep calling tools.",
        context: CONTEXT,
        policy: { maxModelCalls: 50, maxToolCalls: 2, maxRepeatedToolCalls: 50 },
      });

      expect(result.outcome).toBe("max_tool_calls");
      expect(result.run.toolCallCount).toBe(2);
    });

    it("applies a stricter ceiling to an individual tool", async () => {
      createSamModel.mockReturnValue(
        new ScriptedModel({
          toolCalls: [
            [runwayCall("p1", 100_000)],
            [runwayCall("p2", 200_000)],
            [runwayCall("p3", 300_000)],
          ],
        })
      );

      const result = await runSamAgent({
        messages: "Recalculate repeatedly.",
        context: CONTEXT,
        policy: {
          maxModelCalls: 50,
          maxToolCalls: 50,
          maxRepeatedToolCalls: 50,
          maxCallsPerTool: { calculate_runway: 1 },
        },
      });

      expect(result.outcome).toBe("max_tool_calls");
      expect(result.run.toolCallCount).toBe(1);
    });
  });

  describe("non-progress protection", () => {
    it("answers a repeated identical call without re-running the tool", async () => {
      createSamModel.mockReturnValue(
        new ScriptedModel({
          toolCalls: [[runwayCall("r1")], [runwayCall("r2")], []],
        })
      );

      const result = await runSamAgent({
        messages: "Ask the same thing twice.",
        context: CONTEXT,
      });

      expect(result.outcome).toBe("completed");
      // The tool ran once; the repeat came back as a refusal, not a second run.
      expect(result.run.toolCallCount).toBe(1);

      const repeat = payloadOf(toolMessages(result)[1]);
      expect(repeat.ok).toBe(false);
      expect(repeat.error).toContain("already called");
      expect(result.degraded).toBe(true);
    });

    it("ends the run when the agent will not stop repeating itself", async () => {
      // Identical arguments every turn; only the call ids differ, as they
      // would from a real model stuck in a loop.
      createSamModel.mockReturnValue(
        new ScriptedModel({
          toolCalls: [
            [runwayCall("l1")],
            [runwayCall("l2")],
            [runwayCall("l3")],
            [runwayCall("l4")],
          ],
        })
      );

      const result = await runSamAgent({
        messages: "Loop forever.",
        context: CONTEXT,
        policy: { maxModelCalls: 50, maxToolCalls: 50 },
      });

      expect(result.outcome).toBe("no_progress");
      expect(result.error).toContain("identical arguments");
      expect(result.run.toolCallCount).toBe(1);
    });
  });

  describe("retries", () => {
    it("recovers from a transient model failure and completes", async () => {
      createSamModel.mockReturnValue(
        new ScriptedModel({
          toolCalls: [[]],
          failures: [httpError("overloaded", 529), null],
        })
      );

      const result = await runSamAgent({
        messages: "What's our runway?",
        context: CONTEXT,
        policy: { maxModelRetries: 2, ...FAST_RETRIES },
      });

      expect(result.outcome).toBe("completed");
      expect(result.run.modelCalls).toHaveLength(2);
      expect(result.run.modelCalls[0]).toMatchObject({ ok: false });
      expect(result.run.modelCalls[1]).toMatchObject({ ok: true });
      // Only successful calls count against the budget.
      expect(result.run.modelCallCount).toBe(1);
      expect(result.run.failures[0]).toMatchObject({
        stage: "model",
        retryable: true,
        critical: false,
      });
      // It completed, but not cleanly.
      expect(result.degraded).toBe(true);
    });

    it("does not retry a non-retryable model failure", async () => {
      createSamModel.mockReturnValue(
        new ScriptedModel({
          toolCalls: [[]],
          failures: [httpError("invalid request", 400), null, null],
        })
      );

      const result = await runSamAgent({
        messages: "What's our runway?",
        context: CONTEXT,
        policy: { maxModelRetries: 3, ...FAST_RETRIES },
      });

      expect(result.outcome).toBe("model_error");
      expect(result.run.modelCalls).toHaveLength(1);
      expect(result.run.failures[0]).toMatchObject({
        stage: "model",
        retryable: false,
        critical: true,
      });
    });

    it("retries a transient failure in a retry-safe tool", async () => {
      createSamModel.mockReturnValue(
        new ScriptedModel({
          toolCalls: [[{ name: "flaky_lookup", args: {}, id: "f1" }], []],
        })
      );

      const result = await runSamAgent({
        messages: "Look that up.",
        context: CONTEXT,
        tools: [...SAM_TOOLS, createFlakyTool(1)],
        toolPolicies: TEST_POLICIES,
        policy: { maxToolRetries: 2, ...FAST_RETRIES },
      });

      expect(result.outcome).toBe("completed");
      expect(result.run.toolCalls.map((call) => call.ok)).toEqual([false, true]);
      expect(payloadOf(toolMessages(result)[0])).toMatchObject({
        ok: true,
        data: { attempts: 2 },
      });
    });
  });

  describe("deadlines and cancellation", () => {
    it("reports a timeout when the run deadline elapses", async () => {
      createSamModel.mockReturnValue(
        new ScriptedModel({ toolCalls: [[]], delayMs: 80 })
      );

      const result = await runSamAgent({
        messages: "Take your time.",
        context: CONTEXT,
        policy: { runDeadlineMs: 20, maxModelRetries: 0 },
      });

      expect(result.outcome).toBe("timeout");
      expect(result.ok).toBe(false);
      expect(result.run.outcome).toBe("timeout");
    });

    it("reports cancellation when the caller aborts", async () => {
      createSamModel.mockReturnValue(
        new ScriptedModel({ toolCalls: [[]], delayMs: 50 })
      );

      const controller = new AbortController();
      const pending = runSamAgent({
        messages: "Never mind.",
        context: CONTEXT,
        signal: controller.signal,
        policy: { maxModelRetries: 0 },
      });
      controller.abort();

      const result = await pending;
      expect(result.outcome).toBe("cancelled");
      expect(result.ok).toBe(false);
    });
  });

  describe("tool governance", () => {
    it("keeps company scope in the trusted runtime context, not the model's arguments", async () => {
      createSamModel.mockReturnValue(
        new ScriptedModel({
          toolCalls: [
            [
              {
                name: "calculate_runway",
                // The model tries to choose the company. It must not be able to.
                args: { ...runwayArgs(600_000), companyId: "company_someone_else" },
                id: "s1",
              },
            ],
            [{ name: "context_probe", args: {}, id: "s2" }],
            [],
          ],
        })
      );

      const result = await runSamAgent({
        messages: "Whose numbers are these?",
        context: CONTEXT,
        tools: [...SAM_TOOLS, probeTool],
        toolPolicies: TEST_POLICIES,
      });

      expect(result.outcome).toBe("completed");
      expect(payloadOf(toolMessages(result)[0])).toMatchObject({
        ok: true,
        data: { companyId: COMPANY_ID },
      });

      // ...and the run identity a future mutating tool would key on is server-set.
      expect(payloadOf(toolMessages(result)[1])).toMatchObject({
        ok: true,
        data: { companyId: COMPANY_ID, runId: result.run.runId },
      });
    });

    it("refuses a tool result too large to belong in the context window", async () => {
      createSamModel.mockReturnValue(
        new ScriptedModel({
          toolCalls: [[{ name: "huge_result", args: {}, id: "h1" }], []],
        })
      );

      const result = await runSamAgent({
        messages: "Give me everything.",
        context: CONTEXT,
        tools: [...SAM_TOOLS, hugeResultTool],
        toolPolicies: TEST_POLICIES,
        policy: { maxToolResultChars: 1_000 },
      });

      expect(result.outcome).toBe("completed");
      expect(result.run.toolCalls[0]).toMatchObject({ truncated: true, ok: false });

      const payload = payloadOf(toolMessages(result)[0]);
      expect(payload.ok).toBe(false);
      expect(payload.error).toContain("character limit");
    });

    it("blocks a state-changing tool that has no approver, and runs it when approved", async () => {
      const script = () =>
        new ScriptedModel({
          toolCalls: [[{ name: "write_thing", args: {}, id: "w1" }], []],
        });

      createSamModel.mockReturnValue(script());
      const blocked = await runSamAgent({
        messages: "Do the thing.",
        context: CONTEXT,
        tools: [...SAM_TOOLS, writeTool],
        toolPolicies: TEST_POLICIES,
      });

      expect(payloadOf(toolMessages(blocked)[0])).toMatchObject({ ok: false });
      expect(payloadOf(toolMessages(blocked)[0]).error).toContain("approval");

      createSamModel.mockReturnValue(script());
      const approved = await runSamAgent({
        messages: "Do the thing.",
        context: CONTEXT,
        tools: [...SAM_TOOLS, writeTool],
        toolPolicies: TEST_POLICIES,
        approver: { requestApproval: async () => true },
      });

      expect(payloadOf(toolMessages(approved)[0])).toMatchObject({
        ok: true,
        data: { written: true },
      });
    });
  });

  describe("context and graceful degradation", () => {
    it("still retrieves company memory and records what the context cost", async () => {
      createSamModel.mockReturnValue(new FakeToolCallingModel({ toolCalls: [[]] }));
      const persistentMemory = createSeededPersistentMemory(COMPANY_ID);

      const result = await runSamAgent({
        messages: "Should we hire a senior engineer?",
        context: { companyId: COMPANY_ID, persistentMemory },
        contextBuilder: createSamContextBuilder({
          persistentMemory,
          threadMemory: new InMemoryThreadMemory(),
        }),
      });

      expect(result.outcome).toBe("completed");
      expect(result.initialContext.memories.map((memory) => memory.id)).toContain(
        "mem_runway_floor"
      );
      expect(result.run.contextBudget).toMatchObject({
        memoryCount: result.initialContext.memories.length,
        withinBudget: true,
      });
      expect(result.run.contextBudget!.systemPromptChars).toBeGreaterThan(0);
      expect(result.run.contextBudget!.estimatedTokens).toBeGreaterThan(0);
    });

    it("degrades rather than failing when optional memory cannot be reached", async () => {
      createSamModel.mockReturnValue(new FakeToolCallingModel({ toolCalls: [[]] }));

      const result = await runSamAgent({
        messages: "What's our runway?",
        context: CONTEXT,
        contextBuilder: {
          build: async () => {
            throw httpError("memory backend unavailable", 503);
          },
        },
      });

      expect(result.outcome).toBe("completed");
      expect(result.degraded).toBe(true);
      expect(result.initialContext.memories).toEqual([]);
      expect(result.failures[0]).toMatchObject({
        stage: "context",
        critical: false,
        retryable: true,
      });
    });
  });

  describe("observability", () => {
    it("emits a start and an end event carrying the termination reason", async () => {
      createSamModel.mockReturnValue(
        new ScriptedModel({ toolCalls: [[runwayCall("o1")], []] })
      );

      const events: string[] = [];
      const result = await runSamAgent({
        messages: "What's our runway?",
        context: CONTEXT,
        observer: { record: (event) => events.push(event.type) },
      });

      expect(events[0]).toBe("run_started");
      expect(events).toContain("model_started");
      expect(events).toContain("model_completed");
      expect(events).toContain("tool_started");
      expect(events).toContain("tool_completed");
      expect(events[events.length - 1]).toBe("run_completed");
      expect(result.run.outcome).toBe("completed");
    });

    it("records no tool arguments or tool results", async () => {
      createSamModel.mockReturnValue(
        new ScriptedModel({ toolCalls: [[runwayCall("p1")], []] })
      );

      const result = await runSamAgent({
        messages: "What's our runway?",
        context: CONTEXT,
      });

      const serialised = JSON.stringify(result.run);
      expect(serialised).not.toContain("600000");
      expect(serialised).not.toContain("netMonthlyBurnUsd");
    });
  });
});
