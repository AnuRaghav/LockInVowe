import { z } from "zod";

import type { SemanticBlock } from "@/lib/semantic/types";

/**
 * The company brief - contracts.
 *
 * A compact synthesis of the company's current operating context: what a good
 * CFO would already know walking into any conversation, without being told.
 *
 * Three properties define it, and each rules something out:
 *
 * - **It is a projection, not a source.** Every claim in it traces to a
 *   semantic block. It can be deleted and rebuilt from state at any time, and
 *   nothing may write to it except the generator. A brief that accumulated
 *   facts of its own would be a second, un-revisable memory.
 * - **It is a synthesis, not a concatenation.** Ten blocks pasted together is
 *   not a brief; it is the context-stuffing this architecture exists to avoid.
 * - **It is small.** Hundreds of tokens. It is paid for on *every* run, so its
 *   size is a standing cost and is capped rather than hoped about.
 *
 * Its sections are not fixed. A company mid-raise deserves a fundraising
 * section; one that has never raised does not. The state decides.
 */

/** One part of the brief. Headings come from the company's state, not a list. */
export const briefSectionSchema = z.object({
  heading: z
    .string()
    .describe(
      "A few words naming what this covers, e.g. 'Financial posture', 'Hiring', 'Acme concentration'. Derived from what the company's state actually contains."
    ),
  body: z
    .string()
    .describe("Two or three sentences. Specific, with the company's real numbers and dates."),
});

export type BriefSection = z.infer<typeof briefSectionSchema>;

export const MAX_BRIEF_SECTIONS = 6;

export const briefDraftSchema = z.object({
  sections: z
    .array(briefSectionSchema)
    .max(MAX_BRIEF_SECTIONS)
    .describe("The highest-leverage current context, most important first."),
});

export type BriefDraft = z.infer<typeof briefDraftSchema>;

/** A generated, stored brief. */
export interface CompanyBrief {
  id: string;
  version: number;
  /** The brief as the model reads it. Rendered from {@link sections}. */
  body: string;
  sections: BriefSection[];
  /** Digest of the blocks this was built from. See `generate.ts`. */
  fingerprint: string;
  sourceBlockIds: string[];
  /** `{kind: 'model'|'deterministic', model?}`. A fallback brief must be tellable. */
  generator: Record<string, unknown>;
  generatedAt: string;
}

export interface BriefWriteRequest {
  /** The blocks that qualified for the brief, most load-bearing first. */
  blocks: SemanticBlock[];
  /** Character ceiling for the rendered brief. */
  maxChars: number;
}

/**
 * Whatever turns qualifying blocks into a brief.
 *
 * An interface so CI can generate a brief deterministically, and so a process
 * without an API key still gets a usable one rather than none.
 */
export interface CompanyBriefWriter {
  write(request: BriefWriteRequest): Promise<BriefDraft>;
}
