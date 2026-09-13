import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { calculateRunway } from "@/lib/finance/runway";

/**
 * Typed contract the model must satisfy to call this tool. Descriptions are
 * part of the prompt surface - they tell Claude what each field means.
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

/**
 * Representative financial tool: it proves the agent -> tool -> result loop and
 * sets the pattern every later Sam tool should follow. The tool is a thin
 * adapter - validation and serialization live here, the math lives in
 * `lib/finance/runway.ts`.
 */
export const calculateRunwayTool = tool(
  async (input: CalculateRunwayInput) => JSON.stringify(calculateRunway(input)),
  {
    name: "calculate_runway",
    description:
      "Calculate how many months of cash the company has left, its net monthly burn, the projected zero-cash date, and a health status. Call this whenever runway, burn, or 'how long until we run out of money' comes up.",
    schema: calculateRunwayInputSchema,
  }
);
