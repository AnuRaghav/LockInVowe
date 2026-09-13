import { describe, expect, it } from "vitest";

import { calculateRunwayTool } from "@/lib/agents/sam/tools/calculate-runway";

const ARGS = {
  cashOnHandUsd: 600_000,
  monthlyRevenueUsd: 20_000,
  monthlyExpensesUsd: 70_000,
};

const invoke = async (config?: Record<string, unknown>) =>
  JSON.parse(await calculateRunwayTool.invoke(ARGS, config)) as {
    ok: boolean;
    data?: { companyId?: string };
    error?: string;
  };

describe("calculateRunwayTool", () => {
  it("runs against the company from the trusted context, not from its arguments", async () => {
    expect(await invoke({ context: { companyId: "company_test_1" } })).toMatchObject({
      ok: true,
      data: { companyId: "company_test_1", runwayMonths: 12 },
    });
  });

  it("does not accept a companyId the model made up", () => {
    expect(Object.keys(calculateRunwayTool.schema.shape)).not.toContain("companyId");
  });

  it("returns a failure envelope when company context is missing", async () => {
    expect(await invoke()).toMatchObject({
      ok: false,
      error: expect.stringContaining("context"),
    });
  });
});
