import { z } from "zod";

import {
  getCompanyAssumptions,
  parseAssumptionValue,
  setCompanyAssumption,
  type AssumptionKey,
  type CompanyAssumptions,
} from "@/lib/company/assumptions";
import {
  markOnboardingCompleted,
  readCompanyProfile,
  saveCompanyProfile,
  type CompanyProfile,
  type StoredCompanyProfile,
} from "@/lib/company/profile";
import {
  contractPatchSchema,
  type CommunicationContractStore,
  type CommunicationPreferences,
} from "@/lib/founder/contract";
import { createCommunicationContractStore, createFounderBlockStore } from "@/lib/founder/store";
import type { FounderBlock, FounderBlockStore } from "@/lib/founder/types";
import {
  ONBOARDING_QUESTIONS,
  ONBOARDING_SECTIONS,
  currentSection,
  extractionEntryKey,
  readChecklist,
  type OnboardingSectionId,
} from "@/lib/onboarding/checklist";
import { extractSection, type ExtractionDeps, type ExtractionResult } from "@/lib/onboarding/extract";
import {
  createOnboardingSessionStore,
  type OnboardingOpenItem,
  type OnboardingSessionStore,
} from "@/lib/onboarding/sessions";
import { ONBOARDING_ASSUMPTION_KEYS } from "@/lib/onboarding/tools";
import { createSemanticBlockStore } from "@/lib/semantic/store";
import type { SemanticBlock, SemanticBlockStore } from "@/lib/semantic/types";

/**
 * Playback: showing the founder what Sam understood, and letting them fix it.
 *
 * Every correction is recorded as a `corrected` revision, never a `revised`
 * one - the company did not change, the understanding was wrong - so the
 * history can later tell a misreading from a change of plan.
 *
 * Personal topics are returned here, separately, because the only person who
 * can reach this is the founder they belong to.
 */

export interface OnboardingIdentity {
  founderId: string;
  companyId: string;
}

export interface PlaybackTopic {
  key: string;
  title: string;
  body: string;
}

export interface OnboardingPlayback {
  company: StoredCompanyProfile;
  companyTopics: PlaybackTopic[];
  /** The assumptions onboarding can set, as currently stored. */
  assumptions: CompanyAssumptions;
  founderTopics: PlaybackTopic[];
  /** Only ever returned to the founder they belong to. */
  personalTopics: PlaybackTopic[];
  preferences: CommunicationPreferences | null;
  openItems: Record<string, OnboardingOpenItem>;
  /** The interview has covered every section and can be finished. */
  readyToComplete: boolean;
}

export interface PlaybackDeps extends ExtractionDeps {
  semanticStore?: SemanticBlockStore;
  founderBlocks?: FounderBlockStore;
  contracts?: CommunicationContractStore;
  sessions?: OnboardingSessionStore;
  loadAssumptions?: (companyId: string) => Promise<CompanyAssumptions>;
  setAssumption?: (companyId: string, key: AssumptionKey, value: unknown) => Promise<void>;
  loadProfile?: (companyId: string) => Promise<StoredCompanyProfile>;
  saveProfile?: (companyId: string, profile: CompanyProfile) => Promise<void>;
  markCompleted?: (companyId: string, at: string) => Promise<void>;
  now?: () => Date;
}

const resolve = (deps: PlaybackDeps) => ({
  semanticStore: deps.semanticStore ?? createSemanticBlockStore(),
  founderBlocks: deps.founderBlocks ?? createFounderBlockStore(),
  contracts: deps.contracts ?? createCommunicationContractStore(),
  sessions: deps.sessions ?? createOnboardingSessionStore(),
  loadAssumptions: deps.loadAssumptions ?? getCompanyAssumptions,
  setAssumption:
    deps.setAssumption ?? ((companyId: string, key: AssumptionKey, value: unknown) => setCompanyAssumption(companyId, key, value, "founder")),
  loadProfile: deps.loadProfile ?? readCompanyProfile,
  saveProfile: deps.saveProfile ?? saveCompanyProfile,
  markCompleted: deps.markCompleted ?? markOnboardingCompleted,
  now: deps.now ?? (() => new Date()),
});

const toTopic = (block: SemanticBlock | FounderBlock): PlaybackTopic => ({
  key: block.key,
  title: block.title,
  body: block.body,
});

export const loadOnboardingPlayback = async (
  identity: OnboardingIdentity,
  deps: PlaybackDeps = {}
): Promise<OnboardingPlayback> => {
  const d = resolve(deps);
  const [company, companyBlocks, founderBlocks, contract, assumptions, session] = await Promise.all([
    d.loadProfile(identity.companyId),
    d.semanticStore.listCurrentBlocks({ companyId: identity.companyId }, { limit: 30 }),
    d.founderBlocks.listCurrentBlocks({ founderId: identity.founderId }, { includePersonal: true, limit: 30 }),
    d.contracts.getCurrent({ founderId: identity.founderId }),
    d.loadAssumptions(identity.companyId),
    d.sessions.getCurrent(identity),
  ]);

  return {
    company,
    companyTopics: companyBlocks.map(toTopic),
    assumptions: Object.fromEntries(
      ONBOARDING_ASSUMPTION_KEYS.filter((key) => assumptions[key] !== undefined).map((key) => [key, assumptions[key]])
    ),
    founderTopics: founderBlocks.filter((block) => block.sensitivity === "standard").map(toTopic),
    personalTopics: founderBlocks.filter((block) => block.sensitivity === "personal").map(toTopic),
    preferences: contract
      ? {
          badNews: contract.badNews,
          detail: contract.detail,
          recommendations: contract.recommendations,
          pushback: contract.pushback,
          flagOptimisticAssumptions: contract.flagOptimisticAssumptions,
          financeFluency: contract.financeFluency,
          alerts: contract.alerts,
        }
      : null,
    openItems: session?.openItems ?? {},
    readyToComplete: session !== null && currentSection(readChecklist(session.checklist)) === null,
  };
};

const topicKey = z.string().trim().min(1).max(64);
const topicBody = z.string().trim().min(1).max(4000);

export const playbackCorrectionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("company-profile"),
      name: z.string().trim().min(1).max(120).optional(),
      description: z.string().trim().min(1).max(400).optional(),
    })
    .strict(),
  z.object({ kind: z.literal("company-topic"), key: topicKey, body: topicBody }).strict(),
  z.object({ kind: z.literal("founder-topic"), key: topicKey, body: topicBody }).strict(),
  z.object({ kind: z.literal("remove-founder-topic"), key: topicKey }).strict(),
  z.object({ kind: z.literal("preference"), patch: contractPatchSchema }).strict(),
  z.object({ kind: z.literal("assumption"), key: z.enum(ONBOARDING_ASSUMPTION_KEYS), value: z.unknown() }).strict(),
]);

export type PlaybackCorrection = z.infer<typeof playbackCorrectionSchema>;

export class PlaybackCorrectionError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 404
  ) {
    super(message);
    this.name = "PlaybackCorrectionError";
  }
}

const CORRECTION_PROVENANCE = { kind: "founder", actor: "founder", note: "Corrected during onboarding playback" };
const CORRECTION_NOTE = "Corrected by the founder during onboarding.";

/** Applies one correction, then returns the updated playback. */
export const correctPlayback = async (
  identity: OnboardingIdentity,
  correction: PlaybackCorrection,
  deps: PlaybackDeps = {}
): Promise<OnboardingPlayback> => {
  const d = resolve(deps);
  const recordedAt = d.now().toISOString();
  const today = recordedAt.slice(0, 10);

  switch (correction.kind) {
    case "company-profile": {
      if (correction.name === undefined && correction.description === undefined) {
        throw new PlaybackCorrectionError("Give a name, a description, or both.", 400);
      }
      await d.saveProfile(identity.companyId, { name: correction.name, description: correction.description });
      break;
    }

    case "company-topic": {
      const scope = { companyId: identity.companyId };
      const existing = await d.semanticStore.getBlock(scope, { key: correction.key });
      if (!existing) throw new PlaybackCorrectionError(`No company topic "${correction.key}".`);
      if (existing.body.trim() === correction.body) break;

      // Everything but the prose is kept. The summary is dropped rather than
      // kept, because a summary of the old body would now be wrong.
      await d.semanticStore.reviseBlock(scope, {
        key: existing.key,
        title: existing.title,
        body: correction.body,
        labels: existing.labels,
        status: existing.status,
        contextPolicy: existing.contextPolicy,
        salience: existing.salience,
        confidence: existing.confidence,
        asOf: today,
        attributes: existing.attributes,
        provenance: CORRECTION_PROVENANCE,
        changeKind: "corrected",
        recordedAt,
        changeNote: CORRECTION_NOTE,
      });
      break;
    }

    case "founder-topic": {
      const scope = { founderId: identity.founderId };
      const existing = await d.founderBlocks.getBlock(scope, { key: correction.key }, { includePersonal: true });
      if (!existing) throw new PlaybackCorrectionError(`No founder topic "${correction.key}".`);
      if (existing.body.trim() === correction.body) break;

      // Sensitivity is omitted, so a personal topic stays personal.
      await d.founderBlocks.reviseBlock(scope, {
        key: existing.key,
        title: existing.title,
        body: correction.body,
        labels: existing.labels,
        status: existing.status,
        salience: existing.salience,
        confidence: existing.confidence,
        asOf: today,
        attributes: existing.attributes,
        provenance: CORRECTION_PROVENANCE,
        changeKind: "corrected",
        recordedAt,
        changeNote: CORRECTION_NOTE,
      });
      break;
    }

    case "remove-founder-topic": {
      const deleted = await d.founderBlocks.deleteBlock({ founderId: identity.founderId }, { key: correction.key });
      if (!deleted) throw new PlaybackCorrectionError(`No founder topic "${correction.key}".`);
      break;
    }

    case "preference": {
      await d.contracts.revise(
        { founderId: identity.founderId },
        { patch: correction.patch, provenance: CORRECTION_PROVENANCE, changeKind: "corrected", changeNote: CORRECTION_NOTE }
      );
      break;
    }

    case "assumption": {
      await d.setAssumption(identity.companyId, correction.key, parseAssumptionValue(correction.key, correction.value));
      break;
    }
  }

  return loadOnboardingPlayback(identity, deps);
};

export class OnboardingNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OnboardingNotReadyError";
  }
}

export interface CompletedOnboarding {
  sessionId: string;
  completedAt: string;
  /** Questions left for Sam to pick up in conversation. */
  openItems: number;
}

/**
 * Finishes onboarding once every section is covered.
 *
 * Deferred-tier questions nobody asked are recorded as open items first, so
 * they are waiting for Sam to raise in chat rather than silently forgotten.
 */
export const completeOnboarding = async (
  identity: OnboardingIdentity,
  deps: PlaybackDeps = {}
): Promise<CompletedOnboarding> => {
  const d = resolve(deps);
  const session = await d.sessions.getCurrent(identity);
  if (!session) throw new OnboardingNotReadyError("There is no onboarding interview in progress.");

  const view = readChecklist(session.checklist);
  const open = currentSection(view);
  if (open) throw new OnboardingNotReadyError(`Finish the interview first: "${open.title}" is still open.`);

  const at = d.now().toISOString();
  const deferred = Object.fromEntries(
    ONBOARDING_QUESTIONS.filter((question) => question.tier === "deferred" && !view.questions[question.id]).map(
      (question): [string, OnboardingOpenItem] => [question.id, { state: "deferred", at }]
    )
  );

  await d.sessions.record(identity, session.id, { openItems: deferred });
  const finished = await d.sessions.finish(identity, session.id, "completed");
  await d.markCompleted(identity.companyId, at);

  return {
    sessionId: finished.id,
    completedAt: finished.completedAt ?? at,
    openItems: Object.keys(finished.openItems).length,
  };
};

export interface SkippedOnboarding extends CompletedOnboarding {
  /** Sections already talked about, consolidated before skipping. */
  extractions: ExtractionResult[];
}

/**
 * Skips the rest of the interview - or all of it - and lets Sam learn in
 * conversation instead.
 *
 * Nothing already said is lost: any section with conversation that has not
 * been consolidated yet is consolidated now, even if it was not finished.
 * Every question without an answer becomes an open item, deferred, for Sam to
 * raise when it matters. Skipping is not declining, so personal questions are
 * deferred too; the opt-in still applies whenever Sam gets to them.
 */
export const skipOnboarding = async (
  identity: OnboardingIdentity,
  deps: PlaybackDeps = {}
): Promise<SkippedOnboarding> => {
  const d = resolve(deps);
  const session = await d.sessions.start(identity);
  const view = readChecklist(session.checklist);
  const at = d.now().toISOString();

  const extractions: ExtractionResult[] = [];
  for (const section of ONBOARDING_SECTIONS) {
    if (section.sensitive || view.extractedSections.includes(section.id)) continue;
    if (!session.transcript.some((turn) => turn.sectionId === section.id && "text" in turn)) continue;

    extractions.push(
      await extractSection({ identity, sessionId: session.id, section, transcript: session.transcript, deps })
    );
  }

  const openItems = Object.fromEntries(
    ONBOARDING_QUESTIONS.filter((question) => !view.questions[question.id]).map(
      (question): [string, OnboardingOpenItem] => [question.id, { state: "deferred", at }]
    )
  );

  await d.sessions.record(identity, session.id, {
    checklist: {
      "skip:interview": { state: "skipped", at },
      ...Object.fromEntries(
        extractions.map((extraction) => [
          extractionEntryKey(extraction.sectionId as OnboardingSectionId),
          { state: extraction.status, at },
        ])
      ),
    },
    openItems,
  });

  const finished = await d.sessions.finish(identity, session.id, "completed");
  await d.markCompleted(identity.companyId, at);

  return {
    sessionId: finished.id,
    completedAt: finished.completedAt ?? at,
    openItems: Object.keys(finished.openItems).length,
    extractions,
  };
};
