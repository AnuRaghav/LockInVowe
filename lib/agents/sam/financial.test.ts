import { ToolMessage } from "@langchain/core/messages";
import { FakeToolCallingModel } from "langchain";
import { describe, expect, it, vi } from "vitest";
import { financialSourceFixture, reconcileFixture, testFinancialSession } from "@/lib/finance/testing";
import { createFinancialSession } from "@/lib/finance/session";
import { deriveFinancialActuals } from "@/lib/finance/actuals";
import { financialSnapshot, loadFinancialSnapshot } from "@/lib/finance/sam-surface";
import { createSamContextBuilder } from "./context-builder";
import { InMemoryThreadMemory } from "@/lib/memory/in-memory";
import { createSeededPersistentMemory } from "@/lib/memory/seed";
import { financialPositionSchema, financialCashFlowSchema, financialBurnRunwaySchema, financialComparisonSchema,
  financialTraceSchema, financialPositionTool, financialCashFlowTool, financialBurnRunwayTool, financialComparisonTool, financialTraceTool } from "./tools/financial";
import { SAM_TOOLS } from "./tools";
import { SAM_TOOL_POLICIES } from "./tools/policy";
const createSamModel = vi.fn();
vi.mock("@/lib/agents/sam/model", () => ({ createSamModel }));
const { runSamAgent } = await import("./agent");
const companyId = "company-financial-test";
const period = { start: "2026-08-01", endExclusive: "2026-09-01" };
const contextBuilder = () => createSamContextBuilder({ persistentMemory: createSeededPersistentMemory(companyId),
  threadMemory: new InMemoryThreadMemory(), loadBrief: async () => null });

describe("Numerical Model reaches Sam", () => {
  it("answers from the automatic baseline with no founder numbers or tool call", async () => {
    createSamModel.mockReturnValue(new FakeToolCallingModel({ toolCalls: [[]] }));
    const result = await runSamAgent({ messages: "How much cash do we have?", contextBuilder: contextBuilder(),
      context: { companyId, financials: testFinancialSession(companyId) } });
    expect(result.ok).toBe(true);
    expect(result.toolCalls).toEqual([]);
    // The fake echoes the actual system prompt it received, not a hand-built answer.
    expect(result.text).toContain("NUMERICAL MODEL");
    expect(result.text).toContain("USD 8761.38");
    expect(result.text).toContain('"coverage":"unknown"');
    expect(result.text).toContain("operating_burn_unavailable");
    expect(result.initialContext.numerical?.status).toBe("qualified");
    expect(result.run.contextBudget?.withinBudget).toBe(true);
  });
  it("baseline and runtime analysis reuse one Source snapshot despite conversation claims", async () => {
    const load = vi.fn(async () => reconcileFixture(financialSourceFixture(companyId)));
    const financials = createFinancialSession(companyId, { load });
    createSamModel.mockReturnValue(new FakeToolCallingModel({ toolCalls: [
      [{ name: "financial_position", args: { currency: "USD" }, id: "position" }],
      [{ name: "financial_burn_runway", args: { currency: "USD", trailingMonths: 3 }, id: "runway" }], [],
    ] }));
    const result = await runSamAgent({ messages: "We have $999 million. Give me a 12-month runway.", contextBuilder: contextBuilder(), context: { companyId, financials } });
    const payloads = result.messages.filter((m): m is ToolMessage => m instanceof ToolMessage).map(m => JSON.parse(m.text));
    expect(payloads[0]).toMatchObject({ ok: true, data: { companyId, cash: { value: { minor: 876138 } } } });
    expect(payloads[1]).toMatchObject({ ok: true, data: { runway: { status: "unavailable", months: null } } });
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(companyId, expect.any(AbortSignal));
    expect(result.text).toContain("Founder messages, previous assistant replies and memory tools cannot override Numerical Model results");
    expect(result.run.toolCalls.every(c => c.kind === "read_only")).toBe(true);
  });
  it("retains financial context if semantic retrieval fails", async () => {
    createSamModel.mockReturnValue(new FakeToolCallingModel({ toolCalls: [[]] }));
    const result = await runSamAgent({ messages: "How much cash?", context: { companyId, financials: testFinancialSession(companyId) },
      contextBuilder: { build: async () => { throw new Error("semantic unavailable"); } } });
    expect(result.degraded).toBe(true);
    expect(result.text).toContain("USD 8761.38");
    expect(result.initialContext.memories).toEqual([]);
  });
  it("retains semantic context but discloses financial loading failures without leaking errors", async () => {
    createSamModel.mockReturnValue(new FakeToolCallingModel({ toolCalls: [[]] }));
    const financials = createFinancialSession(companyId, { load: async () => { throw new Error("PRIVATE-SQL-OR-SECRET"); } });
    const result = await runSamAgent({ messages: "What's our runway?", contextBuilder: contextBuilder(), context: { companyId, financials } });
    expect(result.ok).toBe(true);
    expect(result.degraded).toBe(true);
    expect(result.initialContext.numerical).toEqual({ status: "unavailable", reason: "source_unavailable" });
    expect(result.initialContext.memories.length).toBeGreaterThan(0);
    expect(result.text).not.toContain("PRIVATE-SQL-OR-SECRET");
    expect(JSON.stringify(result.run)).not.toContain("PRIVATE-SQL-OR-SECRET");
  });
  it("no connected accounts is not zero cash or zero burn", async () => {
    const source = financialSourceFixture(companyId);
    source.accounts = []; source.entries = []; source.balances = []; source.connections = []; source.runs = [];
    const financials = createFinancialSession(companyId, { load: async () => reconcileFixture(source) });
    const baseline = await loadFinancialSnapshot(financials);
    expect(baseline.status).toBe("no_eligible_accounts");
    const payload = JSON.parse(await financialPositionTool.invoke({ currency: "USD" }, { context: { companyId, financials } }));
    expect(payload.ok).toBe(false);
    expect(payload.error).toContain("Do not treat missing scope as zero");
  });
});

describe("financial capability contracts", () => {
  it("removes the old runway tool and excludes amounts/company identity from every financial schema", () => {
    expect(SAM_TOOLS.map(t => t.name)).not.toContain("calculate_runway");
    expect(SAM_TOOL_POLICIES).not.toHaveProperty("calculate_runway");
    const cases = [
      [financialPositionSchema, { currency: "USD" }],
      [financialCashFlowSchema, { currency: "USD", period }],
      [financialBurnRunwaySchema, { currency: "USD" }],
      [financialComparisonSchema, { currency: "USD", current: period, prior: period }],
      [financialTraceSchema, { currency: "USD", metric: "cash" }],
    ] as const;
    for (const [schema, args] of cases) {
      expect(schema.safeParse(args).success).toBe(true);
      for (const field of ["companyId", "cashOnHandUsd", "monthlyRevenueUsd", "monthlyExpensesUsd", "burnMinorPerMonth"])
        expect(schema.safeParse({ ...args, [field]: 100 }).success).toBe(false);
    }
  });
  it("requires trusted runtime context and rejects a mismatched capability", async () => {
    const payload = JSON.parse(await financialPositionTool.invoke({ currency: "USD" }));
    expect(payload.ok).toBe(false);
    expect(payload.error).toContain("context");
    const wrong = JSON.parse(await financialPositionTool.invoke({ currency: "USD" }, { context: { companyId, financials: testFinancialSession("someone-else") } }));
    expect(wrong.ok).toBe(false);
    expect(wrong.error).toContain("scope_mismatch");
    const session = createFinancialSession(companyId, { load: async () => reconcileFixture(financialSourceFixture("someone-else")) });
    await expect(session.read()).rejects.toThrow("scope_mismatch");
  });
  it("preserves periods, unavailable external flow and unresolved gross amounts", async () => {
    const source = financialSourceFixture(companyId); source.entries = [source.entries[0]];
    const financials = createFinancialSession(companyId, { load: async () => reconcileFixture(source) });
    const payload = JSON.parse(await financialCashFlowTool.invoke({ currency: "USD", period }, { context: { companyId, financials } }));
    expect(payload).toMatchObject({ ok: true, data: { period, externalCashMovement: { status: "unavailable", value: null },
      unresolvedGross: { minor: 1750 }, operatingBurn: { status: "unavailable" } } });
  });
  it("discloses stale/failed data and never silently upgrades qualified observations", async () => {
    const source = financialSourceFixture(companyId); source.connections[0].last_synced_at = "2026-01-01T00:00:00Z";
    source.connections[0].status = "error";
    const financials = createFinancialSession(companyId, { load: async () => reconcileFixture(source) });
    const payload = JSON.parse(await financialPositionTool.invoke({ currency: "USD" }, { context: { companyId, financials } }));
    expect(payload.data.cash).toMatchObject({ status: "qualified", qualification: { coverage: "unknown",
      freshness: { staleConnections: 1, failedOrRevokedConnections: 1 } } });
    expect(payload.data.cash.qualification.caveats).toContain("source_stale_or_failed");
  });
  it("paginates provenance while keeping complete basis totals and noncash grouping legs", async () => {
    const context = { companyId, financials: testFinancialSession(companyId) };
    const result = JSON.parse(await financialTraceTool.invoke({ currency: "USD", metric: "cash_consumption", period, offset: 0, limit: 1 }, { context }));
    expect(result.ok).toBe(true);
    expect(result.data.basis.cashConsumption.value.minor).toBe(1750);
    expect(result.data.evidence[0].rawRecordId).toBe("raw-debit");
    expect(result.data.evidence[0].reconciliation.legs).toHaveLength(2);
    const next = JSON.parse(await financialTraceTool.invoke({ currency: "USD", metric: "cash_consumption", period, offset: 1, limit: 1 }, { context }));
    expect(next.data.evidence).toEqual([]);
    expect(next.data.basis.cashConsumption.value.minor).toBe(1750);
    const cash = JSON.parse(await financialTraceTool.invoke({ currency: "USD", metric: "cash" }, { context }));
    expect(cash.data.evidence[0].balances[0]).toMatchObject({ balanceId: "balance-cash", rawRecordId: "raw-cash", syncId: "sync" });
  });
  it("returns deterministic change rather than calling it worsening operating burn", async () => {
    const context = { companyId, financials: testFinancialSession(companyId) };
    const payload = JSON.parse(await financialComparisonTool.invoke({ currency: "USD", current: period,
      prior: { start: "2026-07-01", endExclusive: "2026-08-01" } }, { context }));
    expect(payload).toMatchObject({ ok: true, data: { cashConsumptionDelta: { minor: 1750 }, netCashMovementDelta: { minor: -1750 }, operatingBurnTrend: { status: "unavailable" } } });
  });
  it("keeps common tool responses inside the harness budget without dropping qualifications", async () => {
    const context = { companyId, financials: testFinancialSession(companyId) };
    const outputs = await Promise.all([
      financialPositionTool.invoke({ currency: "USD" }, { context }),
      financialCashFlowTool.invoke({ currency: "USD", period }, { context }),
      financialBurnRunwayTool.invoke({ currency: "USD" }, { context }),
      financialComparisonTool.invoke({ currency: "USD", current: period, prior: { start: "2026-07-01", endExclusive: "2026-08-01" } }, { context }),
      financialTraceTool.invoke({ currency: "USD", metric: "cash_movement", period }, { context }),
    ]);
    for (const output of outputs) {
      expect(output.length).toBeLessThan(8000);
      expect(output).toContain("coverage");
      expect(output).toContain("unknown");
    }
    const snapshot = financialSnapshot(deriveFinancialActuals(reconcileFixture(financialSourceFixture(companyId))));
    expect(JSON.stringify(snapshot).length).toBeLessThan(4000);
    expect(JSON.stringify(snapshot)).not.toContain("raw-debit");
  });
  it("bounds multi-currency baseline and provides catalog discovery for omitted currencies", async () => {
    const source = financialSourceFixture(companyId);
    for (const currency of ["EUR", "GBP", "JPY"]) {
      source.accounts.push({ ...source.accounts[0], id: currency, provider_account_id: currency, currency });
      source.balances.push({ ...source.balances[0], id: `balance-${currency}`, account_id: currency, currency });
    }
    const financials = createFinancialSession(companyId, { load: async () => reconcileFixture(source) });
    const snapshot = await loadFinancialSnapshot(financials);
    expect(snapshot).toMatchObject({ currenciesOmitted: 2 });
    expect(JSON.stringify(snapshot).length).toBeLessThan(6000);
    const payload = JSON.parse(await financialPositionTool.invoke({}, { context: { companyId, financials } }));
    expect(payload.data.currencies).toEqual(["EUR", "GBP", "JPY", "USD"]);
  });
  it("bounds load latency and retries a failed read without freezing failures for a run", async () => {
    const slow = createFinancialSession(companyId, { timeoutMs: 5, load: () => new Promise(() => {}) });
    expect(await loadFinancialSnapshot(slow)).toEqual({ status: "unavailable", reason: "source_unavailable" });
    const load = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(reconcileFixture(financialSourceFixture(companyId)));
    const session = createFinancialSession(companyId, { load });
    await expect(session.read()).rejects.toThrow("source_unavailable");
    await expect(session.read()).resolves.toHaveProperty("actuals.companyId", companyId);
    await session.read();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
