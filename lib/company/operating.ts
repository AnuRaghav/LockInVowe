import {
  readStoredPlanningRecords,
  assertPlanningScope,
  type StoredAssumption,
  type StoredPlanningRecords,
} from "@/lib/finance/planning/stored-source";
import { readAllSourcePages } from "@/lib/finance/source-reader";
import { decimalToMinor, minorToDecimalString } from "@/lib/source/money";
import { createServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/lib/supabase/types";
import { z } from "zod";

/**
 * Access to the company's stated operating plan.
 *
 * `company_assumptions` and the Gusto payroll tables have been written since
 * onboarding existed and read by nothing Sam can reach: the runway floor, the
 * planned hires, the growth target, the headcount and the payroll cost were all
 * durable and invisible. This module is the access path, and *only* the access
 * path - it adds no table, changes no writer, and computes no financial result.
 *
 * Three rules define what it is allowed to do.
 *
 * **It projects, it does not calculate.** Sums of stored values are labelled as
 * sums of stored values. Nothing here divides an annual salary into a monthly
 * burn or turns a plan into a cash trajectory; that is what
 * `simulate_financial_scenario` is for, and it takes explicit basis-labelled
 * assumptions precisely so the translation is visible.
 *
 * **Provenance and missingness travel with every field.** A founder-entered
 * number and a provider-observed one are different kinds of thing, and a field
 * nobody has filled in is missing - never zero. Both distinctions are in the
 * data, not in a caveat the model has to remember.
 *
 * **Two epistemic classes live here, kept apart.** The assumptions are
 * `management_context`: what the company says it intends. The payroll rows are
 * `source_evidence`: what Gusto says happened. They are adjacent in one result
 * because a founder asking "can we afford the hires?" needs both, and each
 * section states its own class rather than the caller inferring one.
 *
 * Deliberately absent: `cash_on_hand_usd`. The Numerical Model establishes cash
 * from connected accounts with its own evaluation time, scope and freshness. A
 * founder-entered cash figure from onboarding offers nothing except the chance
 * for Sam to quote a stale number as current, so it is not exposed at all.
 * Employee names are absent for the same shape of reason: the roster reaches the
 * model as headcount, roles and cost, and never as people.
 */

type PayrollRunRow = Pick<
  Database["public"]["Tables"]["payroll_runs"]["Row"],
  | "company_id"
  | "id"
  | "check_date"
  | "pay_period_start"
  | "pay_period_end"
  | "total_gross_pay_usd"
  | "total_employer_cost_usd"
  | "processed"
>;

/** Everything the operating projection reads. One company, one point in time. */
export interface OperatingRecords extends StoredPlanningRecords {
  payrollRuns: PayrollRunRow[];
}

/** Where one field came from, so a founder-stated value is never mistaken for an observed one. */
export interface OperatingProvenance {
  /** `onboarding`, `derived`, `founder`, or `provider:gusto`. */
  source: string;
  /** Coarse pointer to the record behind it. Never a query or a raw payload. */
  reference: string;
  updatedAt: string;
}

/** A stored number with its provenance. `display` is the only form Sam should quote. */
export interface OperatingAmount {
  usd: number;
  display: string;
  provenance: OperatingProvenance;
}

export interface OperatingCount {
  value: number;
  provenance: OperatingProvenance;
}

export type OperatingGap = {
  field: string;
  reason: "not_recorded" | "invalid_stored_value" | "no_payroll_connection";
};

export interface PlannedHireProjection {
  /** The role, as onboarding recorded it. A role, never a person. */
  title: string;
  startDate: string | null;
  monthlyCost: { usd: number; display: string };
}

export interface OperatingPlanSection {
  /** This section is what the company *says*. See the module note. */
  class: "management_context";
  minimumRunwayMonths: OperatingCount | null;
  monthlyGrowthTargetPct: OperatingCount | null;
  mrr: OperatingAmount | null;
  monthlyExpenses: OperatingAmount | null;
  monthlyPayrollCost: OperatingAmount | null;
  plannedHires: {
    count: number;
    totalMonthlyCost: { usd: number; display: string };
    earliestStartDate: string | null;
    hires: PlannedHireProjection[];
    provenance: OperatingProvenance;
  } | null;
  team: {
    headcount: number;
    totalMonthlyCost: { usd: number; display: string };
    /** Roles only. Names are never projected. */
    roles: string[];
    provenance: OperatingProvenance;
  } | null;
}

export interface OperatingPayrollSection {
  /** This section is what a provider observed. See the module note. */
  class: "source_evidence";
  connected: boolean;
  connectionStatus: string | null;
  lastSyncedAt: string | null;
  activeEmployeeCount: number;
  /** Sum of stored annual base salaries. Base salary only - not employer cost. */
  totalAnnualBaseSalary: { usd: number; display: string } | null;
  /** Employees paid hourly, excluded from the salary sum rather than guessed at. */
  hourlyEmployeeCount: number;
  /** The most recent processed run: the one non-inferred employer cost available. */
  lastProcessedRun: {
    checkDate: string;
    payPeriod: { start: string; end: string };
    totalGrossPay: { usd: number; display: string };
    totalEmployerCost: { usd: number; display: string };
    provenance: OperatingProvenance;
  } | null;
}

export interface OperatingState {
  companyId: string;
  status: "available" | "empty";
  plan: OperatingPlanSection;
  payroll: OperatingPayrollSection;
  /** Fields nobody has recorded, or recorded unusably. Missing is not zero. */
  missing: OperatingGap[];
  caveats: string[];
}

export type OperatingContext = OperatingState | { status: "unavailable"; reason: string };

/** Thrown for an operating read that cannot be completed. Never leaks provider or SQL detail. */
export class OperatingDataUnavailable extends Error {
  constructor(public readonly code: "not_configured" | "unavailable" | "scope_mismatch") {
    super(
      `Company operating plan unavailable: ${code}. Do not substitute conversation figures.`
    );
    this.name = "OperatingDataUnavailable";
  }
}

const usd = z.number().finite().nonnegative();
const hireSchema = z.object({
  title: z.string().min(1),
  startDate: z.string().optional(),
  monthlyCostUsd: usd,
});
/** Onboarding stores a name on a team member. It is read and then dropped. */
const teamSchema = hireSchema.extend({ name: z.string().optional() });

const ACTIVE_EMPLOYMENT = new Set(["active", "onboarding"]);

/**
 * Mirrors `lib/finance/sam-surface.ts`: the exact display string is produced
 * here, never by Sam.
 *
 * Totals are accumulated in integer minor units rather than by adding the
 * stored decimals, following the rule in `lib/source/money.ts` - summing
 * `12.34` twice is already inexact, and a payroll total that drifts by a cent
 * per employee is a number nobody can reconcile.
 */
const moneyFromMinor = (minor: number): { usd: number; display: string } => {
  const display = minorToDecimalString(minor, "USD");
  return { usd: Number(display), display: `USD ${display}` };
};

const money = (usdValue: number): { usd: number; display: string } =>
  moneyFromMinor(decimalToMinor(usdValue, "USD"));

const sumUsd = (values: number[]): number =>
  values.reduce((total, value) => total + decimalToMinor(value, "USD"), 0);

/**
 * Reads every record the projection needs.
 *
 * Reuses `readStoredPlanningRecords` from the planning loader - the same
 * paginated, scope-asserting reader over `company_assumptions`,
 * `payroll_employees` and `payroll_connections` - and adds payroll runs, which
 * carry the only employer cost in the system that was observed rather than
 * assumed.
 *
 * Internal server entry point. `companyId` MUST come from trusted authorization
 * context; no route, tool argument or model output reaches it.
 */
export const readOperatingRecords = async (
  companyId: string,
  client = createServiceClient(),
  signal?: AbortSignal
): Promise<OperatingRecords> => {
  if (!companyId) throw new Error("Company scope is required");
  const requestSignal = signal ?? new AbortController().signal;

  const [stored, payrollRuns] = await Promise.all([
    readStoredPlanningRecords(companyId, client, requestSignal),
    readAllSourcePages<PayrollRunRow>((from, to) =>
      client
        .from("payroll_runs")
        .select(
          "company_id,id,check_date,pay_period_start,pay_period_end,total_gross_pay_usd,total_employer_cost_usd,processed"
        )
        .eq("company_id", companyId)
        .order("id")
        .range(from, to)
        .abortSignal(requestSignal)
    ),
  ]);

  if (payrollRuns.some((run) => run.company_id !== companyId)) {
    throw new OperatingDataUnavailable("scope_mismatch");
  }

  const records = { ...stored, payrollRuns };
  assertPlanningScope(companyId, records);
  return records;
};

/**
 * Projects stored records into the operating state Sam can be shown.
 *
 * Pure: same records in, same projection out. Everything that could fail has
 * already happened by the time this runs, which is what makes the shape
 * testable without a database.
 */
export const projectOperatingState = (
  companyId: string,
  records: OperatingRecords
): OperatingState => {
  assertPlanningScope(companyId, records);

  const missing: OperatingGap[] = [];
  const byKey = new Map<string, StoredAssumption>();
  for (const row of records.assumptions) byKey.set(row.key, row);

  const provenanceFor = (row: StoredAssumption): OperatingProvenance => ({
    source: row.source,
    reference: `company_assumptions:${row.key}`,
    updatedAt: row.updated_at,
  });

  /** Reads one assumption, recording *why* it is absent rather than defaulting it. */
  const read = <T>(key: string, schema: z.ZodType<T>): { value: T; row: StoredAssumption } | null => {
    const row = byKey.get(key);
    if (!row) {
      missing.push({ field: key, reason: "not_recorded" });
      return null;
    }
    const parsed = schema.safeParse(row.value);
    if (!parsed.success) {
      missing.push({ field: key, reason: "invalid_stored_value" });
      return null;
    }
    return { value: parsed.data, row };
  };

  const amount = (key: string): OperatingAmount | null => {
    const stored = read(key, usd);
    if (!stored) return null;
    try {
      return { ...money(stored.value), provenance: provenanceFor(stored.row) };
    } catch {
      missing.push({ field: key, reason: "invalid_stored_value" });
      return null;
    }
  };

  const count = (key: string, schema: z.ZodType<number>): OperatingCount | null => {
    const stored = read(key, schema);
    return stored ? { value: stored.value, provenance: provenanceFor(stored.row) } : null;
  };

  const minimumRunwayMonths = count("minimum_runway_months", z.number().int().min(1).max(120));
  const monthlyGrowthTargetPct = count("monthly_growth_target_pct", z.number().finite());
  const mrr = amount("mrr_usd");
  const monthlyExpenses = amount("monthly_expenses_usd");
  const monthlyPayrollCost = amount("monthly_payroll_cost_usd");

  const storedHires = read("planned_hires", z.array(hireSchema));
  let plannedHires: OperatingPlanSection["plannedHires"] = null;
  if (storedHires && storedHires.value.length > 0) {
    try {
      const hires: PlannedHireProjection[] = storedHires.value.map((hire) => ({
        title: hire.title,
        startDate: hire.startDate ?? null,
        monthlyCost: money(hire.monthlyCostUsd),
      }));

      const startDates = hires
        .map((hire) => hire.startDate)
        .filter((date): date is string => date !== null)
        .sort();

      plannedHires = {
        count: hires.length,
        totalMonthlyCost: moneyFromMinor(
          sumUsd(storedHires.value.map((hire) => hire.monthlyCostUsd))
        ),
        earliestStartDate: startDates[0] ?? null,
        hires,
        provenance: provenanceFor(storedHires.row),
      };
    } catch {
      // An unrepresentable amount makes the whole list untrustworthy: a partial
      // hiring plan read as complete is worse than a plan reported as unusable.
      missing.push({ field: "planned_hires", reason: "invalid_stored_value" });
    }
  }

  const storedTeam = read("current_team", z.array(teamSchema));
  let team: OperatingPlanSection["team"] = null;
  if (storedTeam && storedTeam.value.length > 0) {
    try {
      team = {
        headcount: storedTeam.value.length,
        totalMonthlyCost: moneyFromMinor(
          sumUsd(storedTeam.value.map((member) => member.monthlyCostUsd))
        ),
        // Titles only. `name` is parsed so a malformed row is caught, and then
        // deliberately dropped - see the module note.
        roles: storedTeam.value.map((member) => member.title),
        provenance: provenanceFor(storedTeam.row),
      };
    } catch {
      missing.push({ field: "current_team", reason: "invalid_stored_value" });
    }
  }

  const connection =
    records.payrollConnections.find((row) => row.status === "active") ??
    records.payrollConnections[0] ??
    null;

  const employees = connection
    ? records.employees.filter(
        (employee) =>
          employee.payroll_connection_id === connection.id &&
          ACTIVE_EMPLOYMENT.has(employee.employment_status ?? "") &&
          employee.termination_date === null
      )
    : [];

  const salaried = employees.filter(
    (employee) => employee.payment_unit === "year" && employee.annual_salary_usd !== null
  );

  const lastRun = records.payrollRuns
    .filter((run) => run.processed)
    .sort((a, b) => a.check_date.localeCompare(b.check_date))
    .at(-1);

  if (!connection) missing.push({ field: "payroll", reason: "no_payroll_connection" });

  const payroll: OperatingPayrollSection = {
    class: "source_evidence",
    connected: connection?.status === "active",
    connectionStatus: connection?.status ?? null,
    lastSyncedAt: connection?.last_synced_at ?? null,
    activeEmployeeCount: employees.length,
    // No roster roles: the planning loader's reader does not select employee
    // titles, and `plan.team.roles` already carries the roles the company
    // stated. Adding a second, provider-derived role list would mean widening
    // that reader for a duplicate.
    totalAnnualBaseSalary:
      salaried.length > 0
        ? moneyFromMinor(sumUsd(salaried.map((employee) => Number(employee.annual_salary_usd))))
        : null,
    hourlyEmployeeCount: employees.filter((employee) => employee.payment_unit === "hour").length,
    lastProcessedRun: lastRun
      ? {
          checkDate: lastRun.check_date,
          payPeriod: { start: lastRun.pay_period_start, end: lastRun.pay_period_end },
          totalGrossPay: money(Number(lastRun.total_gross_pay_usd)),
          totalEmployerCost: money(Number(lastRun.total_employer_cost_usd)),
          provenance: {
            source: "provider:gusto",
            reference: "payroll_runs",
            updatedAt: lastRun.check_date,
          },
        }
      : null,
  };

  const plan: OperatingPlanSection = {
    class: "management_context",
    minimumRunwayMonths,
    monthlyGrowthTargetPct,
    mrr,
    monthlyExpenses,
    monthlyPayrollCost,
    plannedHires,
    team,
  };

  const anythingRecorded =
    records.assumptions.length > 0 || employees.length > 0 || payroll.lastProcessedRun !== null;

  return {
    companyId,
    status: anythingRecorded ? "available" : "empty",
    plan,
    payroll,
    missing,
    caveats: [
      "plan_values_are_management_statements_not_observed_financial_actuals",
      "onboarding_values_are_as_of_their_updatedAt_and_may_be_stale",
      "payroll_employer_cost_is_observed_only_for_completed_processed_runs",
      "annual_base_salary_total_excludes_taxes_benefits_and_hourly_staff",
      "cash_is_established_only_by_the_numerical_model_never_by_this_plan",
    ],
  };
};

/** Reads and projects in one call. Never throws for a missing plan - that is `status: "empty"`. */
export const loadOperatingState = async (
  companyId: string,
  options: { client?: ReturnType<typeof createServiceClient>; signal?: AbortSignal } = {}
): Promise<OperatingState> =>
  projectOperatingState(
    companyId,
    await readOperatingRecords(companyId, options.client, options.signal)
  );

/**
 * The compact orientation projection.
 *
 * What Sam is told before it has asked anything: which constraints exist, and
 * roughly how big they are. Enough to know that a runway floor and a hiring
 * plan are on file - and therefore that a question about affording hires is
 * answerable - without paying for the per-hire detail, the roles, or the
 * provenance of every field on a turn that may not need any of it.
 *
 * Display strings only, plus the field names that are missing. A headline that
 * quietly omitted the gaps would read as a complete plan.
 */
export const operatingHeadline = (state: OperatingContext) => {
  if (state.status !== "available" && state.status !== "empty") return state;

  const { plan, payroll } = state;

  return {
    status: state.status,
    class: "management_context" as const,
    runwayFloorMonths: plan.minimumRunwayMonths?.value ?? null,
    monthlyGrowthTargetPct: plan.monthlyGrowthTargetPct?.value ?? null,
    mrr: plan.mrr?.display ?? null,
    monthlyExpenses: plan.monthlyExpenses?.display ?? null,
    statedMonthlyPayrollCost: plan.monthlyPayrollCost?.display ?? null,
    plannedHires: plan.plannedHires
      ? {
          count: plan.plannedHires.count,
          totalMonthlyCost: plan.plannedHires.totalMonthlyCost.display,
          earliestStartDate: plan.plannedHires.earliestStartDate,
        }
      : null,
    team: plan.team ? { headcount: plan.team.headcount } : null,
    payroll: {
      connected: payroll.connected,
      activeEmployeeCount: payroll.activeEmployeeCount,
      lastProcessedRunEmployerCost: payroll.lastProcessedRun?.totalEmployerCost.display ?? null,
      lastSyncedAt: payroll.lastSyncedAt,
    },
    missingFields: state.missing.map((gap) => gap.field),
    more: "Use get_company_plan for per-hire detail, roles, provenance and every stored assumption. Plan values are management statements; translate them into explicit basis-labelled assumptions before forecasting.",
  };
};

export type OperatingHeadline = ReturnType<typeof operatingHeadline>;
