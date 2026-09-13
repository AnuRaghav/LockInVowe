import { createFounderBlockStore } from "@/lib/founder/store";
import type { FounderBlockStore, FounderScope } from "@/lib/founder/types";
import {
  applyFounderProposal,
  createModelFounderProposer,
  createNoopFounderProposer,
  type FounderProposer,
} from "@/lib/founder/update";
import {
  questionsInSection,
  type OnboardingSection,
} from "@/lib/onboarding/checklist";
import type { StoredOnboardingMessage } from "@/lib/onboarding/sessions";
import { hasSemanticModel } from "@/lib/semantic/model";
import type { SemanticBlockStore } from "@/lib/semantic/types";
import { updateSemanticState } from "@/lib/semantic/update";
import type { SemanticInteractionStore } from "@/lib/semantic/update/interactions";
import { SEMANTIC_ONBOARDING_PROMPT } from "@/lib/semantic/update/prompt";
import {
  createModelSemanticProposer,
  createNoopSemanticProposer,
} from "@/lib/semantic/update/proposer";
import type {
  SemanticInteractionMessage,
  SemanticProposer,
  SemanticUpdateLimits,
} from "@/lib/semantic/update/types";

/**
 * Turning onboarding answers into durable understanding.
 *
 * Two paths, and the split is the privacy rule:
 *
 * - A completed company or founder section is consolidated from its stored
 *   transcript - by the semantic updater for the company, by the founder
 *   updater for the founder. Company transcripts are recorded as semantic
 *   interactions like any conversation.
 * - A personal answer is consolidated the moment it is given, from the
 *   in-memory text, before the transcript stores a redacted placeholder. It
 *   never reaches `semantic_interactions`, and it is only ever written as a
 *   personal founder block.
 *
 * Neither path throws. An answer that could not be consolidated is reported,
 * and the interview carries on.
 */

/** Onboarding covers several topics per section on purpose, so it needs more room than a conversation. */
export const ONBOARDING_SEMANTIC_LIMITS: SemanticUpdateLimits = { maxOperations: 6, maxCreates: 6 };

export interface ExtractionDeps {
  semanticStore?: SemanticBlockStore;
  semanticInteractions?: SemanticInteractionStore;
  semanticProposer?: SemanticProposer;
  founderBlocks?: FounderBlockStore;
  founderProposer?: FounderProposer;
  now?: () => Date;
}

export interface ExtractionResult {
  sectionId: string;
  status: "applied" | "unchanged" | "skipped" | "failed";
  applied: number;
  rejected: number;
  error?: string;
}

const defaultSemanticProposer = (): SemanticProposer =>
  hasSemanticModel()
    ? createModelSemanticProposer({
        prompt: SEMANTIC_ONBOARDING_PROMPT,
        maxOperations: ONBOARDING_SEMANTIC_LIMITS.maxOperations,
      })
    : createNoopSemanticProposer();

const defaultFounderProposer = (): FounderProposer =>
  hasSemanticModel() ? createModelFounderProposer() : createNoopFounderProposer();

const failed = (sectionId: string, error: unknown): ExtractionResult => ({
  sectionId,
  status: "failed",
  applied: 0,
  rejected: 0,
  error: error instanceof Error ? error.message : String(error),
});

export interface ExtractSectionInput {
  identity: { founderId: string; companyId: string };
  sessionId: string;
  section: OnboardingSection;
  transcript: StoredOnboardingMessage[];
  deps?: ExtractionDeps;
}

/** Consolidates a completed, non-sensitive section from its stored transcript. */
export const extractSection = async ({
  identity,
  sessionId,
  section,
  transcript,
  deps = {},
}: ExtractSectionInput): Promise<ExtractionResult> => {
  const skipped: ExtractionResult = { sectionId: section.id, status: "skipped", applied: 0, rejected: 0 };
  if (section.sensitive) return skipped;

  const turns = transcript.filter(
    (turn): turn is Extract<StoredOnboardingMessage, { text: string }> =>
      turn.sectionId === section.id && "text" in turn
  );
  if (turns.length === 0) return skipped;

  const messages: SemanticInteractionMessage[] = turns.map((turn) => ({ role: turn.role, text: turn.text }));
  const occurredAt = turns[turns.length - 1].at;
  const now = (deps.now?.() ?? new Date()).toISOString();

  try {
    if (section.subject === "company") {
      const result = await updateSemanticState({
        scope: { companyId: identity.companyId },
        interaction: {
          externalKey: `onboarding:${sessionId}:${section.id}`,
          source: "onboarding",
          occurredAt,
          messages,
        },
        proposer: deps.semanticProposer ?? defaultSemanticProposer(),
        store: deps.semanticStore,
        interactions: deps.semanticInteractions,
        limits: ONBOARDING_SEMANTIC_LIMITS,
        now,
      });

      return {
        sectionId: section.id,
        status: result.status,
        applied: result.applied.length,
        rejected: result.rejected.length,
        error: result.error,
      };
    }

    const scope: FounderScope = { founderId: identity.founderId };
    const store = deps.founderBlocks ?? createFounderBlockStore();
    const proposal = await (deps.founderProposer ?? defaultFounderProposer()).propose({
      messages,
      blocks: await store.listCurrentBlocks(scope, { limit: 20 }),
      sensitive: false,
      questions: questionsInSection(section.id),
      now,
    });

    const { applied, rejected } = await applyFounderProposal({
      scope,
      store,
      proposal,
      sensitivity: "standard",
      provenance: { kind: "onboarding", sessionId, sectionId: section.id },
      occurredAt,
    });

    return {
      sectionId: section.id,
      status: applied.length > 0 ? "applied" : "unchanged",
      applied: applied.length,
      rejected: rejected.length,
    };
  } catch (error) {
    return failed(section.id, error);
  }
};

export interface ExtractPersonalAnswerInput {
  founderId: string;
  sessionId: string;
  /** The founder's words. Held only for this call; never stored as text. */
  text: string;
  at: string;
  deps?: ExtractionDeps;
}

/** Consolidates one personal answer into personal founder blocks, before its text is discarded. */
export const extractPersonalAnswer = async ({
  founderId,
  sessionId,
  text,
  at,
  deps = {},
}: ExtractPersonalAnswerInput): Promise<ExtractionResult> => {
  const scope: FounderScope = { founderId };

  try {
    const store = deps.founderBlocks ?? createFounderBlockStore();
    const blocks = (await store.listCurrentBlocks(scope, { includePersonal: true, limit: 20 })).filter(
      (block) => block.sensitivity === "personal"
    );

    const proposal = await (deps.founderProposer ?? defaultFounderProposer()).propose({
      messages: [{ role: "founder", text }],
      blocks,
      sensitive: true,
      questions: questionsInSection("personal"),
      now: (deps.now?.() ?? new Date()).toISOString(),
    });

    const { applied, rejected } = await applyFounderProposal({
      scope,
      store,
      proposal,
      sensitivity: "personal",
      provenance: { kind: "onboarding", sessionId, sectionId: "personal" },
      occurredAt: at,
    });

    return {
      sectionId: "personal",
      status: applied.length > 0 ? "applied" : "unchanged",
      applied: applied.length,
      rejected: rejected.length,
    };
  } catch (error) {
    return failed("personal", error);
  }
};
