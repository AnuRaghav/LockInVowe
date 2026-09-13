import { createPlaidAdapter } from "@/lib/source/plaid/adapter";
import { createRhoAdapter } from "@/lib/source/rho/adapter";
import type { SourceProviderAdapter, SourceProviderId } from "@/lib/source/types";

/**
 * The provider registry.
 *
 * The single place that decides which providers the Source Layer can ingest
 * from. Adding Stripe or a payroll system is a new adapter plus a line here;
 * nothing above this layer changes, because nothing above it names a provider.
 */
const ADAPTERS: Record<SourceProviderId, () => SourceProviderAdapter> = {
  plaid: () => createPlaidAdapter(),
  rho: () => createRhoAdapter(),
};

export const getSourceAdapter = (provider: SourceProviderId): SourceProviderAdapter => {
  const factory = ADAPTERS[provider];
  if (!factory) throw new Error(`No Source Layer adapter registered for "${provider}".`);
  return factory();
};

export const SOURCE_PROVIDER_IDS = Object.keys(ADAPTERS) as SourceProviderId[];

export const isSourceProviderId = (value: unknown): value is SourceProviderId =>
  typeof value === "string" && value in ADAPTERS;
