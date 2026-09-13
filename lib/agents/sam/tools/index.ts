import type { ClientTool } from "@langchain/core/tools";

import { getCompanyPlanTool } from "@/lib/agents/sam/tools/company";
import { financialPositionTool, financialCashFlowTool, financialBurnRunwayTool,
  financialComparisonTool, financialTraceTool, forecastCashTool,
  simulateFinancialScenarioTool, compareFinancialScenariosTool } from "@/lib/agents/sam/tools/financial";
import { createChartTool } from "@/lib/agents/sam/tools/charts";
import {
  getMemoryHistoryTool,
  getMemoryTool,
  searchMemoryTool,
} from "@/lib/agents/sam/tools/memory";

/**
 * Sam's tool registry.
 *
 * Register every new financial, operational, or retrieval tool here - this
 * array is the single place that decides what Sam is able to do. Tools stay
 * thin adapters: over deterministic domain code in `lib/finance/`, over stored
 * company state in `lib/company/`, or over the memory interfaces in
 * `lib/memory/`.
 *
 * Grouped by the question each family answers, which is also the order the
 * capability index in the system prompt lists them in:
 *
 *   observed financial state     position, cash flow, burn/runway, comparison
 *   evidence                     explain_financial_number
 *   conditional consequences     forecast, simulate, compare scenarios
 *   management context           the memory tools, the company plan
 */
export const SAM_TOOLS: ClientTool[] = [
  financialPositionTool, financialCashFlowTool, financialBurnRunwayTool,
  financialComparisonTool, financialTraceTool,
  forecastCashTool, simulateFinancialScenarioTool, compareFinancialScenariosTool,
  searchMemoryTool,
  getMemoryTool,
  getMemoryHistoryTool,
  getCompanyPlanTool,
  createChartTool,
];

export {
  financialPositionTool, financialCashFlowTool, financialBurnRunwayTool,
  financialComparisonTool, financialTraceTool,
  forecastCashTool, simulateFinancialScenarioTool, compareFinancialScenariosTool,
  getCompanyPlanTool,
  getMemoryHistoryTool,
  getMemoryTool,
  searchMemoryTool,
  createChartTool,
};
