import type { ClientTool } from "@langchain/core/tools";

import { financialPositionTool, financialCashFlowTool, financialBurnRunwayTool,
  financialComparisonTool, financialTraceTool, forecastCashTool,
  simulateFinancialScenarioTool, compareFinancialScenariosTool } from "@/lib/agents/sam/tools/financial";
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
 * thin adapters: over deterministic domain code in `lib/finance/`, or over the
 * memory interfaces in `lib/memory/`.
 */
export const SAM_TOOLS: ClientTool[] = [
  financialPositionTool, financialCashFlowTool, financialBurnRunwayTool,
  financialComparisonTool, financialTraceTool,
  forecastCashTool, simulateFinancialScenarioTool, compareFinancialScenariosTool,
  searchMemoryTool,
  getMemoryTool,
  getMemoryHistoryTool,
];

export {
  financialPositionTool, financialCashFlowTool, financialBurnRunwayTool,
  financialComparisonTool, financialTraceTool,
  forecastCashTool, simulateFinancialScenarioTool, compareFinancialScenariosTool,
  getMemoryHistoryTool,
  getMemoryTool,
  searchMemoryTool,
};
