import { describe, expect, it } from "vitest";

import { attachChartsToMessages } from "@/lib/conversations/charts";

const message = (id: string, role: "user" | "assistant") => ({ id, role, content: id });
const spec = { title: "Chart", type: "line" as const, series: [{ name: "Base", points: [{ x: "a", y: 1 }] }] };
const chart = (id: string, runId: string) => ({ id, runId, spec, createdAt: "2026-09-13T00:00:00Z" });

describe("attachChartsToMessages", () => {
  it("puts each chart under the answer its run produced", () => {
    const messages = [message("u1", "user"), message("a1", "assistant"), message("u2", "user"), message("a2", "assistant")];
    const runs = [
      { id: "r1", userMessageId: "u1", status: "completed" },
      { id: "r2", userMessageId: "u2", status: "completed" },
    ];

    const result = attachChartsToMessages(messages, runs, [chart("c1", "r2"), chart("c2", "r2")]);

    expect(result.map((m) => [m.id, m.charts.map((c) => c.id)])).toEqual([
      ["u1", []], ["a1", []], ["u2", []], ["a2", ["c1", "c2"]],
    ]);
  });

  it("drops charts from a run that never produced an answer", () => {
    const messages = [message("u1", "user"), message("u2", "user"), message("a2", "assistant")];
    const runs = [
      { id: "r1", userMessageId: "u1", status: "failed" },
      { id: "r2", userMessageId: "u2", status: "completed" },
    ];

    const result = attachChartsToMessages(messages, runs, [chart("c1", "r1")]);

    expect(result.every((m) => m.charts.length === 0)).toBe(true);
  });
});
