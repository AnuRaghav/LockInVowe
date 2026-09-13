import { describe, expect, it } from "vitest";

import { parseInline, parseMarkdown } from "@/lib/chat/markdown";

describe("markdown blocks", () => {
  it("reads the shapes Sam's answers actually use", () => {
    const blocks = parseMarkdown(
      "## Runway\n\nYou have **14.2 months**.\nThat assumes flat revenue.\n\n- Cash: $2.1M\n- Burn: $148K\n",
    );
    expect(blocks.map((block) => block.type)).toEqual(["heading", "paragraph", "list"]);
    expect(blocks[0]).toMatchObject({ type: "heading", level: 2 });
    // Soft-wrapped lines join into one paragraph.
    expect(blocks[1]).toMatchObject({
      type: "paragraph",
      children: [
        { type: "text", value: "You have " },
        { type: "strong", children: [{ type: "text", value: "14.2 months" }] },
        { type: "text", value: ". That assumes flat revenue." },
      ],
    });
    expect(blocks[2]).toMatchObject({ type: "list", ordered: false });
  });

  it("reads ordered lists and simple tables", () => {
    const blocks = parseMarkdown("1. Hire two now\n2. Hold the third\n\n| Case | Runway |\n| --- | --- |\n| Base | 14.2 |\n");
    expect(blocks[0]).toMatchObject({ type: "list", ordered: true });
    expect(blocks[0]).toHaveProperty("items.length", 2);
    expect(blocks[1]).toMatchObject({ type: "table" });
    expect(blocks[1]).toHaveProperty("rows.length", 1);
  });

  it("renders a half-streamed fence rather than waiting for it to close", () => {
    expect(parseMarkdown("```\nstill arriving")).toEqual([{ type: "code", value: "still arriving" }]);
  });
});

describe("markdown inline", () => {
  it("keeps snake_case intact while reading emphasis", () => {
    expect(parseInline("uses financial_position and *care*")).toEqual([
      { type: "text", value: "uses financial_position and " },
      { type: "em", children: [{ type: "text", value: "care" }] },
    ]);
  });

  it("drops link syntax that is not a safe scheme", () => {
    expect(parseInline("[click](javascript:alert(1))")).toEqual([
      { type: "text", value: "[click](javascript:alert(1))" },
    ]);
    expect(parseInline("[docs](https://example.com)")).toMatchObject([
      { type: "link", href: "https://example.com" },
    ]);
  });

  it("leaves an unclosed marker as text mid-stream", () => {
    expect(parseInline("**half an answ")).toEqual([{ type: "text", value: "**half an answ" }]);
  });
});
