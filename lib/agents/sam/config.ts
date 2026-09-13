/**
 * Environment + model configuration for the Sam agent.
 *
 * Everything the agent needs to talk to Anthropic
 * is resolved here so the rest of the package never reads `process.env`.
 */

/**
 * Default Claude model backing Sam. Override with `SAM_MODEL`.
 *
 * Must support adaptive thinking (see lib/agents/sam/model.ts) - Anthropic
 * rejects the request outright on a model that doesn't, which is what
 * `claude-sonnet-4-5` did once it aged out of that support. Verified against
 * the live API before pinning this.
 */
export const DEFAULT_SAM_MODEL = "claude-sonnet-5";

/** Default output cap. Sam's answers are short; tool loops do the heavy work. */
export const DEFAULT_SAM_MAX_TOKENS = 4096;

export interface SamModelConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
  /**
   * Adaptive thinking is the only supported mode on current Claude models -
   * the model decides how much to think per turn. `effort` tunes the depth.
   */
  effort: "low" | "medium" | "high" | "xhigh" | "max";
}

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. See .env.example.`
    );
  }
  return value;
};

/**
 * Reads a positive-integer setting from the environment.
 *
 * Shared with the execution policy so every numeric knob Sam has - token caps,
 * call budgets, deadlines - is parsed and validated the same way.
 */
export const readIntEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got "${raw}".`);
  }
  return parsed;
};

const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

const readEffort = (): SamModelConfig["effort"] => {
  const raw = process.env.SAM_EFFORT;
  if (!raw) return "medium";
  const match = EFFORT_LEVELS.find((level) => level === raw);
  if (!match) {
    throw new Error(
      `SAM_EFFORT must be one of ${EFFORT_LEVELS.join(", ")}, got "${raw}".`
    );
  }
  return match;
};

/** Resolves Anthropic model config. Throws if `ANTHROPIC_API_KEY` is unset. */
export const getSamModelConfig = (
  overrides: Partial<SamModelConfig> = {}
): SamModelConfig => ({
  apiKey: overrides.apiKey ?? requireEnv("ANTHROPIC_API_KEY"),
  model: overrides.model ?? process.env.SAM_MODEL ?? DEFAULT_SAM_MODEL,
  maxTokens:
    overrides.maxTokens ?? readIntEnv("SAM_MAX_TOKENS", DEFAULT_SAM_MAX_TOKENS),
  effort: overrides.effort ?? readEffort(),
});
