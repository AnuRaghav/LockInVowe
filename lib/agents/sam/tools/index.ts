import type { ClientTool } from "@langchain/core/tools";

import { calculateRunwayTool } from "@/lib/agents/sam/tools/calculate-runway";

/**
 * Sam's tool registry.
 *
 * Register every new financial or operational tool here - this array is the
 * single place that decides what Sam is able to do. Tools stay thin adapters
 * over deterministic domain code in `lib/finance/`.
 */
export const SAM_TOOLS: ClientTool[] = [calculateRunwayTool];

export { calculateRunwayTool };
