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

  it("ignores tool lifecycle frames and malformed lines", () => {
    const parser = createStreamParser();
    expect(
      parser.push('2:[{"type":"tool_started","name":"runway"}]\n8:{oops\nnot-a-frame\n'),
    ).toEqual([]);
  });
});
