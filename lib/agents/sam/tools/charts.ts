import { tool, type ToolRuntime } from "@langchain/core/tools";

import { requireSamContext, type samRuntimeContextSchema } from "@/lib/agents/sam/context";
import { runTool } from "@/lib/agents/sam/tools/result";
import { chartSpecSchema } from "@/lib/charts/spec";
import { createConversationChartStore, type ConversationChartStore } from "@/lib/conversations/charts";

/**
 * `create_chart` - Sam shows the founder a picture of numbers it already has.
 *
 * The tool draws; it does not analyse. Every value must come from a finance
 * tool result in this turn. The series are stored against the running turn
 * and the chat renders them under Sam's answer. Sam only learns that the chart
 * was shown.
 */

export const CREATE_CHART_TOOL_NAME = "create_chart";

export const createChartSchema = chartSpecSchema;

export interface ChartToolDependencies {
  store: () => ConversationChartStore;
}

const defaultDependencies: ChartToolDependencies = {
  store: () => createConversationChartStore(),
};

export const buildCreateChartTool = (dependencies: ChartToolDependencies = defaultDependencies) =>
  tool(
    async (input, runtime: ToolRuntime<unknown, typeof samRuntimeContextSchema>) =>
      runTool(async () => {
        const { companyId, threadId, runId } = requireSamContext(runtime, CREATE_CHART_TOOL_NAME);
        if (!threadId || !runId) {
          throw new Error("Charts can only be shown inside a conversation. Describe the numbers in words instead.");
        }

        const chart = await dependencies.store().save({ companyId, threadId, runId, spec: input });

        return {
          chartId: chart.id,
          title: chart.spec.title,
          status: "shown_to_founder",
          instruction: "The chart appears directly below your reply. Refer to it in words; do not add image links or repeat every data point.",
        };
      }),
    {
      name: CREATE_CHART_TOOL_NAME,
      schema: createChartSchema,
      description:
        "Show the founder a line or bar chart of numbers you already have. Use it when a trend or comparison is clearer as a picture - a cash trajectory, scenarios side by side, one period against another. Every y value must be copied from a finance tool result in this conversation (use the displayed amount in major units, e.g. 1250000.5 for USD 1,250,000.50); never calculate, estimate, interpolate, or invent points. One currency per chart, named in yLabel. x values are ordered labels such as dates or period names. Up to 5 series, one per scenario or metric. The chart is shown to the founder automatically; you only get confirmation back.",
    }
  );

export const createChartTool = buildCreateChartTool();
