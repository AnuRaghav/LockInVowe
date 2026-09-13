/**
 * Sam - the CFO/ops agent.
 *
 * Boundary to preserve as this package grows: the LLM decides *what* it needs;
 * deterministic code in `lib/finance/` computes it. Tools are thin adapters
 * between the two. Never put a formula in a prompt.
 */
export {
  createSamAgent,
  createStructuredSamAgent,
  runSamAgent,
  runSamAgentStructured,
  type CreateSamAgentOptions,
  type SamRunInput,
  type SamRunResult,
  type SamStructuredRunResult,
} from "@/lib/agents/sam/agent";

export {
  DEFAULT_SAM_MODEL,
  getSamModelConfig,
  getSamVoiceConfig,
  type SamModelConfig,
  type SamVoiceConfig,
} from "@/lib/agents/sam/config";

export { SAM_SYSTEM_PROMPT } from "@/lib/agents/sam/prompt";
export { samAnswerSchema, type SamAnswer, type SamToolCall } from "@/lib/agents/sam/schemas";
export { SAM_TOOLS, calculateRunwayTool } from "@/lib/agents/sam/tools";
export { isVoiceEnabled, speak } from "@/lib/agents/sam/voice";
