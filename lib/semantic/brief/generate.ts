import { createHash } from "node:crypto";

import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { Runnable } from "@langchain/core/runnables";

import {
  COMPANY_BRIEF_PROMPT,
  renderBriefRequest,
} from "@/lib/semantic/brief/prompt";
import {
  createCompanyBriefStore,
  type CompanyBriefStore,
} from "@/lib/semantic/brief/store";
import {
  MAX_BRIEF_SECTIONS,
  briefDraftSchema,
  type BriefDraft,
  type BriefSection,
  type CompanyBrief,
  type CompanyBriefWriter,
} from "@/lib/semantic/brief/types";
import { createSemanticModel, hasSemanticModel } from "@/lib/semantic/model";
import { createSemanticBlockStore } from "@/lib/semantic/store";
import {
  CURRENT_STATUSES,
  type SemanticBlock,
  type SemanticBlockReader,
  type SemanticScope,
} from "@/lib/semantic/types";

/**
 * Producing and maintaining the company brief.
 *
 * Three decisions are worth reading before changing anything here.
 *
 * **What qualifies.** A block earns a place in the brief by being marked
 * `always` or by being salient enough to matter in conversations that are not
 * about it. Everything else stays retrievable but out of the baseline - which
 * is the difference between a brief and a context dump.
 *
 * **When it regenerates.** Not on every change. The fingerprint covers only the
 * qualifying blocks and only the fields that would alter the brief, so a typo
 * fix on a background block changes nothing, while a hiring freeze changes the
 * fingerprint and the brief is rebuilt. That makes "material change" a
 * deterministic test rather than a judgement call made twice.
 *
 * **What happens without a model.** A deterministic composer, not an empty
 * brief. Sam opening with a plainly-composed brief is far better than Sam
 * opening blind, and the `generator` field records which one wrote it so the
 * two are never confused.
 */

/** Blocks at or above this salience make the baseline even without `always`. */
export const BRIEF_SALIENCE_FLOOR = 0.6;

/**
 * The standing cost of the brief, in characters (~500 tokens).
 *
 * This is charged on every Sam run. Raising it is a real decision about every
 * conversation the product will ever have, not a formatting preference.
 */
export const MAX_BRIEF_CHARS = 2000;

/** The blocks that earn a place in the baseline context. */
export const selectBriefBlocks = async (
  reader: SemanticBlockReader,
  scope: SemanticScope
): Promise<SemanticBlock[]> => {
  const blocks = await reader.listCurrentBlocks(scope, {
    statuses: [...CURRENT_STATUSES],
    limit: 50,
  });

  return blocks.filter(
    (block) =>
      block.contextPolicy === "always" ||
      (block.contextPolicy === "when_relevant" && block.salience >= BRIEF_SALIENCE_FLOOR)
  );
};

/**
 * Digest of the inputs a brief was built from.
 *
 * Covers identity, revision, lifecycle, and selection - everything that would
 * change what the brief should say - and nothing else. Sorted by block id so
 * two runs over the same state always agree.
 */
export const briefFingerprint = (blocks: SemanticBlock[]): string => {
  const material = [...blocks]
    .map((block) =>
      [block.id, block.revision, block.status, block.salience, block.contextPolicy].join(":")
    )
    .sort()
    .join("|");

  return createHash("sha256").update(material).digest("hex").slice(0, 32);
};

/** Whether the current brief still reflects the state it was built from. */
export const briefIsStale = (
  brief: CompanyBrief | null,
  blocks: SemanticBlock[]
): boolean => brief === null || brief.fingerprint !== briefFingerprint(blocks);

/** One rendering of sections into the text Sam actually sees. */
export const renderBrief = (sections: BriefSection[]): string =>
  sections
    .map((section) => `${section.heading}: ${section.body.trim()}`)
    .join("\n");

/**
 * Enforces the ceiling by dropping whole sections from the end.
 *
 * Truncating mid-sentence would leave a half-stated fact in front of a model
 * that has been told to treat its context as true - which is a worse failure
 * than one fewer section. Sections arrive most-important-first, so what is lost
 * is what mattered least.
 */
export const fitBrief = (
  sections: BriefSection[],
  maxChars: number = MAX_BRIEF_CHARS
): { sections: BriefSection[]; body: string } => {
  const kept: BriefSection[] = [];

  for (const section of sections.slice(0, MAX_BRIEF_SECTIONS)) {
    const candidate = [...kept, section];
    if (renderBrief(candidate).length > maxChars && kept.length > 0) break;
    kept.push(section);
  }

  let body = renderBrief(kept);

  // A single section over the cap is the one case where there is nothing left
  // to drop; trim its prose at a sentence boundary rather than ship it whole.
  if (body.length > maxChars && kept.length === 1) {
    const trimmed = body.slice(0, maxChars);
    const lastStop = trimmed.lastIndexOf(". ");
    body = lastStop > maxChars / 2 ? trimmed.slice(0, lastStop + 1) : trimmed.trimEnd();
    kept[0] = { heading: kept[0].heading, body: body.slice(kept[0].heading.length + 2) };
  }

  return { sections: kept, body };
};

export interface ModelBriefWriterOptions {
  model?: BaseChatModel;
}

export const createModelBriefWriter = (
  options: ModelBriefWriterOptions = {}
): CompanyBriefWriter => {
  let structured: Runnable<BaseLanguageModelInput, BriefDraft> | null = null;

  const model = (): Runnable<BaseLanguageModelInput, BriefDraft> => {
    if (structured) return structured;

    // See the note in `update/proposer.ts`: the annotation is what lets the
    // overloaded `withStructuredOutput` resolve.
    const chat: BaseChatModel = options.model ?? createSemanticModel();

    structured = chat.withStructuredOutput<BriefDraft>(briefDraftSchema, {
      name: "write_company_brief",
    });

    return structured;
  };

  return {
    async write(request) {
      const result = await model().invoke([
        new SystemMessage(COMPANY_BRIEF_PROMPT),
        new HumanMessage(renderBriefRequest(request)),
      ]);

      return briefDraftSchema.parse(result);
    },
  };
};

/**
 * Composes a brief without a model.
 *
 * Uses each block's own one-line summary, falling back to the first sentence of
 * its body. That is not synthesis and does not pretend to be - it is the
 * honest, no-API-key version, and `generator.kind` says so on the stored row.
 */
export const createDeterministicBriefWriter = (): CompanyBriefWriter => ({
  async write({ blocks }) {
    return {
      sections: blocks.slice(0, MAX_BRIEF_SECTIONS).map((block) => ({
        heading: block.title,
        body: block.summary ?? firstSentence(block.body),
      })),
    };
  },
});

const firstSentence = (text: string): string => {
  const match = text.match(/^.*?[.!?](\s|$)/);
  return (match ? match[0] : text).trim();
};

export interface EnsureCompanyBriefInput {
  scope: SemanticScope;
  reader?: SemanticBlockReader;
  briefs?: CompanyBriefStore;
  writer?: CompanyBriefWriter;
  /** Regenerate even when the fingerprint matches. */
  force?: boolean;
  maxChars?: number;
}

export interface EnsureCompanyBriefResult {
  brief: CompanyBrief | null;
  /** Whether this call wrote a new version. */
  regenerated: boolean;
}

const defaultWriter = (): CompanyBriefWriter =>
  hasSemanticModel() ? createModelBriefWriter() : createDeterministicBriefWriter();

/**
 * Returns the current brief, regenerating it only if the state it summarizes
 * has materially moved.
 *
 * Safe to call on a hot path: the common case is one indexed read of the
 * qualifying blocks and one of the brief, a fingerprint comparison, and no
 * model call at all.
 */
export const ensureCompanyBrief = async ({
  scope,
  reader,
  briefs,
  writer,
  force = false,
  maxChars = MAX_BRIEF_CHARS,
}: EnsureCompanyBriefInput): Promise<EnsureCompanyBriefResult> => {
  const blocks = reader ?? createSemanticBlockStore();
  const store = briefs ?? createCompanyBriefStore();

  const [qualifying, current] = await Promise.all([
    selectBriefBlocks(blocks, scope),
    store.getCurrent(scope),
  ]);

  if (qualifying.length === 0) {
    // Nothing has earned baseline context yet. An empty brief is the truthful
    // answer; inventing one from low-salience blocks would be worse than none.
    return { brief: current, regenerated: false };
  }

  if (!force && !briefIsStale(current, qualifying)) {
    return { brief: current, regenerated: false };
  }

  const draft = await (writer ?? defaultWriter()).write({ blocks: qualifying, maxChars });
  const { sections, body } = fitBrief(draft.sections, maxChars);

  if (sections.length === 0) return { brief: current, regenerated: false };

  const brief = await store.save(scope, {
    body,
    sections,
    fingerprint: briefFingerprint(qualifying),
    sourceBlockIds: qualifying.map((block) => block.id),
    generator: writer
      ? { kind: "injected" }
      : hasSemanticModel()
        ? { kind: "model" }
        : { kind: "deterministic" },
  });

  return { brief, regenerated: true };
};

/** The current brief without generating one. For readers on a hot path. */
export const getCompanyBrief = async (
  scope: SemanticScope,
  briefs: CompanyBriefStore = createCompanyBriefStore()
): Promise<CompanyBrief | null> => briefs.getCurrent(scope);
