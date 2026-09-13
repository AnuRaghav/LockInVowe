/**
 * Onboarding: the conversational interview that gives Sam its baseline.
 *
 *   checklist.ts   What must be known, section by section. Coverage, not a script.
 *   sessions.ts    Resumable interview state; personal text never stored.
 *   tools.ts       Validated writes the interview makes as the founder answers.
 *   prompt.ts      Sam in onboarding mode.
 *   extract.ts     Closed sections and personal answers into durable understanding.
 *   interview.ts   One turn, end to end.
 *   facts.ts       What connected accounts already show.
 */

export * from "@/lib/onboarding/checklist";
export * from "@/lib/onboarding/sessions";
export { InMemoryOnboardingSessionStore } from "@/lib/onboarding/in-memory";
export { isOnboardingCapability, type OnboardingCapability } from "@/lib/onboarding/capability";
export { ONBOARDING_ASSUMPTION_KEYS, ONBOARDING_TOOLS, ONBOARDING_TOOL_POLICIES } from "@/lib/onboarding/tools";
export { ONBOARDING_SYSTEM_PROMPT, buildOnboardingSystemPrompt, type OnboardingPromptState } from "@/lib/onboarding/prompt";
export {
  ONBOARDING_SEMANTIC_LIMITS,
  extractPersonalAnswer,
  extractSection,
  type ExtractionDeps,
  type ExtractionResult,
} from "@/lib/onboarding/extract";
export {
  ONBOARDING_OPENING_MARKER,
  ONBOARDING_RESUME_MARKER,
  runOnboardingTurn,
  type OnboardingIdentity,
  type OnboardingTurnDeps,
  type OnboardingTurnInput,
  type OnboardingTurnResult,
} from "@/lib/onboarding/interview";
export { loadOnboardingFacts, type OnboardingFacts } from "@/lib/onboarding/facts";
export * from "@/lib/onboarding/choices";
export * from "@/lib/onboarding/state";
export {
  OnboardingNotReadyError,
  PlaybackCorrectionError,
  completeOnboarding,
  correctPlayback,
  loadOnboardingPlayback,
  playbackCorrectionSchema,
  type CompletedOnboarding,
  type OnboardingPlayback,
  type PlaybackCorrection,
  type PlaybackDeps,
  type PlaybackTopic,
} from "@/lib/onboarding/playback";
