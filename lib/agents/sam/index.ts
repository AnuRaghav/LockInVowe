/**
 * Sam - the CFO/ops agent.
 *
 * Two boundaries to preserve as this package grows:
 *
 * 1. The LLM decides *what* it needs; deterministic code in `lib/finance/`
 *    computes it. Tools are thin adapters between the two. Never put a formula
 *    in a prompt.
 * 2. The LLM decides *which tool* to call; the application decides *which
 *    company* it runs against. Company identity travels in
 *    {@link SamRuntimeContext}, never in a tool's argument schema.
 * 3. The LLM does not decide what it knows. The {@link SamContextBuilder}
 *    assembles the model context from the memory modules; Sam reaches for
 *    anything else through the retrieval tools mid-loop.
 * 4. The LLM does not decide how long it runs. The harness owns budgets,
 *    deadlines, retries, and the termination reason. See `harness/`.
 * 5. A run is observable while it happens, on Sam's own event contract - never
 *    LangChain's. See `harness/events.ts` and {@link streamSamAgent}.
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

export { streamSamAgent, type SamRunStream } from "@/lib/agents/sam/stream";

export {
  DEFAULT_SAM_MODEL,
  getSamModelConfig,
  getSamVoiceConfig,
  type SamModelConfig,
  type SamVoiceConfig,
} from "@/lib/agents/sam/config";

export {
  MissingSamContextError,
  memoryScope,
  requireSamContext,
  samContextSchema,
  samRuntimeContextSchema,
  type SamContext,
  type SamRuntimeContext,
} from "@/lib/agents/sam/context";

export {
  createSamContextBuilder,
  type CreateSamContextBuilderOptions,
  type SamContextBuilder,
  type SamContextRequest,
  type SamInitialContext,
} from "@/lib/agents/sam/context-builder";

export {
  SAM_SYSTEM_PROMPT,
  buildSamSystemPrompt,
  formatSamContext,
} from "@/lib/agents/sam/prompt";
export { samAnswerSchema, type SamAnswer, type SamToolCall } from "@/lib/agents/sam/schemas";
export {
  SAM_TOOLS,
  financialPositionTool,
  financialCashFlowTool,
  financialBurnRunwayTool,
  financialComparisonTool,
  financialTraceTool,
  getMemoryHistoryTool,
  getMemoryTool,
  searchMemoryTool,
} from "@/lib/agents/sam/tools";
export {
  DEFAULT_SAM_TOOL_POLICY,
  SAM_TOOL_POLICIES,
  retryableToolNames,
  samToolLabel,
  samToolPolicy,
  toolCallCeilings,
  type SamToolKind,
  type SamToolPolicy,
  type SamToolPolicyRegistry,
} from "@/lib/agents/sam/tools/policy";
export * from "@/lib/agents/sam/harness";
export {
  runTool,
  toolFailure,
  toolSuccess,
  type SamToolPayload,
} from "@/lib/agents/sam/tools/result";
export { isVoiceEnabled, speak } from "@/lib/agents/sam/voice";
