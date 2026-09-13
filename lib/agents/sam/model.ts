import { ChatAnthropic } from "@langchain/anthropic";

import { getSamModelConfig, type SamModelConfig } from "@/lib/agents/sam/config";

/**
 * Builds the Claude chat model Sam reasons with.
 *
 * Sampling params (`temperature`, `topP`, ...) are deliberately omitted -
 * current Claude models reject them, and thinking depth is controlled by
 * `effort` instead.
 */
export const createSamModel = (
  overrides: Partial<SamModelConfig> = {}
): ChatAnthropic => {
  const config = getSamModelConfig(overrides);

  return new ChatAnthropic({
    apiKey: config.apiKey,
    model: config.model,
    maxTokens: config.maxTokens,
    thinking: { type: "adaptive" },
    outputConfig: { effort: config.effort },
  });
};
