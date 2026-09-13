import { tool, type ToolRuntime } from "@langchain/core/tools";
import { z } from "zod";
import { financialSession, requireSamContext, type samRuntimeContextSchema } from "../context";
import { runTool } from "./result";
import { FinancialDataUnavailable } from "@/lib/finance/session";
import { analyzeCashPeriod, deriveFinancialActuals, explainFinancialNumber, financialBurnRunway,
  financialComparison, financialPosition, summarizeCashPeriod } from "@/lib/finance/sam-surface";
import { buildCashForecast, compareCashScenarios, simulateCashScenario, type CashForecastInput } from "@/lib/finance/forecast";
import { forecastConsequences, moneyDifference, presentForecastInputs, summarizeCashForecast } from "@/lib/finance/forecast-sam-surface";

type Runtime = ToolRuntime<unknown, typeof samRuntimeContextSchema>;
const currency = z.string().regex(/^[A-Z]{3}$/).describe("A single observed currency (e.g. USD), never combined currencies.");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const period = z.object({ start: date, endExclusive: date }).strict()
  .describe("Half-open UTC days [start, endExclusive), completed days only. Not a forecast.");
export const financialPositionSchema = z.object({ currency: currency.optional(), offset: z.number().int().min(0).default(0) }).strict();
export const financialCashFlowSchema = z.object({ currency, period }).strict();
export const financialBurnRunwaySchema = z.object({ currency, trailingMonths: z.number().int().min(1).max(120).default(3) }).strict();
export const financialComparisonSchema = z.object({ currency, current: period, prior: period }).strict();
export const financialTraceSchema = z.object({ currency, metric: z.enum(["cash", "credit_position", "cash_movement", "cash_consumption"]),
  period: period.optional(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(5).default(3) }).strict();
const amount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
  .describe("Integer minor currency units. This is an explicit future assumption or delta, never starting cash or an observed actual.");
const basis = z.object({
  kind: z.enum(["management_assumption", "scenario_override", "historical_analysis", "provider_scheduled_activity", "authoritative_connector"]),
  label: z.string().min(1).max(160).describe("Why this future input is being modeled and where it came from."),
  reference: z.string().min(1).max(160).optional(),
}).strict();
const assumption = z.object({ id: z.string().min(1).max(80), description: z.string().min(1).max(240), basis }).strict();
const cashEvent = z.object({
  id: z.string().min(1).max(80), label: z.string().min(1).max(160), date,
  driver: z.enum(["inflow", "outflow"]), change: z.enum(["increase", "decrease"]), amountMinor: amount, basis,
}).strict().describe("One cash effect on a known date, such as a purchase, delayed collection, or financing event. Describe only its cash consequence.");
const recurringDelta = z.object({
  id: z.string().min(1).max(80), label: z.string().min(1).max(160), startDate: date, endExclusive: date.optional(),
  cadence: z.enum(["week", "month"]), driver: z.enum(["inflow", "outflow"]), change: z.enum(["increase", "decrease"]),
  amountMinor: amount, basis,
}).strict().describe("A recurring change. For example, lower monthly spend is driver=outflow, change=decrease; added monthly cost is outflow/increase.");
const baseline = z.discriminatedUnion("method", [
  z.object({ method: z.literal("none") }).strict(),
  z.object({ method: z.literal("historical_recorded_average"), lookbackMonths: z.number().int().min(1).max(120) }).strict(),
  z.object({ method: z.literal("explicit_periodic"), inflowsMinor: amount, outflowsMinor: amount, basis }).strict(),
]).describe("Future cash-flow baseline. Current connected data cannot establish a defensible historical run rate, so historical_recorded_average returns an unavailable baseline; use explicit_periodic only when an explicit assumption has been resolved.");
const forecastCore = z.object({
  currency,
  startDate: date.describe("First forecast day; cannot precede the Numerical Model evaluation date."),
  horizon: z.object({ periods: z.number().int().min(1).max(120), granularity: z.enum(["week", "month"]) }).strict(),
  baseline,
  events: z.array(cashEvent).max(20).default([]),
  recurringDeltas: z.array(recurringDelta).max(20).default([]),
  assumptions: z.array(assumption).max(20).default([]),
  thresholds: z.object({ reserveMinor: amount.optional(), runwayMonths: z.number().int().min(1).max(120).optional() }).strict().optional(),
}).strict();
const page = { offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(12).default(8) };
export const forecastCashSchema = forecastCore.extend(page).strict();
const scenario = z.object({ name: z.string().min(1).max(80), events: z.array(cashEvent).max(20).default([]),
  recurringDeltas: z.array(recurringDelta).max(20).default([]), assumptions: z.array(assumption).max(20).default([]) }).strict();
export const simulateFinancialScenarioSchema = forecastCore.extend({ scenario, ...page }).strict();
export const compareFinancialScenariosSchema = forecastCore.extend({ scenarios: z.array(scenario).min(1).max(8) }).strict();

function forecastInput(input: z.infer<typeof forecastCore>): CashForecastInput {
  return { currency: input.currency, startDate: input.startDate, horizon: input.horizon, baseline: input.baseline,
    events: input.events, recurringDeltas: input.recurringDeltas, assumptions: input.assumptions, thresholds: input.thresholds };
}
async function data(runtime: Runtime, name: string) {
  const context = requireSamContext(runtime, name);
  const result = await financialSession(context).read();
  if (result.actuals.companyId !== context.companyId || result.reconciled.companyId !== context.companyId)
    throw new FinancialDataUnavailable("scope_mismatch");
  return result;
}
export const financialPositionTool = tool(async (input, runtime: Runtime) => runTool(async () => {
  const { actuals } = await data(runtime, "financial_position");
  if (input.currency) return financialPosition(actuals, input.currency);
  const currencies = actuals.currencies.map(c => c.currency);
  return { companyId: actuals.companyId, evaluatedAt: actuals.evaluatedAt, currencies: currencies.slice(input.offset, input.offset + 20),
    total: currencies.length, nextOffset: input.offset + 20 < currencies.length ? input.offset + 20 : null,
    status: currencies.length ? "qualified" : "no_eligible_accounts", instruction: "Select one currency to read its observed position; never combine currencies." };
}), { name: "financial_position", schema: financialPositionSchema,
  description: "Read observed cash and signed credit positions for a currency from connected data, with scope and freshness. Omit currency to discover observed currencies (paged by offset). Never supply cash/revenue/expense inputs or company identity. Missing or stale data is not zero or current company truth." });
export const financialCashFlowTool = tool(async (input, runtime: Runtime) => runTool(async () => {
  const { reconciled } = await data(runtime, "financial_cash_flow");
  return { companyId: reconciled.companyId, ...summarizeCashPeriod(analyzeCashPeriod(reconciled, input.currency, input.period)) };
}), { name: "financial_cash_flow", schema: financialCashFlowSchema,
  description: "Analyze recorded cash movements for completed UTC days: internal transfers, repayments, unresolved amounts and external-flow availability. Recorded movement is not balance-to-balance cash change or operating burn. Use explain_financial_number for contributing evidence." });
export const financialBurnRunwayTool = tool(async (input, runtime: Runtime) => runTool(async () => {
  const { reconciled, actuals } = await data(runtime, "financial_burn_runway");
  return financialBurnRunway(input.trailingMonths === actuals.windows.months ? actuals :
    deriveFinancialActuals(reconciled, { trailingMonths: input.trailingMonths }), input.currency);
}), { name: "financial_burn_runway", schema: financialBurnRunwaySchema,
  description: "Get supported burn/runway status and reasons, historical basis, and recorded cash-consumption comparison. May correctly return unavailable burn/runway. Never infer operating burn from account debits or calculate a substitute runway. Only window length and currency are selectable." });
export const financialComparisonTool = tool(async (input, runtime: Runtime) => runTool(async () => {
  const { reconciled } = await data(runtime, "compare_financial_periods");
  return financialComparison(reconciled, input.currency, input.current, input.prior);
}), { name: "compare_financial_periods", schema: financialComparisonSchema,
  description: "Compare deterministic recorded cash movement and consumption across two periods. Returns exact deltas, separate uncertainty, qualifications and operating-burn trend availability. Different-length periods compare totals, not normalized rates." });
export const financialTraceTool = tool(async (input, runtime: Runtime) => runTool(async () => {
  const { reconciled, actuals } = await data(runtime, "explain_financial_number");
  return explainFinancialNumber(reconciled, actuals, input);
}), { name: "explain_financial_number", schema: financialTraceSchema,
  description: "Explain cash, credit position, recorded cash movement or cash consumption with calculation basis and paged Source evidence. Cash/credit are current (omit period); movement/consumption require a period. Totals always cover the full scope; evidence pages are partial. Never sum pages, classify entries or infer vendors yourself. Lower limit if the harness requests a smaller result." });

export const forecastCashTool = tool(async (input, runtime: Runtime) => runTool(async () => {
  const { actuals } = await data(runtime, "forecast_cash");
  return summarizeCashForecast(buildCashForecast(actuals, forecastInput(input)), input);
}), { name: "forecast_cash", schema: forecastCashSchema,
  description: "Produce a deterministic, paged cash trajectory from the connected observed cash position plus explicit future assumptions. Resolve missing plans or management assumptions with memory tools first; never invent revenue, payroll, commitments, or starting cash. Use baseline=none for a deliberately partial known-deltas trajectory. The connected actual cash position cannot be overridden. Returns conditional consequences, basis/provenance, qualifications, zero/reserve/runway thresholds, and complete-horizon derived totals even when trajectory rows are paged." });

export const simulateFinancialScenarioTool = tool(async (input, runtime: Runtime) => runTool(async () => {
  const { actuals } = await data(runtime, "simulate_financial_scenario");
  const result = simulateCashScenario(actuals, forecastInput(input), input.scenario);
  const baselineSummary = forecastConsequences(result.baseline);
  const scenarioSummary = forecastConsequences(result.scenario);
  const { qualifications: baselineQualifications, ...baselineConsequences } = baselineSummary;
  const { qualifications: scenarioQualifications, ...scenarioConsequences } = scenarioSummary;
  return {
    version: result.version, name: result.name,
    baseline: baselineConsequences,
    scenario: scenarioConsequences,
    qualifications: [...new Set([...baselineQualifications, ...scenarioQualifications])].sort(),
    baselineInputs: presentForecastInputs(input.currency, { baseline: input.baseline, events: input.events,
      recurringDeltas: input.recurringDeltas, assumptions: input.assumptions }),
    difference: result.difference ? {
      endingCash: moneyDifference(result.difference.endingCashMinor, input.currency),
      minimumCash: moneyDifference(result.difference.minimumCashMinor, input.currency),
      cumulativeIncrementalCashImpact: moneyDifference(result.difference.cumulativeIncrementalCashImpactMinor, input.currency),
    } : null,
    scenarioInputs: { name: input.scenario.name, ...presentForecastInputs(input.currency, input.scenario) },
    trajectory: summarizeCashForecast(result.scenario, input).trajectory,
    pagination: summarizeCashForecast(result.scenario, input).pagination,
    instruction: "The baseline and scenario share connected starting cash and baseline assumptions. Differences are deterministic consequences, not a recommendation.",
  };
}), { name: "simulate_financial_scenario", schema: simulateFinancialScenarioSchema,
  description: "Apply one named set of explicit cash-flow deltas to a baseline and compare deterministic consequences. Use this generic primitive for hiring cost, spend changes, delayed cash, financing, customer loss, or purchases only after translating the business plan into explicit cash effects with a stated basis. Retrieve semantic context first when amounts/dates/constraints are missing. This tool computes consequences; it does not decide affordability or invent business drivers." });

export const compareFinancialScenariosTool = tool(async (input, runtime: Runtime) => runTool(async () => {
  const { actuals } = await data(runtime, "compare_financial_scenarios");
  const result = compareCashScenarios(actuals, forecastInput(input), input.scenarios);
  const baselineSummary = forecastConsequences(result.baseline);
  const scenarioSummaries = result.scenarios.map(item => ({ item, summary: forecastConsequences(item.forecast) }));
  const qualifications = [...new Set([baselineSummary.qualifications,
    ...scenarioSummaries.map(({ summary }) => summary.qualifications)].flat())].sort();
  const { qualifications: _baselineQualifications, ...baselineConsequences } = baselineSummary;
  return {
    version: result.version,
    currency: input.currency,
    baseline: baselineConsequences,
    qualifications,
    baselineInputs: presentForecastInputs(input.currency, { baseline: input.baseline, events: input.events, recurringDeltas: input.recurringDeltas, assumptions: input.assumptions }),
    scenarios: scenarioSummaries.map(({ item, summary }, index) => {
      const { qualifications: _scenarioQualifications, ...consequences } = summary;
      const scenarioInput = input.scenarios[index];
      return {
        name: item.name,
        consequences,
        difference: item.difference ? {
          endingCash: moneyDifference(item.difference.endingCashMinor, input.currency),
          minimumCash: moneyDifference(item.difference.minimumCashMinor, input.currency),
          cumulativeIncrementalCashImpact: moneyDifference(item.difference.cumulativeIncrementalCashImpactMinor, input.currency),
        } : null,
        inputs: { name: scenarioInput.name, ...presentForecastInputs(input.currency, scenarioInput) },
      };
    }),
    instruction: "Compare conditional consequences and qualifications. Use forecast_cash for trajectory rows if a scenario needs deeper inspection.",
  };
}), { name: "compare_financial_scenarios", schema: compareFinancialScenariosSchema,
  description: "Compare 1-8 arbitrary named deterministic cash scenarios against the same connected starting position and baseline assumptions. Returns ending/minimum cash, zero/reserve/runway thresholds, and cumulative incremental impact without large trajectories. Use after explicit scenario inputs are known; call forecast_cash for period-by-period investigation. Names such as base, bear, or bull have no hardcoded meaning." });
