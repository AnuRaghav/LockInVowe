import { tool, type ToolRuntime } from "@langchain/core/tools";
import { z } from "zod";

import { requireSamContext, type samRuntimeContextSchema } from "@/lib/agents/sam/context";
import { runTool } from "@/lib/agents/sam/tools/result";
import { loadOperatingState } from "@/lib/company/operating";
import { hasServiceCredentials } from "@/lib/supabase/service";

/**
 * Deep access to the company's stated operating plan.
 *
 * One tool, not one per assumption. The opening context carries a headline -
 * that a runway floor exists and what it is, that two hires are planned and
 * roughly what they cost - and this is how Sam reaches the rest: per-hire
 * dates, roles, the payroll roster in aggregate, every stored assumption, and
 * the provenance and missingness of each.
 *
 * It returns stored state. It does not ask the model to reconstruct a plan from
 * prose, and it does not compute a financial consequence: translating "two
 * engineers at $17k/month from November" into a cash trajectory is
 * `simulate_financial_scenario`'s job, and keeping that translation explicit is
 * what makes the resulting forecast auditable.
 *
 * The company is never an argument, as with every other Sam tool.
 */

const TOOL_NAME = "get_company_plan";

export const getCompanyPlanInputSchema = z.object({}).strict();

export const getCompanyPlanTool = tool(
  async (
    _input: z.infer<typeof getCompanyPlanInputSchema>,
    runtime: ToolRuntime<unknown, typeof samRuntimeContextSchema>
  ) =>
    runTool(
      async () => {
        const context = requireSamContext(runtime, TOOL_NAME);

        if (!hasServiceCredentials()) {
          throw new Error(
            "The company plan store is not configured in this environment. Say so rather than substituting figures from the conversation."
          );
        }

        return loadOperatingState(context.companyId);
      },
      {
        // The plan is what the company says about itself. The payroll section
        // inside it states its own `source_evidence` class, because Gusto
        // records are observations and the assumptions around them are not.
        class: "management_context",
        origin: "company-plan",
      }
    ),
  {
    name: TOOL_NAME,
    description:
      "Read the company's stored operating plan and payroll state: minimum runway floor, planned hires with dates and monthly cost, growth target, stated MRR and monthly expenses, current team headcount and cost, and the payroll roster in aggregate with the last processed run's observed employer cost. Every field carries its provenance (founder-entered at onboarding, derived, or observed from the payroll provider) and its date, and fields nobody has recorded are listed as missing rather than returned as zero. Call this when a question turns on what the company plans, targets or requires and your opening headline does not carry enough detail - for example before modelling a hire you need its start date and cost for. These are management statements, not verified financial actuals: translate them into explicit basis-labelled assumptions before forecasting, and never treat a stored figure as the observed cash position. Returns roles and headcount, never employee names. The company is set by the server; never ask for or guess a company id.",
    schema: getCompanyPlanInputSchema,
  }
);
