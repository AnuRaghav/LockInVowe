/**
 * The company brief: baseline operating context for every Sam run.
 *
 * A materialized projection of {@link SemanticBlock} state, not a second source
 * of truth. See `generate.ts` for what qualifies, when it is rebuilt, and what
 * happens when no model is available.
 */
export {
  BRIEF_SALIENCE_FLOOR,
  MAX_BRIEF_CHARS,
  briefFingerprint,
  briefIsStale,
  createDeterministicBriefWriter,
  createModelBriefWriter,
  ensureCompanyBrief,
  fitBrief,
  getCompanyBrief,
  renderBrief,
  selectBriefBlocks,
  type EnsureCompanyBriefInput,
  type EnsureCompanyBriefResult,
} from "@/lib/semantic/brief/generate";

export {
  createCompanyBriefStore,
  type CompanyBriefStore,
  type SaveCompanyBriefInput,
} from "@/lib/semantic/brief/store";

export {
  COMPANY_BRIEF_PROMPT,
  renderBriefRequest,
} from "@/lib/semantic/brief/prompt";

export {
  MAX_BRIEF_SECTIONS,
  briefDraftSchema,
  briefSectionSchema,
  type BriefDraft,
  type BriefSection,
  type BriefWriteRequest,
  type CompanyBrief,
  type CompanyBriefWriter,
} from "@/lib/semantic/brief/types";
