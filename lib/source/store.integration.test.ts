import { beforeAll, describe, expect, it } from "vitest";

import { syncSourceConnection } from "@/lib/source/ingest";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * End-to-end: live Rho sandbox -> adapter -> store -> local Postgres.
 *
 * Opt-in, because it needs a running `supabase start` and reaches the network:
 *
 *   SUPABASE_INTEGRATION=1 npm test
 *
 * This is the only check that exercises the actual SQL - conflict targets,
 * composite foreign keys, jsonb round-trips, and the append-only guarantees -
 * rather than a fake store. The unit tests can all pass against a schema that
 * does not work.
 */
const enabled = Boolean(process.env.SUPABASE_INTEGRATION);

const COMPANY_ID = "00000000-0000-4000-8000-0000000000ee";

describe.skipIf(!enabled)("Source Layer against Postgres", () => {
  const supabase = enabled ? createServiceClient() : (null as never);
  let connectionId: string;

  beforeAll(async () => {
    // Cascades clear accounts, entries, balances, raw records, and sync runs.
    await supabase.from("source_connections").delete().eq("company_id", COMPANY_ID);

    const { data, error } = await supabase
      .from("source_connections")
      .insert({
        company_id: COMPANY_ID,
        provider: "rho",
        provider_connection_id: "rho_integration_test",
        display_name: "Rho (sandbox)",
        credentials: { api_token: "rhobat_integration_test", environment: "sandbox" },
      })
      .select("id")
      .single();

    if (error) throw error;
    connectionId = data.id;
  }, 60_000);

  it("ingests real Rho data and stores it in normalized form", async () => {
    const result = await syncSourceConnection({ companyId: COMPANY_ID, connectionId });

    expect(result.counts.accounts).toBeGreaterThan(0);
    expect(result.counts.entries).toBeGreaterThan(0);
    expect(result.counts.rawRecords).toBeGreaterThan(0);
    expect(result.syncState.watermark).toBeTruthy();

    const { data: entries } = await supabase
      .from("source_entries")
      .select("amount_minor, currency, status, occurred_on, movement_key, provider_category")
      .eq("company_id", COMPANY_ID);

    expect(entries?.length).toBeGreaterThan(0);
    for (const entry of entries ?? []) {
      // bigint comes back as a JS number here; the point is that it is a whole
      // count of minor units, never a decimal.
      expect(Number.isInteger(Number(entry.amount_minor))).toBe(true);
      expect(entry.currency).toHaveLength(3);
      expect(["pending", "posted", "failed", "scheduled"]).toContain(entry.status);
      expect(entry.provider_category).toMatchObject({ taxonomy: "rho.transaction_type" });
    }
  }, 120_000);

  it("is idempotent: a second sync adds no duplicate rows", async () => {
    const before = await counts(supabase);
    const result = await syncSourceConnection({ companyId: COMPANY_ID, connectionId });
    const after = await counts(supabase);

    // The provider was re-read in full (Rho has no diff endpoint), so the sync
    // did work...
    expect(result.counts.entries).toBeGreaterThan(0);
    // ...but nothing was duplicated, because everything upserts on its natural
    // key and unchanged raw payloads hash to rows that already exist.
    expect(after.accounts).toBe(before.accounts);
    expect(after.entries).toBe(before.entries);
    expect(after.rawRecords).toBe(before.rawRecords);
    // And an unchanged balance is not re-observed.
    expect(after.balances).toBe(before.balances);
  }, 120_000);

  it("records both runs with their provenance", async () => {
    const { data: runs } = await supabase
      .from("source_sync_runs")
      .select("status, counts, sync_state_after, finished_at")
      .eq("company_id", COMPANY_ID)
      .order("started_at", { ascending: true });

    expect(runs?.length).toBe(2);
    expect(runs?.every((run) => run.status === "succeeded")).toBe(true);
    expect(runs?.every((run) => run.finished_at)).toBe(true);
  });

  it("lets every entry trace back to the raw payload it came from", async () => {
    const { data } = await supabase
      .from("source_entries")
      .select("provider_entry_id, latest_raw_record_id, source_raw_records(payload, observed_at)")
      .eq("company_id", COMPANY_ID)
      .limit(5);

    expect(data?.length).toBeGreaterThan(0);
    for (const entry of data ?? []) {
      expect(entry.latest_raw_record_id).toBeTruthy();
      const raw = entry.source_raw_records as { payload: { id: string } } | null;
      // The evidence is the provider's own payload, verbatim.
      expect(raw?.payload.id).toBe(entry.provider_entry_id);
    }
  });

  it("preserves Rho's movement link, with both legs summing to zero", async () => {
    const { data } = await supabase
      .from("source_entries")
      .select("movement_key, amount_minor")
      .eq("company_id", COMPANY_ID)
      .not("movement_key", "is", null);

    const byMovement = new Map<string, number[]>();
    for (const row of data ?? []) {
      const key = row.movement_key as string;
      byMovement.set(key, [...(byMovement.get(key) ?? []), Number(row.amount_minor)]);
    }

    const pairs = [...byMovement.values()].filter((amounts) => amounts.length === 2);
    expect(pairs.length).toBeGreaterThan(0);
    // A transfer moves money between two accounts the company owns, so the two
    // legs cancel. This is what makes it identifiable rather than guessable.
    for (const [a, b] of pairs) expect(a + b).toBe(0);
  });

  it("refuses to attribute an account to a different company than its connection", async () => {
    const { error } = await supabase.from("source_accounts").insert({
      company_id: "00000000-0000-4000-8000-0000000000ff",
      connection_id: connectionId,
      provider: "rho",
      provider_account_id: "smuggled",
      kind: "checking",
      currency: "USD",
    });

    // The composite foreign key makes cross-tenant attribution impossible at
    // the schema level, not merely discouraged in application code.
    expect(error?.code).toBe("23503");
  });

  it("denies anonymous access, because RLS is on with no policies", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data } = await anon.from("source_entries").select("id").limit(1);
    expect(data ?? []).toHaveLength(0);
  });
});

const counts = async (supabase: ReturnType<typeof createServiceClient>) => {
  const table = async (name: "source_accounts" | "source_entries" | "source_raw_records" | "source_balance_observations") => {
    const { count } = await supabase
      .from(name)
      .select("id", { count: "exact", head: true })
      .eq("company_id", COMPANY_ID);
    return count ?? 0;
  };

  return {
    accounts: await table("source_accounts"),
    entries: await table("source_entries"),
    rawRecords: await table("source_raw_records"),
    balances: await table("source_balance_observations"),
  };
};

/**
 * The lifecycle guarantees, driven through the real store with a synthetic
 * adapter. A fake provider is the right tool here: what is under test is the
 * SQL - append-only Tier 0 and the retraction tombstone - not a provider.
 */
describe.skipIf(!enabled)("Source Layer lifecycle in Postgres", () => {
  const supabase = enabled ? createServiceClient() : (null as never);
  const COMPANY = "00000000-0000-4000-8000-0000000000dd";
  let connectionId: string;

  const account = (observedAt: string) => ({
    providerAccountId: "acct_1",
    kind: "checking" as const,
    name: "Operating",
    mask: "0001",
    currency: "USD",
    providerAttributes: { type: "depository" },
    raw: {
      recordType: "account" as const,
      providerRecordId: "acct_1",
      payload: { account_id: "acct_1", balances: { current: 10 } },
      observedAt,
    },
  });

  const entry = (amountMinor: number, status: "pending" | "posted", observedAt: string) => ({
    providerEntryId: "txn_1",
    providerAccountId: "acct_1",
    movementKey: null,
    amountMinor,
    currency: "USD",
    status,
    initiatedAt: null,
    postedAt: null,
    occurredOn: "2026-09-01",
    description: "Coffee",
    counterpartyName: "Cafe",
    providerCategory: null,
    providerAttributes: {},
    supersedesProviderEntryId: null,
    raw: {
      recordType: "transaction" as const,
      providerRecordId: "txn_1",
      payload: { transaction_id: "txn_1", amount: amountMinor / -100, pending: status === "pending" },
      observedAt,
    },
  });

  beforeAll(async () => {
    await supabase.from("source_connections").delete().eq("company_id", COMPANY);
    const { data, error } = await supabase
      .from("source_connections")
      .insert({
        company_id: COMPANY,
        provider: "plaid",
        provider_connection_id: "item_lifecycle_test",
        credentials: { access_token: "access-sandbox-test" },
      })
      .select("id")
      .single();
    if (error) throw error;
    connectionId = data.id;
  });

  const sync = (pages: Parameters<typeof adapterFor>[0]) =>
    syncSourceConnection({
      companyId: COMPANY,
      connectionId,
      adapter: adapterFor(pages),
    });

  it("keeps a changed payload as a new revision while updating the projection", async () => {
    await sync([
      {
        accounts: [account("2026-09-13T10:00:00.000Z")],
        entries: [entry(-450, "pending", "2026-09-13T10:00:00.000Z")],
        syncStateAfter: { cursor: "c1" },
      },
    ]);

    // The same transaction settles at a different amount under the same id.
    await sync([
      { entries: [entry(-480, "posted", "2026-09-13T11:00:00.000Z")], syncStateAfter: { cursor: "c2" } },
    ]);

    const { data: raws } = await supabase
      .from("source_raw_records")
      .select("payload_hash, observed_at")
      .eq("connection_id", connectionId)
      .eq("provider_record_id", "txn_1")
      .order("observed_at", { ascending: true });

    // Tier 0 kept both versions - this table is the revision log.
    expect(raws?.length).toBe(2);
    expect(raws?.[0].payload_hash).not.toBe(raws?.[1].payload_hash);

    const { data: entries } = await supabase
      .from("source_entries")
      .select("amount_minor, status, first_seen_at, last_observed_at")
      .eq("connection_id", connectionId);

    // Tier 1 is one row, updated in place, still carrying when it was first seen.
    expect(entries?.length).toBe(1);
    expect(Number(entries?.[0].amount_minor)).toBe(-480);
    expect(entries?.[0].status).toBe("posted");
    expect(new Date(entries![0].last_observed_at).getTime()).toBeGreaterThan(
      new Date(entries![0].first_seen_at).getTime()
    );
  });

  it("tombstones a retracted entry instead of deleting it", async () => {
    await sync([
      {
        retractions: [{ providerEntryId: "txn_1", observedAt: "2026-09-13T12:00:00.000Z" }],
        syncStateAfter: { cursor: "c3" },
      },
    ]);

    const { data } = await supabase
      .from("source_entries")
      .select("provider_entry_id, withdrawn_at, amount_minor")
      .eq("connection_id", connectionId);

    // The row survives, so a figure produced before the retraction can still be
    // explained afterwards. Readers filter on `withdrawn_at is null`.
    expect(data?.length).toBe(1);
    expect(data?.[0].withdrawn_at).toBeTruthy();
    expect(Number(data?.[0].amount_minor)).toBe(-480);
  });

  it("only observes a balance again when it has actually changed", async () => {
    const observed = async () => {
      const { count } = await supabase
        .from("source_balance_observations")
        .select("id", { count: "exact", head: true })
        .eq("company_id", COMPANY);
      return count ?? 0;
    };

    const start = await observed();
    await sync([
      { accounts: [account("2026-09-13T13:00:00.000Z")], balances: [balance(1000, "2026-09-13T13:00:00.000Z")], syncStateAfter: {} },
    ]);
    const afterChange = await observed();

    await sync([
      { accounts: [account("2026-09-13T14:00:00.000Z")], balances: [balance(1000, "2026-09-13T14:00:00.000Z")], syncStateAfter: {} },
    ]);
    const afterUnchanged = await observed();

    expect(afterChange).toBe(start + 1);
    // An unchanged balance is not new information, so no row is appended.
    expect(afterUnchanged).toBe(afterChange);
  });

  const balance = (currentMinor: number, observedAt: string) => ({
    providerAccountId: "acct_1",
    observedAt,
    currentMinor,
    availableMinor: null,
    currency: "USD",
  });
});

const adapterFor = (pages: Array<Record<string, unknown>>) => ({
  provider: "plaid" as const,
  async *pull() {
    for (const page of pages) yield page as never;
  },
});
