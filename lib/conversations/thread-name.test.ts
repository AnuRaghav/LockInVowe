import { describe, expect, it } from "vitest";

import { normalizeThreadName, threadNameFromMessage } from "@/lib/conversations/store";

describe("threadNameFromMessage", () => {
  it("keeps a short question as the title", () => {
    expect(threadNameFromMessage("what's my runway right now?")).toBe("What's my runway right now?");
  });

  it("uses only the first sentence", () => {
    expect(threadNameFromMessage("How much cash do we have. Also check burn.")).toBe("How much cash do we have");
  });

  it("cuts a long message at a word boundary", () => {
    const name = threadNameFromMessage("If we make two engineering hires next quarter, what does that do to runway and burn");
    expect(name.endsWith("…")).toBe(true);
    expect(name.length).toBeLessThanOrEqual(49);
    expect(name).toBe("If we make two engineering hires next quarter…");
  });
});

describe("normalizeThreadName", () => {
  it("trims, collapses whitespace, and rejects empty names", () => {
    expect(normalizeThreadName("  Q4   hiring  ")).toBe("Q4 hiring");
    expect(normalizeThreadName("   ")).toBeNull();
    expect(normalizeThreadName(42)).toBeNull();
  });
});
