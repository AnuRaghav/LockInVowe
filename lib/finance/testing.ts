/** Test fixtures only. Real adapter output projected as SourceStore writes Tier 1. */
import { toAccount, toEntry, toBalanceObservation } from "@/lib/source/rho/map";
import type { RhoAccount, RhoTransaction } from "@/lib/source/rho/client";
import type { Json } from "@/lib/supabase/types";
import { reconcileFinancialActivity, type ReconciliationInput } from "./reconciliation";
import { createFinancialSession } from "./session";

export const FINANCIAL_TEST_TIME = "2026-09-13T12:00:00.000Z";
export function financialSourceFixture(companyId = "company_test_1"): ReconciliationInput {
  const now = FINANCIAL_TEST_TIME;
  const cash: RhoAccount = { id: "cash", account_type: "checking", balance: { amount: 876138, currency: "USD" } };
  const credit: RhoAccount = { id: "credit", account_type: "credit", balance: { amount: -1750, currency: "USD" } };
  const debit: RhoTransaction = { id: "debit", money_movement_id: "repayment", account_id: "cash", account_name: "Cash",
    account_type: "checking", amount: { amount: -1750, currency: "USD" }, status: "settled", transaction_type: "credit_repayment",
    counterparty_name: "Credit", initiated_at: "2026-08-26T00:10:12Z", posted_at: "2026-08-26T00:10:12Z" };
  return { companyId,
    accounts: [cash, credit].map(raw => {
      const a = toAccount(raw, now);
      return { id: raw.id, company_id: companyId, connection_id: "connection", provider: "rho", provider_account_id: a.providerAccountId,
        kind: a.kind, name: a.name, mask: a.mask, currency: a.currency, provider_attributes: a.providerAttributes as Json,
        first_seen_at: now, last_observed_at: now, last_seen_sync_id: "sync", latest_raw_record_id: `raw-${raw.id}` };
    }),
    balances: [cash, credit].map(raw => {
      const b = toBalanceObservation(raw, now)!;
      return { id: `balance-${raw.id}`, company_id: companyId, account_id: raw.id, currency: b.currency,
        current_minor: b.currentMinor, available_minor: b.availableMinor, observed_at: now, sync_id: "sync", raw_record_id: `raw-${raw.id}` };
    }),
    entries: [debit, { ...debit, id: "credit-leg", account_id: "credit", amount: { amount: 1750, currency: "USD" } }].map(raw => {
      const e = toEntry(raw, now);
      return { id: e.providerEntryId, company_id: companyId, connection_id: "connection", provider: "rho", account_id: e.providerAccountId,
        provider_entry_id: e.providerEntryId, movement_key: e.movementKey, amount_minor: e.amountMinor, currency: e.currency, status: e.status,
        initiated_at: e.initiatedAt, posted_at: e.postedAt, occurred_on: e.occurredOn, description: e.description, counterparty_name: e.counterpartyName,
        provider_category: e.providerCategory as unknown as Json, provider_attributes: e.providerAttributes as Json,
        supersedes_provider_entry_id: e.supersedesProviderEntryId, withdrawn_at: null, first_seen_at: now, last_observed_at: now,
        latest_raw_record_id: `raw-${e.providerEntryId}`, last_seen_sync_id: "sync" };
    }),
    connections: [{ id: "connection", company_id: companyId, provider: "rho", status: "active", last_synced_at: now, last_sync_error: null, updated_at: now }],
    runs: [{ id: "sync", company_id: companyId, connection_id: "connection", provider: "rho", status: "succeeded", started_at: now, finished_at: now, error: null }],
  };
}
export const reconcileFixture = (input: ReconciliationInput) => reconcileFinancialActivity(input, { now: new Date(FINANCIAL_TEST_TIME), staleAfterMs: 86400000 });
export const testFinancialSession = (companyId: string) => createFinancialSession(companyId, { load: async id => reconcileFixture(financialSourceFixture(id)) });
