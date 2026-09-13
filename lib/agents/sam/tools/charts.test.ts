import { describe, expect, it, vi } from "vitest";

import { buildCreateChartTool, createChartTool } from "@/lib/agents/sam/tools/charts";
import type { ChartSpec } from "@/lib/charts/spec";
import type { ConversationChartStore } from "@/lib/conversations/charts";

const spec: ChartSpec = {
  title: "Cash trajectory",
  type: "line",
  yLabel: "USD",
  series: [{ name: "Base", points: [{ x: "2026-10", y: 900000 }, { x: "2026-11", y: 850000 }] }],
};

const conversationContext = {
  context: { companyId: "company_1", threadId: "thread_1", runId: "run_1" },
};

const build = (save: ConversationChartStore["save"] = async () => ({
  id: "chart_1", runId: "run_1", spec, createdAt: "2026-09-13T00:00:00Z",
})) => {
  const store = { save: vi.fn(save), listForThread: vi.fn() };
  return { store, tool: buildCreateChartTool({ store: () => store }) };
};

type Payload = { ok: boolean; data?: Record<string, unknown>; error?: string };

const invoke = async (tool: ReturnType<typeof buildCreateChartTool>, args: unknown = spec, config: object = conversationContext) =>
  JSON.parse(await tool.invoke(args as ChartSpec, config)) as Payload;

describe("create_chart", () => {
  it("stores the series against the trusted run and returns only a confirmation", async () => {
    const { tool, store } = build();

    expect(await invoke(tool)).toMatchObject({ ok: true, data: { chartId: "chart_1", status: "shown_to_founder" } });
    expect(store.save).toHaveBeenCalledWith({ companyId: "company_1", threadId: "thread_1", runId: "run_1", spec });
  });

  it("never lets the model choose the company, thread, or run", () => {
    for (const key of ["companyId", "threadId", "runId"]) {
      expect(Object.keys(createChartTool.schema.shape)).not.toContain(key);
    }
  });

  it("refuses outside a conversation turn", async () => {
    const { tool, store } = build();

    expect(await invoke(tool, spec, { context: { companyId: "company_1" } }))
      .toMatchObject({ ok: false, error: expect.stringContaining("inside a conversation") });
    expect(store.save).not.toHaveBeenCalled();
  });

  it("returns a storage failure to Sam instead of aborting the run", async () => {
    const { tool } = build(async () => { throw new Error("This turn can no longer take a chart."); });

    expect(await invoke(tool)).toMatchObject({ ok: false, error: "This turn can no longer take a chart." });
  });

  it("rejects more series than the chart palette can show", async () => {
    const { tool, store } = build();
    const tooMany = { ...spec, series: Array.from({ length: 6 }, (_, i) => ({ name: `S${i}`, points: [{ x: "a", y: i }] })) };

    await expect(invoke(tool, tooMany)).rejects.toThrow();
    expect(store.save).not.toHaveBeenCalled();
  });
});
