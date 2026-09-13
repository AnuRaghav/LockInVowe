/**
 * Sam - the CFO/ops agent.
 *
 * Two boundaries to preserve as this package grows:
 *
 * 1. The LLM decides *what* it needs; deterministic code in `lib/finance/`
 *    computes it. Tools are thin adapters between the two. Never put a formula
 *    in a prompt.
 * 2. The LLM decides *which tool* to call; the application decides *which
 *    company* it runs against. Company identity travels in {@link SamContext},
 *    never in a tool's argument schema.
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

export {
  MissingSamContextError,
  requireSamContext,
  samContextSchema,
  type SamContext,
} from "@/lib/agents/sam/context";

export { SAM_SYSTEM_PROMPT } from "@/lib/agents/sam/prompt";
export { samAnswerSchema, type SamAnswer, type SamToolCall } from "@/lib/agents/sam/schemas";
export { SAM_TOOLS, calculateRunwayTool } from "@/lib/agents/sam/tools";
export {
  runTool,
  toolFailure,
  toolSuccess,
  type SamToolPayload,
} from "@/lib/agents/sam/tools/result";
export { isVoiceEnabled, speak } from "@/lib/agents/sam/voice";
