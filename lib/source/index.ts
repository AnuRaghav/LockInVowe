/**
 * The Source Layer.
 *
 * Everything outside this module should import from here rather than reaching
 * into a provider directory - that is what keeps "which provider said this"
 * an implementation detail.
 */
export {
  syncSourceConnection,
  SourceConnectionNotFoundError,
  type SyncConnectionResult,
} from "@/lib/source/ingest";
export {
  getSourceAdapter,
  isSourceProviderId,
  SOURCE_PROVIDER_IDS,
} from "@/lib/source/registry";
export {
  addCounts,
  createSourceStore,
  hashPayload,
  type PagePersistCounts,
  type SourceStore,
} from "@/lib/source/store";
export {
  DEFAULT_CURRENCY,
  decimalToMinor,
  minorToDecimalString,
  minorUnitExponent,
  normalizeCurrency,
} from "@/lib/source/money";
export type {
  NormalizedAccount,
  NormalizedBalanceObservation,
  NormalizedEntry,
  NormalizedRetraction,
  ProviderCategory,
  RawObservation,
  SourceAccountKind,
  SourceConnectionHandle,
  SourceEntryStatus,
  SourceProviderAdapter,
  SourceProviderId,
  SourcePullContext,
  SourceRecordType,
  SourceSyncPage,
} from "@/lib/source/types";
