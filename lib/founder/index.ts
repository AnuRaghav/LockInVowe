/**
 * The Founder Model.
 *
 * Who the person running the company is, and how they want to be worked with.
 * Scoped by founder (the authenticated user), never by company.
 *
 *   types.ts       Founder blocks: prose, revised in full, history kept.
 *   contract.ts    The communication contract: the few typed preferences Sam
 *                  renders into every run for this founder.
 *   store.ts       The only module that knows this is Postgres.
 *   in-memory.ts   The same rules without a database.
 *
 * The rule that matters most: personal blocks are invisible to every read that
 * does not pass `includePersonal: true`.
 */

export {
  FounderSensitivityDowngradeError,
  UnknownFounderBlockError,
  type FounderBlock,
  type FounderBlockRef,
  type FounderBlockSensitivity,
  type FounderBlockStore,
  type FounderHistoryQuery,
  type FounderReadOptions,
  type FounderRevision,
  type FounderScope,
  type ListFounderBlocksQuery,
  type ReviseFounderBlockInput,
  type RevisedFounderBlock,
  type SearchFounderBlocksQuery,
} from "@/lib/founder/types";

export {
  ALERT_METRICS,
  BAD_NEWS_DELIVERY,
  DETAIL_LEVELS,
  FINANCE_FLUENCY,
  MAX_FOUNDER_ALERTS,
  PUSHBACK_STYLES,
  RECOMMENDATION_STYLES,
  alertSchema,
  applyContractPatch,
  contractPatchSchema,
  type CommunicationContract,
  type CommunicationContractPatch,
  type CommunicationContractStore,
  type CommunicationPreferences,
  type FounderAlert,
  type ReviseContractInput,
} from "@/lib/founder/contract";

export { createCommunicationContractStore, createFounderBlockStore } from "@/lib/founder/store";
export { InMemoryCommunicationContractStore, InMemoryFounderBlockStore } from "@/lib/founder/in-memory";
