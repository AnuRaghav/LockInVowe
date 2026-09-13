import { tool, type ToolRuntime } from "@langchain/core/tools";
import { z } from "zod";
import { financialSession, requireSamContext, type samRuntimeContextSchema } from "../context";
import { runTool } from "./result";
import { FinancialDataUnavailable } from "@/lib/finance/session";
import { analyzeCashPeriod, deriveFinancialActuals, explainFinancialNumber, financialBurnRunway,
  financialComparison, financialPosition, summarizeCashPeriod } from "@/lib/finance/sam-surface";

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
