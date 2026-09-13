/**
 * Environment + model configuration for the Sam agent.
 *
 * Everything the agent needs to talk to Anthropic (and optionally ElevenLabs)
 * is resolved here so the rest of the package never reads `process.env`.
 */

/** Default Claude model backing Sam. Override with `SAM_MODEL`. */
export const DEFAULT_SAM_MODEL = "claude-sonnet-4-5";

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

export interface SamVoiceConfig {
  apiKey: string;
  voiceId: string;
  modelId: string;
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

const readInt = (name: string, fallback: number): number => {
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
    overrides.maxTokens ?? readInt("SAM_MAX_TOKENS", DEFAULT_SAM_MAX_TOKENS),
  effort: overrides.effort ?? readEffort(),
});

/**
 * Resolves ElevenLabs config. Voice is optional, so this returns `null` when
 * credentials are absent rather than throwing.
 */
export const getSamVoiceConfig = (): SamVoiceConfig | null => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!apiKey || !voiceId) return null;

  return {
    apiKey,
    voiceId,
    modelId: process.env.ELEVENLABS_MODEL_ID ?? "eleven_turbo_v2_5",
  };
};
