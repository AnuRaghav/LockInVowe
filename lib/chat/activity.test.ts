import { describe, expect, it } from "vitest";

import { applyActivityEvent, currentActivity, summarizeActivity, type ActivityStep } from "@/lib/chat/activity";

const started = (callId: string, name: string, label?: string) =>
  ({ type: "tool_started", callId, name, label }) as const;

describe("run activity", () => {
  it("tracks a call from started to completed", () => {
    let steps: ActivityStep[] = [];
    steps = applyActivityEvent(steps, started("c1", "financial_position"));
    expect(currentActivity(steps)).toBe("Checking your financial position");
    steps = applyActivityEvent(steps, { type: "tool_completed", callId: "c1", name: "financial_position" });
    expect(currentActivity(steps)).toBeNull();
    expect(summarizeActivity(steps)).toBe("Sam checked your financial position");
  });

  it("summarizes a multi-tool run in one line, collapsing repeats", () => {
    const steps = [
      started("c1", "financial_position"),
      started("c2", "search_memory"),
      started("c3", "get_memory"),
      started("c4", "simulate_financial_scenario"),
    ].reduce<ActivityStep[]>(
      (current, event) =>
        applyActivityEvent(applyActivityEvent(current, event), {
          type: "tool_completed",
          callId: event.callId,
          name: event.name,
        }),
      [],
    );
    expect(summarizeActivity(steps)).toBe(
      "Sam checked your financial position, reviewed your company notes and modeled the scenario",
    );
  });

  it("falls back to the server's own label for a tool it does not know", () => {
    const steps = applyActivityEvent([], started("c1", "future_tool", "Reviewing the cap table"));
    expect(currentActivity(steps)).toBe("Reviewing the cap table");
  });

  it("leaves nothing behind for a run that used no tools, and omits failed calls", () => {
    expect(summarizeActivity([])).toBeNull();
    const failed = applyActivityEvent(applyActivityEvent([], started("c1", "forecast_cash")), {
      type: "tool_failed",
      callId: "c1",
      name: "forecast_cash",
      critical: false,
    });
    expect(summarizeActivity(failed)).toBeNull();
  });
});
