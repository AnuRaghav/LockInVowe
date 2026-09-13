import { describe, expect, it } from "vitest";

import { createStreamParser } from "@/lib/chat/stream";

describe("chat stream parser", () => {
  it("reads text deltas and the thread frame the chat route writes", () => {
    const parser = createStreamParser();
    expect(parser.push('2:[{"type":"thread","threadId":"t-1"}]\n0:"Your runway"\n')).toEqual([
      { type: "thread", threadId: "t-1" },
      { type: "delta", text: "Your runway" },
    ]);
  });

  it("holds a frame split across chunks until its newline arrives", () => {
    const parser = createStreamParser();
    expect(parser.push('0:"half')).toEqual([]);
    expect(parser.push(' a frame"\n')).toEqual([{ type: "delta", text: "half a frame" }]);
  });

  it("emits a trailing unterminated frame on flush", () => {
    const parser = createStreamParser();
    expect(parser.push('0:"last"')).toEqual([]);
    expect(parser.flush()).toEqual([{ type: "delta", text: "last" }]);
  });

  it("surfaces tool lifecycle frames with only what the server sent", () => {
    const parser = createStreamParser();
    expect(
      parser.push(
        '2:[{"type":"tool_started","seq":3,"callId":"c1","name":"forecast_cash","kind":"calculation","label":"Forecasting"}]\n',
      ),
    ).toEqual([
      {
        type: "activity",
        activity: {
          type: "tool_started",
          callId: "c1",
          name: "forecast_cash",
          label: "Forecasting",
          summary: undefined,
          critical: false,
        },
      },
    ]);
  });

  it("reads terminal frames so a failed run is never rendered as an answer", () => {
    const parser = createStreamParser();
    expect(parser.push('2:[{"type":"run_terminated","outcome":"timeout"}]\n')).toEqual([
      { type: "run_terminated", outcome: "timeout" },
    ]);
    expect(parser.push('2:[{"type":"run_completed","degraded":true}]\n')).toEqual([
      { type: "run_completed", degraded: true },
    ]);
  });

  it("drops malformed lines and frames missing their identity", () => {
    const parser = createStreamParser();
    expect(parser.push('2:[{"type":"tool_started","name":"forecast_cash"}]\n8:{oops\nnot-a-frame\n')).toEqual([]);
  });
});
