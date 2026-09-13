import { createHash } from "node:crypto";

import { createServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/lib/supabase/types";
import type {
  NormalizedBalanceObservation,
  RawObservation,
  SourceConnectionHandle,
  SourceProviderId,
  SourceSyncPage,
} from "@/lib/source/types";

/**
 * Persistence for the Source Layer.
 *
 * The only module that writes the `source_*` tables. Adapters produce neutral
 * observations and know nothing about storage; this turns them into rows.
 *
 * Two invariants it exists to hold:
 *
 * - **Tier 0 is append-only.** Raw payloads are inserted, never updated and
 *   never deleted, and the uniqueness key includes a content hash so a changed
 *   payload is kept *alongside* the one it changed from.
 * - **Tier 1 is idempotent.** Every projection is upserted on its provider's
 *   natural key, which is what lets Rho re-read the same window on every sync
 *   and Plaid replay a `modified` transaction without either producing a
 *   duplicate.
 *
 * The client is typed against the generated `Database`, so every column name
 * below is checked at compile time rather than at 3am against production.
 */

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * Domain values on their way into a `jsonb` column.
 *
 * The Source Layer's own types keep these deliberately opaque - a raw payload
 * is `unknown`, a provider attribute bag is `Record<string, unknown>` - so that
 * nothing upstream depends on their shape. Postgres wants `Json`. Asserting the
 * bridge here, at the one boundary that actually talks to the database, is
 * preferable to weakening the domain types or making `lib/source/types.ts`
 * import from the generated schema.
 *
 * Safe by construction: every value that reaches this point was decoded from a
 * provider's JSON response or built from literals in an adapter.
 */
const asJson = (value: unknown): Json => value as Json;

/** Counts of what one page actually wrote. Reported on the sync run. */
export interface PagePersistCounts {
  rawRecords: number;
  accounts: number;
  balances: number;
  entries: number;
  retractions: number;
}

const emptyCounts = (): PagePersistCounts => ({
  rawRecords: 0,
  accounts: 0,
  balances: 0,
  entries: 0,
  retractions: 0,
});

export const addCounts = (
  a: PagePersistCounts,
  b: PagePersistCounts
): PagePersistCounts => ({
  rawRecords: a.rawRecords + b.rawRecords,
  accounts: a.accounts + b.accounts,
  balances: a.balances + b.balances,
  entries: a.entries + b.entries,
  retractions: a.retractions + b.retractions,
});

export interface StartedSyncRun {
  syncId: string;
}

export interface SourceStore {
  loadConnection(
    companyId: string,
    connectionId: string
  ): Promise<SourceConnectionHandle | null>;
  startSyncRun(connection: SourceConnectionHandle): Promise<StartedSyncRun>;
  persistPage(input: {
    connection: SourceConnectionHandle;
    syncId: string;
    page: SourceSyncPage;
  }): Promise<PagePersistCounts>;
  completeSyncRun(input: {
    connection: SourceConnectionHandle;
    syncId: string;
    syncStateAfter: Record<string, unknown>;
    counts: PagePersistCounts;
    finishedAt: Date;
  }): Promise<void>;
  failSyncRun(input: {
    connection: SourceConnectionHandle;
    syncId: string;
    error: string;
    counts: PagePersistCounts;
    finishedAt: Date;
  }): Promise<void>;
}

/** Stable content hash, so an unchanged payload is recognised as unchanged. */
export const hashPayload = (payload: unknown): string =>
  createHash("sha256").update(stableStringify(payload)).digest("hex");

/**
 * JSON with object keys sorted, recursively.
 *
 * `JSON.stringify` preserves insertion order, so two identical payloads that
 * arrived with their keys in a different order would hash differently and be
 * stored as a spurious revision. Sorting removes that.
 */
const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);

  return `{${entries.join(",")}}`;
};

const rawKey = (observation: { recordType: string; providerRecordId: string }, hash: string) =>
  `${observation.recordType}:${observation.providerRecordId}:${hash}`;

export const createSourceStore = (
  client?: ServiceClient
): SourceStore => {
  const supabase = client ?? createServiceClient();

  /**
   * Inserts Tier 0 payloads and returns their ids.
   *
   * `ignoreDuplicates: true` makes a re-observation of an unchanged payload a
   * no-op, so the ids of rows that already existed are read back separately.
   */
  const persistRawRecords = async (
    connection: SourceConnectionHandle,
    syncId: string,
    observations: RawObservation[]
  ): Promise<{ ids: Map<string, string>; inserted: number }> => {
    const ids = new Map<string, string>();
    if (observations.length === 0) return { ids, inserted: 0 };

    const rows = observations.map((observation) => ({
      company_id: connection.companyId,
      connection_id: connection.id,
      sync_id: syncId,
      provider: connection.provider,
      record_type: observation.recordType,
      provider_record_id: observation.providerRecordId,
      payload: asJson(observation.payload),
      payload_hash: hashPayload(observation.payload),
      observed_at: observation.observedAt,
    }));

    const { data, error } = await supabase
      .from("source_raw_records")
      .upsert(rows, {
        onConflict: "connection_id,record_type,provider_record_id,payload_hash",
        ignoreDuplicates: true,
      })
      .select("id, record_type, provider_record_id, payload_hash");

    if (error) throw error;

    for (const row of data ?? []) {
      ids.set(
        rawKey(
          { recordType: row.record_type, providerRecordId: row.provider_record_id },
          row.payload_hash
        ),
        row.id
      );
    }

    const inserted = data?.length ?? 0;

    // Rows that already existed were skipped by the upsert and so are absent
    // from `data`. Read their ids back so every projection can still point at
    // the raw record it came from.
    const missing = rows.filter(
      (row) =>
        !ids.has(
          rawKey(
            { recordType: row.record_type, providerRecordId: row.provider_record_id },
            row.payload_hash
          )
        )
    );

    if (missing.length > 0) {
      const { data: existing, error: existingError } = await supabase
        .from("source_raw_records")
        .select("id, record_type, provider_record_id, payload_hash")
        .eq("connection_id", connection.id)
        .in("payload_hash", [...new Set(missing.map((row) => row.payload_hash))]);

      if (existingError) throw existingError;

      for (const row of existing ?? []) {
        ids.set(
          rawKey(
            { recordType: row.record_type, providerRecordId: row.provider_record_id },
            row.payload_hash
          ),
          row.id
        );
      }
    }

    return { ids, inserted };
  };

  /** Every account this connection has ever reported, by provider id. */
  const loadAccountIds = async (
    connection: SourceConnectionHandle
  ): Promise<Map<string, string>> => {
    const { data, error } = await supabase
      .from("source_accounts")
      .select("id, provider_account_id")
      .eq("connection_id", connection.id);

    if (error) throw error;

    return new Map((data ?? []).map((row) => [row.provider_account_id, row.id]));
  };

  /**
   * Appends balance observations, skipping ones identical to the account's most
   * recent reading.
   *
   * Rho is re-read in full on every sync and Plaid repeats balances on every
   * page, so without this the table would grow by one row per account per sync
   * whether or not anything moved. The dedupe is on value, not time: a balance
   * that has genuinely not changed is not new information.
   */
  const persistBalances = async (
    connection: SourceConnectionHandle,
    syncId: string,
    balances: NormalizedBalanceObservation[],
    accountIds: Map<string, string>,
    /** Evidence for each balance: the account payload it was read from. */
    rawIdByProviderAccountId: Map<string, string | null>
  ): Promise<number> => {
    if (balances.length === 0) return 0;

    const candidates = balances.flatMap((balance) => {
      const accountId = accountIds.get(balance.providerAccountId);
      return accountId ? [{ balance, accountId }] : [];
    });

    if (candidates.length === 0) return 0;

    const latest = await Promise.all(
      candidates.map(async ({ accountId }) => {
        const { data, error } = await supabase
          .from("source_balance_observations")
          .select("current_minor, available_minor, currency")
          .eq("account_id", accountId)
          .order("observed_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) throw error;
        return { accountId, previous: data };
      })
    );

    const previousByAccount = new Map(latest.map((row) => [row.accountId, row.previous]));

    const rows = candidates
      .filter(({ balance, accountId }) => {
        const previous = previousByAccount.get(accountId);
        if (!previous) return true;

        return (
          Number(previous.current_minor) !== balance.currentMinor ||
          (previous.available_minor === null ? null : Number(previous.available_minor)) !==
            balance.availableMinor ||
          previous.currency !== balance.currency
        );
      })
      .map(({ balance, accountId }) => ({
        company_id: connection.companyId,
        account_id: accountId,
        sync_id: syncId,
        observed_at: balance.observedAt,
        current_minor: balance.currentMinor,
        available_minor: balance.availableMinor,
        currency: balance.currency,
        raw_record_id: rawIdByProviderAccountId.get(balance.providerAccountId) ?? null,
      }));

    if (rows.length === 0) return 0;

    const { error } = await supabase.from("source_balance_observations").insert(rows);
    if (error) throw error;

    return rows.length;
  };

  return {
    async loadConnection(companyId, connectionId) {
      const { data, error } = await supabase
        .from("source_connections")
        .select("id, company_id, provider, provider_connection_id, credentials, sync_state")
        .eq("id", connectionId)
        .eq("company_id", companyId)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      return {
        id: data.id,
        companyId: data.company_id,
        provider: data.provider as SourceProviderId,
        providerConnectionId: data.provider_connection_id,
        credentials: (data.credentials ?? {}) as Record<string, unknown>,
        syncState: (data.sync_state ?? {}) as Record<string, unknown>,
      };
    },

    async startSyncRun(connection) {
      const { data, error } = await supabase
        .from("source_sync_runs")
        .insert({
          company_id: connection.companyId,
          connection_id: connection.id,
          provider: connection.provider,
          status: "running",
          sync_state_before: asJson(connection.syncState),
        })
        .select("id")
        .single();

      if (error) throw error;
      return { syncId: data.id };
    },

    async persistPage({ connection, syncId, page }) {
      const counts = emptyCounts();

      const observations: RawObservation[] = [
        ...(page.accounts ?? []).map((account) => account.raw),
        ...(page.entries ?? []).map((entry) => entry.raw),
      ];

      const { ids: rawIds, inserted } = await persistRawRecords(
        connection,
        syncId,
        observations
      );
      counts.rawRecords = inserted;

      const rawIdFor = (observation: RawObservation): string | null =>
        rawIds.get(rawKey(observation, hashPayload(observation.payload))) ?? null;

      if (page.accounts?.length) {
        const { error } = await supabase.from("source_accounts").upsert(
          page.accounts.map((account) => ({
            company_id: connection.companyId,
            connection_id: connection.id,
            provider: connection.provider,
            provider_account_id: account.providerAccountId,
            kind: account.kind,
            name: account.name,
            mask: account.mask,
            currency: account.currency,
            provider_attributes: asJson(account.providerAttributes),
            latest_raw_record_id: rawIdFor(account.raw),
            last_observed_at: account.raw.observedAt,
            last_seen_sync_id: syncId,
          })),
          { onConflict: "connection_id,provider_account_id" }
        );

        if (error) throw error;
        counts.accounts = page.accounts.length;
      }

      const needsAccounts = Boolean(page.balances?.length || page.entries?.length);
      const accountIds: Map<string, string> = needsAccounts
        ? await loadAccountIds(connection)
        : new Map();

      if (page.balances?.length) {
        // A balance's evidence is the account payload it was read from.
        const balanceRawIds = new Map<string, string | null>(
          (page.accounts ?? []).map((account) => [
            account.providerAccountId,
            rawIdFor(account.raw),
          ])
        );

        counts.balances = await persistBalances(
          connection,
          syncId,
          page.balances,
          accountIds,
          balanceRawIds
        );
      }

      if (page.entries?.length) {
        const rows = page.entries.flatMap((entry) => {
          const accountId = accountIds.get(entry.providerAccountId);
          // An entry whose account this connection has never reported is a
          // provider inconsistency, not something to swallow: dropping it
          // silently is how a ledger quietly loses money.
          if (!accountId) {
            throw new Error(
              `Entry ${entry.providerEntryId} references unknown account ${entry.providerAccountId} on connection ${connection.id}.`
            );
          }

          return [
            {
              company_id: connection.companyId,
              connection_id: connection.id,
              account_id: accountId,
              provider: connection.provider,
              provider_entry_id: entry.providerEntryId,
              movement_key: entry.movementKey,
              amount_minor: entry.amountMinor,
              currency: entry.currency,
              status: entry.status,
              initiated_at: entry.initiatedAt,
              posted_at: entry.postedAt,
              occurred_on: entry.occurredOn,
              description: entry.description,
              counterparty_name: entry.counterpartyName,
              provider_category: asJson(entry.providerCategory),
              provider_attributes: asJson(entry.providerAttributes),
              supersedes_provider_entry_id: entry.supersedesProviderEntryId,
              latest_raw_record_id: rawIdFor(entry.raw),
              last_observed_at: entry.raw.observedAt,
              last_seen_sync_id: syncId,
            },
          ];
        });

        const { error } = await supabase
          .from("source_entries")
          .upsert(rows, { onConflict: "connection_id,provider_entry_id" });

        if (error) throw error;
        counts.entries = rows.length;
      }

      if (page.retractions?.length) {
        // A tombstone, never a delete. The row stays so a figure produced
        // before the retraction can still be explained afterwards.
        const { error } = await supabase
          .from("source_entries")
          .update({ withdrawn_at: page.retractions[0].observedAt, last_seen_sync_id: syncId })
          .eq("connection_id", connection.id)
          .eq("company_id", connection.companyId)
          .in(
            "provider_entry_id",
            page.retractions.map((retraction) => retraction.providerEntryId)
          );

        if (error) throw error;
        counts.retractions = page.retractions.length;
      }

      return counts;
    },

    async completeSyncRun({ connection, syncId, syncStateAfter, counts, finishedAt }) {
      const { error: runError } = await supabase
        .from("source_sync_runs")
        .update({
          status: "succeeded",
          finished_at: finishedAt.toISOString(),
          sync_state_after: asJson(syncStateAfter),
          counts: asJson(counts),
        })
        .eq("id", syncId);

      if (runError) throw runError;

      const { error } = await supabase
        .from("source_connections")
        .update({
          sync_state: asJson(syncStateAfter),
          last_synced_at: finishedAt.toISOString(),
          last_sync_error: null,
          status: "active",
          updated_at: finishedAt.toISOString(),
        })
        .eq("id", connection.id);

      if (error) throw error;
    },

    async failSyncRun({ connection, syncId, error, counts, finishedAt }) {
      // The sync state is deliberately not advanced: a failed run must be safe
      // to retry from where the last successful one left off.
      const { error: runError } = await supabase
        .from("source_sync_runs")
        .update({
          status: "failed",
          finished_at: finishedAt.toISOString(),
          counts: asJson(counts),
          error,
        })
        .eq("id", syncId);

      if (runError) throw runError;

      await supabase
        .from("source_connections")
        .update({
          status: "error",
          last_sync_error: error,
          updated_at: finishedAt.toISOString(),
        })
        .eq("id", connection.id);
    },
  };
};
