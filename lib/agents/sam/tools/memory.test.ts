import { describe, expect, it } from "vitest";

import { getMemoryTool, searchMemoryTool } from "@/lib/agents/sam/tools/memory";
import { createSeededPersistentMemory } from "@/lib/memory/seed";

const COMPANY_ID = "company_test_1";

const context = (companyId = COMPANY_ID) => ({
  context: {
    companyId,
    persistentMemory: createSeededPersistentMemory(COMPANY_ID),
  },
});

type Payload = {
  ok: boolean;
  data?: { memories?: Array<{ id: string; content: string }>; content?: string };
  error?: string;
};

const search = async (
  args: { query: string; kinds?: string[]; limit?: number },
  config?: ReturnType<typeof context>
) => JSON.parse(await searchMemoryTool.invoke(args, config)) as Payload;

const get = async (args: { id: string }, config?: ReturnType<typeof context>) =>
  JSON.parse(await getMemoryTool.invoke(args, config)) as Payload;

describe("searchMemoryTool", () => {
  it("finds company knowledge for a plain-language query", async () => {
    const result = await search({ query: "runway policy" }, context());

    expect(result.ok).toBe(true);
    expect(result.data?.memories?.[0]).toMatchObject({
      id: "mem_runway_floor",
      content: expect.stringContaining("12 months of runway"),
    });
  });

  it("does not let the model choose whose memory it reads", () => {
    expect(Object.keys(searchMemoryTool.schema.shape)).not.toContain("companyId");
  });

  it("reads only the company from the trusted context", async () => {
    const result = await search({ query: "runway policy" }, context("company_other"));

    expect(result).toMatchObject({ ok: true, data: { memories: [] } });
  });

  it("returns a failure envelope when company context is missing", async () => {
    expect(await search({ query: "runway policy" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("context"),
    });
  });
});

describe("getMemoryTool", () => {
  it("returns one memory by id", async () => {
    expect(await get({ id: "mem_raise_march" }, context())).toMatchObject({
      ok: true,
      data: { content: expect.stringContaining("March") },
    });
  });

  it("reports an unknown id instead of inventing one", async () => {
    expect(await get({ id: "mem_nope" }, context())).toMatchObject({
      ok: false,
      error: expect.stringContaining("mem_nope"),
    });
  });
});
