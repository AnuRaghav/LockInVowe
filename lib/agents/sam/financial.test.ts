import { ToolMessage } from "@langchain/core/messages";
import { FakeToolCallingModel } from "langchain";
import { describe, expect, it, vi } from "vitest";
import { financialSourceFixture, reconcileFixture, testFinancialSession } from "@/lib/finance/testing";
import { createFinancialSession } from "@/lib/finance/session";
import { deriveFinancialActuals } from "@/lib/finance/actuals";
import { financialSnapshot, loadFinancialSnapshot } from "@/lib/finance/sam-surface";
import { createSamContextBuilder } from "./context-builder";
import { InMemoryPersistentMemory, InMemoryThreadMemory } from "@/lib/memory/in-memory";
import { createSeededPersistentMemory } from "@/lib/memory/seed";
import { financialPositionSchema, financialCashFlowSchema, financialBurnRunwaySchema, financialComparisonSchema,
  financialTraceSchema, forecastCashSchema, simulateFinancialScenarioSchema, compareFinancialScenariosSchema,
  financialPositionTool, financialCashFlowTool, financialBurnRunwayTool, financialComparisonTool, financialTraceTool,
  forecastCashTool, simulateFinancialScenarioTool, compareFinancialScenariosTool } from "./tools/financial";
import { SAM_TOOLS } from "./tools";
import { SAM_TOOL_POLICIES } from "./tools/policy";
const createSamModel = vi.fn();
vi.mock("@/lib/agents/sam/model", () => ({ createSamModel }));
const { runSamAgent } = await import("./agent");
const companyId = "company-financial-test";
const period = { start: "2026-08-01", endExclusive: "2026-09-01" };
const contextBuilder = () => createSamContextBuilder({ persistentMemory: createSeededPersistentMemory(companyId),
  threadMemory: new InMemoryThreadMemory(), loadBrief: async () => null, loadOperating: async () => null });

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
    expect(result.initialContext.directory).toBeNull();
  });
  it("retains semantic context but discloses financial loading failures without leaking errors", async () => {
    createSamModel.mockReturnValue(new FakeToolCallingModel({ toolCalls: [[]] }));
    const financials = createFinancialSession(companyId, { load: async () => { throw new Error("PRIVATE-SQL-OR-SECRET"); } });
    const result = await runSamAgent({ messages: "What's our runway?", contextBuilder: contextBuilder(), context: { companyId, financials } });
    expect(result.ok).toBe(true);
    expect(result.degraded).toBe(true);
    expect(result.initialContext.numerical).toEqual({ status: "unavailable", reason: "source_unavailable" });
    expect(result.initialContext.directory?.entries.length).toBeGreaterThan(0);
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
    expect(SAM_TOOLS.map(t => t.name)).toEqual(expect.arrayContaining([
      "forecast_cash", "simulate_financial_scenario", "compare_financial_scenarios",
    ]));
    expect(SAM_TOOL_POLICIES.forecast_cash.kind).toBe("calculation");
    const cases = [
      [financialPositionSchema, { currency: "USD" }],
      [financialCashFlowSchema, { currency: "USD", period }],
      [financialBurnRunwaySchema, { currency: "USD" }],
      [financialComparisonSchema, { currency: "USD", current: period, prior: period }],
      [financialTraceSchema, { currency: "USD", metric: "cash" }],
      [forecastCashSchema, { currency: "USD", startDate: "2026-10-01", horizon: { periods: 12, granularity: "month" }, baseline: { method: "none" } }],
      [simulateFinancialScenarioSchema, { currency: "USD", startDate: "2026-10-01", horizon: { periods: 12, granularity: "month" }, baseline: { method: "none" }, scenario: { name: "plan" } }],
      [compareFinancialScenariosSchema, { currency: "USD", startDate: "2026-10-01", horizon: { periods: 12, granularity: "month" }, baseline: { method: "none" }, scenarios: [{ name: "plan" }] }],
    ] as const;
    for (const [schema, args] of cases) {
      expect(schema.safeParse(args).success).toBe(true);
      for (const field of ["companyId", "startingCashMinor", "cashOnHandUsd", "monthlyRevenueUsd", "monthlyExpensesUsd", "burnMinorPerMonth"])
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
  it("supports a scripted multi-step financial decision workflow with deterministic scenario arithmetic", async () => {
    const memory = new InMemoryPersistentMemory({ [companyId]: [
      { id: "runway-policy", kind: "constraint", content: "Maintain at least 12 months of runway.", labels: ["runway"], importance: 1 },
      { id: "engineering-plan", kind: "plan", content: "Hire two engineers on November 1 at an assumed fully loaded cash cost of $17k per month each.", labels: ["hiring"], importance: 1 },
      { id: "planning-baseline", kind: "assumption", content: "For this management scenario, assume baseline cash outflows of $1,000 per month and no inflows.", labels: ["forecast"], importance: 1 },
    ] });
    const scenarioArgs = {
      currency: "USD", startDate: "2026-10-01", horizon: { periods: 12, granularity: "month" as const },
      baseline: { method: "explicit_periodic" as const, inflowsMinor: 0, outflowsMinor: 100_000,
        basis: { kind: "management_assumption" as const, label: "Management planning baseline", reference: "financial-posture" } },
      thresholds: { runwayMonths: 12 },
      scenario: { name: "two planned engineers", recurringDeltas: [{ id: "two-engineers", label: "Two engineers at 17k each",
        startDate: "2026-11-01", cadence: "month" as const, driver: "outflow" as const, change: "increase" as const,
        amountMinor: 3_400_000, basis: { kind: "management_assumption" as const, label: "Current hiring plan", reference: "engineering-plan" } }] },
      limit: 6,
    };
    createSamModel.mockReturnValue(new FakeToolCallingModel({ toolCalls: [
      [{ name: "financial_position", args: { currency: "USD" }, id: "position" }],
      [{ name: "search_memory", args: { query: "planned engineers cost and runway floor" }, id: "memory" }],
      [{ name: "simulate_financial_scenario", args: scenarioArgs, id: "scenario" }],
      [],
    ] }));
    const result = await runSamAgent({ messages: "Can we afford the two planned engineers while maintaining our runway floor?",
      contextBuilder: createSamContextBuilder({ persistentMemory: memory, threadMemory: new InMemoryThreadMemory(), loadBrief: async () => null }),
      context: { companyId, financials: testFinancialSession(companyId), persistentMemory: memory } });
    expect(result.toolCalls.map(call => call.name)).toEqual(["financial_position", "search_memory", "simulate_financial_scenario"]);
    const payloads = result.messages.filter((message): message is ToolMessage => message instanceof ToolMessage).map(message => JSON.parse(message.text));
    expect(payloads[1]).toMatchObject({ ok: true, data: { topics: expect.any(Array) } });
    expect(payloads[1].data.topics.map((topic: { content: string }) => topic.content).join(" ")).toContain("$17k per month each");
    expect(payloads[2]).toMatchObject({ ok: true, data: {
      name: "two planned engineers",
      baseline: { endingCash: { minor: -323_862 } },
      scenario: { endingCash: { minor: -37_723_862 }, zeroCash: { status: "crossed" }, runwayThreshold: { status: "crossed", months: 12 } },
      difference: { endingCash: { minor: -37_400_000 }, cumulativeIncrementalCashImpact: { minor: -37_400_000 } },
    } });
    expect(result.run.toolCalls.map(call => call.kind)).toEqual(["read_only", "read_only", "calculation"]);
  });

  it("keeps normal forecast tool results bounded while preserving assumptions and qualifications", async () => {
    const context = { companyId, financials: testFinancialSession(companyId) };
    const core = { currency: "USD", startDate: "2026-10-01", horizon: { periods: 12, granularity: "month" as const },
      baseline: { method: "explicit_periodic" as const, inflowsMinor: 0, outflowsMinor: 50_000,
        basis: { kind: "management_assumption" as const, label: "Planning baseline" } },
      assumptions: [{ id: "scope", description: "No unlisted future commitments are modeled",
        basis: { kind: "management_assumption" as const, label: "Scenario scope" } }],
    };
    const scenario = { name: "purchase", events: [{ id: "purchase", label: "Proposed purchase", date: "2026-11-15",
      driver: "outflow" as const, change: "increase" as const, amountMinor: 100_000,
      basis: { kind: "scenario_override" as const, label: "Founder proposal" } }] };
    const outputs = await Promise.all([
      forecastCashTool.invoke(core, { context }),
      simulateFinancialScenarioTool.invoke({ ...core, scenario, limit: 6 }, { context }),
      compareFinancialScenariosTool.invoke({ ...core, scenarios: [scenario, { name: "no purchase" }] }, { context }),
    ]);
    for (const output of outputs) {
      expect(output.length).toBeLessThan(8000);
      expect(output).toContain("forecast_is_conditional_not_observed_actual");
      expect(output).toContain("management_assumption");
    }
    const forecast = JSON.parse(outputs[0]);
    expect(forecast.data.startingPosition.value.minor).toBe(876_138);
    expect(forecast.data.assumptions[0].description).toContain("unlisted future commitments");
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
