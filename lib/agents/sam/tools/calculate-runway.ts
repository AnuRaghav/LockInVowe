import { tool, type ToolRuntime } from "@langchain/core/tools";
import { z } from "zod";

import { requireSamContext, type samContextSchema } from "@/lib/agents/sam/context";
import { runTool } from "@/lib/agents/sam/tools/result";
import { calculateRunway } from "@/lib/finance/runway";

/**
 * Typed contract the model must satisfy to call this tool. Descriptions are
 * part of the prompt surface - they tell Claude what each field means.
 *
 * Only put fields here that Claude is genuinely allowed to choose. Anything
 * that identifies *who* the call is for - `companyId` above all - comes from
 * the trusted {@link samContextSchema} context instead.
 */
export const calculateRunwayInputSchema = z.object({
  cashOnHandUsd: z
    .number()
    .nonnegative()
    .describe("Total cash in the bank today, in USD."),
  monthlyRevenueUsd: z
    .number()
    .nonnegative()
    .describe("Average monthly revenue, in USD. Use 0 for pre-revenue."),
  monthlyExpensesUsd: z
    .number()
    .nonnegative()
    .describe("Average total monthly operating expenses, in USD."),
});

export type CalculateRunwayInput = z.infer<typeof calculateRunwayInputSchema>;

const TOOL_NAME = "calculate_runway";

/**
 * Representative financial tool: it proves the agent -> tool -> result loop and
 * sets the pattern every later Sam tool should follow.
 *
 * The adapter stays thin - it reads the trusted company context, validates the
 * model's arguments, and hands both to deterministic domain code. The math
 * lives in `lib/finance/runway.ts`.
 *
 * The figures here still come from the founder via the model; this tool is not
 * database-backed yet. When it is, `companyId` is already the key it will read
 * by, with no change to what the model is allowed to send.
 */
export const calculateRunwayTool = tool(
  async (
    input: CalculateRunwayInput,
    runtime: ToolRuntime<unknown, typeof samContextSchema>
  ) =>
    runTool(() => {
      const { companyId } = requireSamContext(runtime, TOOL_NAME);

      return { companyId, ...calculateRunway(input) };
    }),
  {
    name: TOOL_NAME,
    description:
      "Calculate how many months of cash the company has left, its net monthly burn, the projected zero-cash date, and a health status. Call this whenever runway, burn, or 'how long until we run out of money' comes up. The company is set by the server - never ask for or guess a company id.",
    schema: calculateRunwayInputSchema,
  }
);
