import type { ClientTool } from "@langchain/core/tools";

import { calculateRunwayTool } from "@/lib/agents/sam/tools/calculate-runway";
import { getMemoryTool, searchMemoryTool } from "@/lib/agents/sam/tools/memory";

/**
 * Sam's tool registry.
 *
 * Register every new financial, operational, or retrieval tool here - this
 * array is the single place that decides what Sam is able to do. Tools stay
 * thin adapters: over deterministic domain code in `lib/finance/`, or over the
 * memory interfaces in `lib/memory/`.
 */
export const SAM_TOOLS: ClientTool[] = [
  calculateRunwayTool,
  searchMemoryTool,
  getMemoryTool,
];

export { calculateRunwayTool, getMemoryTool, searchMemoryTool };
