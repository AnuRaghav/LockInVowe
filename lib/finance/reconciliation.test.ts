import { describe, expect, it } from "vitest";
import type { Transaction } from "plaid";
import type Stripe from "stripe";
import { toAccount as stripeAccount, toEntry as stripeEntry } from "@/lib/source/stripe/map";
import { toAccount, toEntry } from "@/lib/source/rho/map";
import { toEntry as plaidEntry } from "@/lib/source/plaid/map";
import type { RhoTransaction } from "@/lib/source/rho/client";
import type { NormalizedAccount, NormalizedEntry } from "@/lib/source/types";
import type { Json } from "@/lib/supabase/types";
import { reconcileFinancialActivity, type ReconciliationInput, type SourceAccount, type SourceEntry } from "./reconciliation";
import { readAllSourcePages } from "./source-reader";

const now = "2026-09-13T12:00:00.000Z";
const policy = { now: new Date(now), staleAfterMs: 86400000 };
// Project real adapter output into the exact Tier 1 columns written by SourceStore.
function accountRow(a: NormalizedAccount): SourceAccount {
  return { id: a.providerAccountId, company_id: "company", connection_id: "connection", provider: "rho",
    provider_account_id: a.providerAccountId, kind: a.kind, name: a.name, mask: a.mask, currency: a.currency,
    provider_attributes: a.providerAttributes as Json, first_seen_at: now, last_observed_at: now,
    last_seen_sync_id: "sync", latest_raw_record_id: `raw-${a.providerAccountId}` };
}
function entryRow(e: NormalizedEntry): SourceEntry {
  return { id: e.providerEntryId, company_id: "company", connection_id: "connection", provider: "rho",
    account_id: e.providerAccountId, provider_entry_id: e.providerEntryId, movement_key: e.movementKey,
    amount_minor: e.amountMinor, currency: e.currency, status: e.status, initiated_at: e.initiatedAt,
    posted_at: e.postedAt, occurred_on: e.occurredOn, description: e.description, counterparty_name: e.counterpartyName,
    provider_category: e.providerCategory as unknown as Json, provider_attributes: e.providerAttributes as Json,
    supersedes_provider_entry_id: e.supersedesProviderEntryId, withdrawn_at: null,
    first_seen_at: now, last_observed_at: now, last_seen_sync_id: "sync", latest_raw_record_id: `raw-${e.providerEntryId}` };
}
const cash = accountRow(toAccount({ id: "cash", account_type: "checking", balance: { amount: 876138, currency: "USD" } }, now));
const credit = accountRow(toAccount({ id: "credit", account_type: "credit", balance: { amount: 0, currency: "USD" } }, now));
// Captured Rho repayment semantics from Source Layer fixtures, shortened identities.
const repayment: RhoTransaction = { id: "debit", money_movement_id: "movement", account_id: "cash",
  account_name: "Cash (Checking)", account_type: "checking", amount: { amount: -1750, currency: "USD" },
  status: "settled", transaction_type: "credit_repayment", counterparty_name: "Credit Account",
  initiated_at: "2026-06-26T00:10:12Z", posted_at: "2026-06-26T00:10:12Z" };
const rho = (patch: Partial<RhoTransaction> = {}) => entryRow(toEntry({ ...repayment, ...patch }, now));
function snapshot(entries = [rho(), rho({ id: "credit-leg", account_id: "credit", account_type: "credit", amount: { amount: 1750, currency: "USD" } })]): ReconciliationInput {
  return { companyId: "company", accounts: [cash, credit], entries, balances: [],
    connections: [{ id: "connection", company_id: "company", provider: "rho", status: "active", last_synced_at: now, last_sync_error: null, updated_at: now }],
    runs: [{ id: "sync", company_id: "company", connection_id: "connection", provider: "rho", status: "succeeded", started_at: now, finished_at: now, error: null }] };
}
const reconcile = (input: ReconciliationInput) => reconcileFinancialActivity(input, policy);

function plaid(pending: boolean, id: string, predecessor: string | null = null) {
  return { ...entryRow(plaidEntry({ transaction_id: id, account_id: "cash", amount: pending ? 17 : 17.5,
    iso_currency_code: "USD", date: "2026-06-26", pending, pending_transaction_id: predecessor,
    name: "Payment", authorized_date: null } as Transaction, now)), provider: "plaid" as const };
}
function plaidSnapshot(entries: SourceEntry[]) {
  const s = snapshot(entries);
  s.accounts = s.accounts.map(a => ({ ...a, provider: "plaid" }));
  s.connections[0].provider = "plaid";
  s.runs[0].provider = "plaid";
  return s;
}

describe("financial integrity over Source projections", () => {
  it("reconciles exact repayment without hiding cash or inventing new spend", () => {
    const state = reconcile(snapshot());
    expect(state.activities).toHaveLength(1);
    expect(state.activities[0]).toMatchObject({ relationship: "internal", kind: "credit_repayment", cashMinor: -1750,
      creditPositionMinor: 1750, liabilityMinor: -1750, spendMinor: 0 });
    expect(state.activities[0].effects.map(e => e.source.latest_raw_record_id)).toEqual(["raw-credit-leg", "raw-debit"]);
    expect(state.accounts.find(a => a.source.id === "credit")?.eligibleCash).toBe(false);
  });
  it("cash-to-savings has zero consolidated cash, preserving dates on both legs", () => {
    const s = snapshot(); s.accounts[1] = { ...credit, kind: "savings" };
    s.entries[1].occurred_on = "2026-06-27";
    expect(reconcile(s).activities[0]).toMatchObject({ kind: "cash_transfer", cashMinor: 0, spendMinor: 0 });
    expect(reconcile(s).activities[0].effects.map(e => e.occurredOn)).toContain("2026-06-27");
  });
  it.each(["failed", "awaiting_approval", "pending"] as const)("status %s cannot become realized because Rho supplied posted_at", status => {
    const s = snapshot([rho({ status })]); const state = reconcile(s);
    expect(state.activities).toEqual([]);
    expect(state.pending.length + state.excluded.length).toBe(1);
  });
  it("excludes tombstones and keeps incomplete groups unresolved", () => {
    const s = snapshot(); s.entries[1].withdrawn_at = now;
    const state = reconcile(s);
    expect(state.excluded[0].reason).toBe("withdrawn");
    expect(state.activities[0]).toMatchObject({ relationship: "unresolved", cashMinor: -1750, spendMinor: null });
  });
  it("does not prove internal from a zero-sum subset of a mixed-lifecycle group", () => {
    const s = snapshot(); s.entries.push(rho({ id: "pending-third", status: "pending" }));
    expect(reconcile(s).activities[0].relationship).toBe("unresolved");
  });
  it("unbalanced and same-account groups are not internal", () => {
    const s = snapshot(); s.entries[1].amount_minor = 1700;
    expect(reconcile(s).activities[0].relationship).toBe("unresolved");
    s.entries[1].amount_minor = 1750; s.entries[1].account_id = "cash";
    expect(reconcile(s).activities[0].relationship).toBe("unresolved");
  });
  it("never nets currencies, even with the same movement key", () => {
    const s = snapshot(); s.entries[1].currency = "EUR"; s.accounts[1] = { ...credit, currency: "EUR" };
    const state = reconcile(s);
    expect(state.activities).toHaveLength(2);
    expect(state.activities.every(a => a.relationship === "unresolved" && a.unresolved.includes("cross_currency_group"))).toBe(true);
  });
  it("scopes Rho movement keys to the connection, not the company", () => {
    const s = snapshot(); s.connections.push({ ...s.connections[0], id: "other" });
    s.accounts[1] = { ...credit, connection_id: "other" }; s.entries[1].connection_id = "other";
    expect(reconcile(s).activities).toHaveLength(2);
    expect(reconcile(s).health.duplicateAccountRisk).toBe("possible_multiple_connections");
  });
  it("supersedes pending at its changed posted amount, without resurrecting after retraction", () => {
    const s = plaidSnapshot([plaid(true, "pending"), plaid(false, "posted", "pending")]);
    const state = reconcile(s);
    expect(state.pending).toEqual([]);
    expect(state.excluded[0]).toMatchObject({ reason: "superseded", replacedBy: ["posted"] });
    expect(state.activities[0].cashMinor).toBe(-1750);
    s.entries[1].withdrawn_at = now;
    expect(reconcile(s).pending).toEqual([]);
    expect(reconcile(s).activities).toEqual([]);
  });
  it("flags conflicting posted successors rather than selecting one by amount", () => {
    const s = plaidSnapshot([plaid(true, "pending"), plaid(false, "p1", "pending"), plaid(false, "p2", "pending")]);
    expect(reconcile(s).activities.every(a => a.unresolved.includes("conflicting_supersession"))).toBe(true);
  });
  it("does not match equal/opposite Plaid payments or call card debits spend", () => {
    const p = plaid(false, "p"); const q = { ...plaid(false, "q"), account_id: "credit", amount_minor: 1750 };
    const state = reconcile(plaidSnapshot([p, q]));
    expect(state.activities).toHaveLength(2);
    expect(state.activities.every(a => a.relationship === "unresolved" && a.spendMinor === null)).toBe(true);
    const debit = reconcile(plaidSnapshot([{ ...q, amount_minor: -1750 }])).activities[0];
    expect(debit).toMatchObject({ cashMinor: 0, liabilityMinor: 1750, spendMinor: null });
  });
  it("preserves unknown coverage, missing balances, stale/error runs and row provenance", () => {
    const s = snapshot(); s.connections[0].last_synced_at = "2026-09-01T12:00:00Z";
    s.connections[0].status = "error"; s.connections[0].last_sync_error = "failed";
    const state = reconcile(s);
    expect(state.health.coverage).toBe("unknown");
    expect(state.health.connections[0]).toMatchObject({ stale: true, status: "error", last_sync_error: "failed" });
    expect(state.accounts[0].balances).toEqual([]);
    expect(state.accounts[0].historyCompleteness).toBe("unknown");
  });
  it("balance value-change age is not mistaken for connection freshness", () => {
    const s = snapshot(); s.balances = [{ id: "balance", company_id: "company", account_id: "cash", currency: "USD",
      current_minor: 876138, available_minor: null, observed_at: "2026-01-01T00:00:00Z", sync_id: "old-sync", raw_record_id: "raw-old" }];
    const state = reconcile(s);
    expect(state.health.connections[0].stale).toBe(false);
    expect(state.accounts[0].balances[0].observed_at).toBe("2026-01-01T00:00:00Z");
  });
  it.each(["investment", "rewards", "other"] as const)("%s stays out of cash", kind => {
    const s = snapshot([rho()]); s.accounts[0] = { ...cash, kind };
    expect(reconcile(s).activities[0].cashMinor).toBe(0);
    expect(reconcile(s).accounts[0].eligibleCash).toBe(false);
  });
  it("preserves Stripe balance activity without counting it as cash or matching a payout", () => {
    const s = snapshot([]);
    s.connections[0].provider = "stripe"; s.runs[0].provider = "stripe";
    s.accounts = [{ ...accountRow(stripeAccount("USD", now, {})), provider: "stripe" }];
    s.entries = [{ ...entryRow(stripeEntry({ id: "txn", net: -1750, amount: -1750, fee: 0, currency: "usd",
      created: 1782432000, available_on: 1782432000, status: "available", type: "payout", reporting_category: "payout",
      source: "po_1" } as Stripe.BalanceTransaction, now)), provider: "stripe" }];
    const state = reconcile(s);
    expect(state.activities[0]).toMatchObject({ cashMinor: 0, spendMinor: null, relationship: "unresolved" });
    expect(state.activities[0].effects[0].amountMinor).toBe(-1750);
    expect(state.accounts[0].eligibleCash).toBe(false);
  });
  it("does not require the pending predecessor to be in history", () => {
    const state = reconcile(plaidSnapshot([plaid(false, "posted", "not-in-history")]));
    expect(state.activities).toHaveLength(1);
    expect(state.activities[0].cashMinor).toBe(-1750);
  });
  it("rejects cross-company, unknown accounts, duplicates and unsafe money", () => {
    const s = snapshot(); s.entries[0].company_id = "intruder";
    expect(() => reconcile(s)).toThrow("Cross-company");
    s.entries[0].company_id = "company"; s.entries[0].account_id = "missing";
    expect(() => reconcile(s)).toThrow("account reference");
    s.entries[0].account_id = "cash"; s.entries[0].amount_minor = Number.MAX_SAFE_INTEGER + 1;
    expect(() => reconcile(s)).toThrow("Unsafe monetary");
    s.entries[0].amount_minor = -1750; s.entries.push(s.entries[0]);
    expect(() => reconcile(s)).toThrow("Duplicate");
  });
  it("rejects unsafe aggregate totals, and is deterministic under input reordering", () => {
    const s = snapshot(); s.entries[0].amount_minor = Number.MAX_SAFE_INTEGER;
    s.entries[1].account_id = "cash"; s.entries[1].amount_minor = 1;
    expect(() => reconcile(s)).toThrow("Unsafe monetary");
    const normal = snapshot(); const before = reconcile(normal);
    normal.entries.reverse(); normal.accounts.reverse();
    expect(reconcile(normal)).toEqual(before);
  });
  it("paginates through server caps and propagates errors rather than returning partial data", async () => {
    const rows = [1, 2, 3, 4, 5];
    expect(await readAllSourcePages(async from => ({ data: rows.slice(from, from + 2), error: null }))).toEqual(rows);
    await expect(readAllSourcePages(async () => ({ data: null, error: new Error("read failed") }))).rejects.toThrow("read failed");
  });
});
