import { ChatAnthropic } from "@langchain/anthropic";

import { readIntEnv } from "@/lib/agents/sam/config";
import { DEFAULT_SAM_MODEL } from "@/lib/agents/sam/config";

/**
 * The Claude model behind the semantic layer.
 *
 * Separate from `createSamModel()` on purpose, for one reason that matters:
 * Sam runs with adaptive thinking, and the semantic jobs here - proposing
 * operations, writing a brief - are structured-output calls, which LangChain
 * implements as a forced tool choice. Anthropic does not allow a forced tool
 * choice alongside extended thinking, so reusing Sam's model configuration
 * would work in development and fail the first time it mattered.
 *
 * There are no sampling parameters here either: current Claude models reject
 * them, and the behaviour we want from this call is faithfulness to the
 * conversation rather than variety.
 */

/** Override with `SEMANTIC_MODEL`; falls back to whatever Sam runs on. */
export const getSemanticModelName = (): string =>
  process.env.SEMANTIC_MODEL ?? process.env.SAM_MODEL ?? DEFAULT_SAM_MODEL;

export interface SemanticModelOptions {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
}

export const createSemanticModel = ({
  apiKey,
  model,
  maxTokens,
}: SemanticModelOptions = {}): ChatAnthropic => {
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      "Missing ANTHROPIC_API_KEY. The semantic updater and company brief need a model; pass a deterministic implementation instead when running without one."
    );
  }

  return new ChatAnthropic({
    apiKey: key,
    model: model ?? getSemanticModelName(),
    maxTokens: maxTokens ?? readIntEnv("SEMANTIC_MAX_TOKENS", 2048),
  });
};

/** Whether a live model call is possible in this process. */
export const hasSemanticModel = (): boolean => Boolean(process.env.ANTHROPIC_API_KEY);
