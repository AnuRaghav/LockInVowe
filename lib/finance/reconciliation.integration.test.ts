import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { FakeToolCallingModel } from "langchain";
import { ToolMessage } from "@langchain/core/messages";
import { createFinancialSession } from "./session";
import { createSamContextBuilder } from "@/lib/agents/sam/context-builder";
import { createSeededPersistentMemory } from "@/lib/memory/seed";
import { InMemoryThreadMemory } from "@/lib/memory/in-memory";
const createSamModel = vi.fn();
vi.mock("@/lib/agents/sam/model", () => ({ createSamModel }));
const { runSamAgent } = await import("@/lib/agents/sam/agent");
import { createServiceClient } from "@/lib/supabase/service";
import { createSourceStore } from "@/lib/source/store";
import { toAccount, toBalanceObservation, toEntry } from "@/lib/source/rho/map";
import type { RhoAccount, RhoTransaction } from "@/lib/source/rho/client";
import { loadReconciledFinancialState } from "./source-reader";
import { deriveFinancialActuals } from "./actuals";

// Actual adapter -> SourceStore -> Postgres -> reader -> reconciliation. No network provider dependency.
describe.skipIf(!process.env.SUPABASE_INTEGRATION)("Numerical Model over persisted Source Layer", () => {
  it("tracks lifecycle updates, idempotency, provenance, balance dedupe and sync failures", async () => {
    const client = createServiceClient();
    const companyId = randomUUID();
    const now = new Date("2026-09-13T12:00:00Z");
    const policy = { now, staleAfterMs: 86400000 };
    const { data: connection, error } = await client.from("source_connections").insert({
      company_id: companyId, provider: "rho", provider_connection_id: randomUUID(), credentials: {},
    }).select("id").single();
    if (error) throw error;
    try {
      const store = createSourceStore(client);
      const handle = (await store.loadConnection(companyId, connection.id))!;
      const cash: RhoAccount = { id: "cash", account_type: "checking", balance: { amount: 876138, currency: "USD" } };
      const credit: RhoAccount = { id: "credit", account_type: "credit", balance: { amount: -1750, currency: "USD" } };
      const debit: RhoTransaction = { id: "debit", money_movement_id: "repayment", account_id: "cash", account_name: "Cash",
        account_type: "checking", amount: { amount: -1750, currency: "USD" }, status: "settled", transaction_type: "credit_repayment",
        counterparty_name: "Credit", initiated_at: "2026-06-26T00:10:12Z", posted_at: "2026-06-26T00:10:12Z" };
      const creditLeg: RhoTransaction = { ...debit, id: "credit-leg", account_id: "credit", account_type: "credit", amount: { amount: 1750, currency: "USD" } };
      const page = (status: RhoTransaction["status"], observedAt: string) => ({
        accounts: [cash, credit].map(a => toAccount(a, observedAt)),
        balances: [cash, credit].map(a => toBalanceObservation(a, observedAt)!),
        entries: [debit, { ...creditLeg, status }].map(e => toEntry(e, observedAt)), syncStateAfter: {},
      });
      const persist = async (status: RhoTransaction["status"], observedAt: string) => {
        const { syncId } = await store.startSyncRun(handle);
        const counts = await store.persistPage({ connection: handle, syncId, page: page(status, observedAt) });
        await store.completeSyncRun({ connection: handle, syncId, counts, syncStateAfter: {}, finishedAt: new Date(observedAt) });
      };
      await persist("pending", "2026-09-12T12:00:00Z");
      const first = await loadReconciledFinancialState(companyId, policy, client);
      expect(first.pending).toHaveLength(1);
      expect(first.activities[0].relationship).toBe("unresolved");
      await persist("settled", now.toISOString());
      await persist("settled", now.toISOString());
      const state = await loadReconciledFinancialState(companyId, policy, client);
      expect(state.pending).toEqual([]);
      expect(state.activities).toHaveLength(1);
      expect(state.activities[0]).toMatchObject({ kind: "credit_repayment", cashMinor: -1750, spendMinor: 0 });
      expect(state.accounts.every(a => a.balances.length === 1)).toBe(true);
      expect(state.health.connections[0].last_synced_at).toContain("2026-09-13");
      expect(JSON.stringify(state)).not.toContain("credentials");
      const actuals = deriveFinancialActuals(state).currencies[0];
      expect(actuals.cash.valueMinor).toBe(876138);
      expect(actuals.creditPosition.valueMinor).toBe(-1750);
      expect(actuals.comparison.current.recordedCashMovement?.netMinor).toBe(-1750);
      expect(actuals.comparison.current.cashConsumption.valueMinor).toBe(1750);
      expect(actuals.comparison.current.externalCashMovement.value?.netMinor).toBe(0);
      expect(actuals.comparison.current.operatingBurn.status).toBe("unavailable");
      expect(actuals.runway.months).toBeNull();
      expect(actuals.cash.evidence[0].raw_record_id).toBeTruthy();
      expect(actuals.comparison.current.evidence[0].rawRecordId).toBeTruthy();
      for (const effect of state.activities[0].effects) {
        const { data: raw, error: rawError } = await client.from("source_raw_records").select("provider_record_id")
          .eq("id", effect.source.latest_raw_record_id!).single();
        if (rawError) throw rawError;
        expect(raw.provider_record_id).toBe(effect.source.provider_entry_id);
      }
      // Actual persisted Source -> reader -> Phase 1/2 -> Context Builder + tools -> Sam.
      // Only the model is fake; it echoes the actual prompt/tool messages it receives.
      const load = vi.fn((id: string) => loadReconciledFinancialState(id, policy, client));
      createSamModel.mockReturnValue(new FakeToolCallingModel({ toolCalls: [
        [{ name: "financial_position", args: { currency: "USD" }, id: "position" }],
        [{ name: "financial_burn_runway", args: { currency: "USD", trailingMonths: 3 }, id: "runway" }],
        [{ name: "explain_financial_number", args: { currency: "USD", metric: "cash" }, id: "trace" }], [],
      ] }));
      const sam = await runSamAgent({ messages: "How much cash do we have, what is our runway, and why?",
        context: { companyId, financials: createFinancialSession(companyId, { load }) },
        contextBuilder: createSamContextBuilder({ persistentMemory: createSeededPersistentMemory(companyId),
          threadMemory: new InMemoryThreadMemory(), loadBrief: async () => null }),
      });
      expect(sam.ok).toBe(true);
      expect(sam.text).toContain("USD 8761.38");
      expect(sam.initialContext.numerical?.status).toBe("qualified");
      expect(load).toHaveBeenCalledTimes(1);
      expect(load).toHaveBeenCalledWith(companyId, expect.any(AbortSignal));
      const toolResults = sam.messages.filter((m): m is ToolMessage => m instanceof ToolMessage).map(m => JSON.parse(m.text));
      expect(toolResults[0]).toMatchObject({ ok: true, data: { companyId, cash: { value: { minor: 876138 } } } });
      expect(toolResults[1]).toMatchObject({ ok: true, data: { runway: { status: "unavailable", months: null } } });
      expect(toolResults[2].data.evidence[0].balances[0].rawRecordId).toBe(actuals.cash.evidence[0].raw_record_id);
      expect(JSON.stringify(sam.run)).not.toContain("876138");

      const { syncId } = await store.startSyncRun(handle);
      await expect(loadReconciledFinancialState(companyId, policy, client)).rejects.toThrow("sync in progress");
      const counts = await store.persistPage({ connection: handle, syncId, page: page("failed", now.toISOString()) });
      await store.failSyncRun({ connection: handle, syncId, counts, error: "partial page failure", finishedAt: now });
      const failed = await loadReconciledFinancialState(companyId, policy, client);
      expect(failed.health.connections[0].status).toBe("error");
      expect(failed.activities[0].relationship).toBe("unresolved");
      expect(failed.excluded[0].reason).toBe("failed");
      const failedActuals = deriveFinancialActuals(failed).currencies[0];
      expect(failedActuals.comparison.current.externalCashMovement.status).toBe("unavailable");
      expect(failedActuals.cash.caveats).toContain("source_stale_or_failed");
      expect((await loadReconciledFinancialState(randomUUID(), policy, client)).activities).toEqual([]);
    } finally {
      const { error: cleanupError } = await client.from("source_connections").delete().eq("company_id", companyId);
      if (cleanupError) throw cleanupError;
    }
  }, 30000);
});
