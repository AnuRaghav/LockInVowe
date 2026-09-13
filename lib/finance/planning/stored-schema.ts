import { z } from "zod";
import { date } from "./math";

const minor = z.number().finite().int().min(0).max(Number.MAX_SAFE_INTEGER);
const utcDate = z.string().refine(value => { try { date(value); return true; } catch { return false; } }, "Invalid UTC date");
const rate = z.number().int().min(0).max(10_000);
const cost = z.object({ id: z.string().min(1), date: utcDate, amountMinor: minor, kind: z.enum(["operating", "capital"]) }).strict();
const raise = z.object({ id: z.string().min(1), date: utcDate, amountMinor: minor, feesMinor: minor }).strict();

/** Supplemental assumptions only. No user/company id, observed cash, or stored-value overrides. */
export const planningRequestSchema = z.object({
  startDate: utcDate.optional(),
  months: z.number().int().min(1).max(120).default(24),
  assumptions: z.object({
    label: z.string().trim().min(1).max(200),
    useStoredRevenueProxy: z.boolean().optional(),
    revenue: z.object({
      newMrrMinor: minor,
      newSalesGrowthBps: z.number().int().min(-10_000).max(100_000),
      churnBps: rate, contractionBps: rate, expansionBps: z.number().int().min(0).max(100_000),
    }).strict().optional(),
    collectionRateBps: rate.optional(),
    collectionLagMonths: z.number().int().min(0).max(120).optional(),
    openingReceivableCollectionsMinor: z.array(minor).max(120).optional(),
    costOfRevenueBps: z.number().int().min(0).max(100_000).optional(),
    expenseScope: z.enum(["excludes_payroll_and_cogs", "includes_payroll_excludes_cogs"]).optional(),
    oneTimeCosts: z.array(cost).max(240).optional(),
    raises: z.array(raise).max(120).optional(),
    payrollBurden: z.object({ payrollTaxBps: rate, monthlyBenefitsMinor: minor, monthlyCommissionMinor: minor,
      hoursPerMonth: z.number().int().min(0).max(744).optional() }).strict().optional(),
  }).strict().optional(),
}).strict();
/** Raw request shape before defaults are applied by the parser. */
export type PlanningRequest = z.input<typeof planningRequestSchema>;
