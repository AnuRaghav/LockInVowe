import type { FinancialActuals } from "./actuals";

export type ForecastGranularity = "week" | "month";
export type ForecastBasisKind =
  | "management_assumption"
  | "scenario_override"
  | "historical_analysis"
  | "provider_scheduled_activity"
  | "authoritative_connector";

export interface ForecastBasis {
  kind: ForecastBasisKind;
  label: string;
  reference?: string;
}

export interface ForecastAssumption {
  id: string;
  description: string;
  basis: ForecastBasis;
}

export type ForecastBaseline =
  | { method: "none" }
  | { method: "historical_recorded_average"; lookbackMonths: number }
  | {
      method: "explicit_periodic";
      inflowsMinor: number;
      outflowsMinor: number;
      basis: ForecastBasis;
    };

export interface ForecastCashEvent {
  id: string;
  label: string;
  date: string;
  driver: "inflow" | "outflow";
  change: "increase" | "decrease";
  amountMinor: number;
  basis: ForecastBasis;
}

export interface ForecastRecurringDelta {
  id: string;
  label: string;
  startDate: string;
  endExclusive?: string;
  cadence: ForecastGranularity;
  driver: "inflow" | "outflow";
  change: "increase" | "decrease";
  amountMinor: number;
  basis: ForecastBasis;
}

export interface ForecastThresholds {
  reserveMinor?: number;
  runwayMonths?: number;
}

export interface CashForecastInput {
  currency: string;
  startDate: string;
  horizon: { periods: number; granularity: ForecastGranularity };
  baseline: ForecastBaseline;
  events?: ForecastCashEvent[];
  recurringDeltas?: ForecastRecurringDelta[];
  assumptions?: ForecastAssumption[];
  thresholds?: ForecastThresholds;
}

export interface ForecastTrajectoryRow {
  index: number;
  start: string;
  endExclusive: string;
  openingCashMinor: number;
  baselineInflowsMinor: number;
  baselineOutflowsMinor: number;
  inflowDeltaMinor: number;
  outflowDeltaMinor: number;
  incrementalCashImpactMinor: number;
  inflowsMinor: number;
  outflowsMinor: number;
  inflowReductionsMinor: number;
  outflowReductionsMinor: number;
  netChangeMinor: number;
  endingCashMinor: number;
  applied: Array<{ id: string; label: string; occurrenceDate: string; basis: ForecastBasis }>;
}

const DAY_MS = 86_400_000;

function exact(value: number, label = "monetary value") {
  if (!Number.isSafeInteger(value)) throw new Error(`Unsafe ${label}`);
  return value === 0 ? 0 : value;
}

function sum(values: number[]) {
  return exact(Number(values.reduce((total, value) => total + BigInt(exact(value)), BigInt(0))), "monetary aggregate");
}

function day(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) ||
      new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) throw new Error("Invalid UTC date");
  return value;
}

function addDays(value: string, days: number) {
  const date = new Date(`${day(value)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Calendar-month addition anchored to the original day, clamped at month end. */
function addMonths(value: string, months: number) {
  const source = new Date(`${day(value)}T00:00:00.000Z`);
  const target = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(source.getUTCDate(), last));
  return target.toISOString().slice(0, 10);
}

function advance(value: string, count: number, granularity: ForecastGranularity) {
  return granularity === "week" ? addDays(value, 7 * count) : addMonths(value, count);
}

function validateBasis(basis: ForecastBasis) {
  if (!basis.label.trim()) throw new Error("Every future input needs a non-empty basis label");
}

function validateInput(input: CashForecastInput) {
  day(input.startDate);
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new Error("Invalid currency");
  if (!Number.isSafeInteger(input.horizon.periods) || input.horizon.periods < 1 || input.horizon.periods > 120)
    throw new Error("Forecast horizon must contain 1-120 periods");
  if (input.baseline.method === "explicit_periodic") {
    exact(input.baseline.inflowsMinor); exact(input.baseline.outflowsMinor); validateBasis(input.baseline.basis);
    if (input.baseline.inflowsMinor < 0 || input.baseline.outflowsMinor < 0) throw new Error("Baseline flows must be non-negative");
  }
  if (input.baseline.method === "historical_recorded_average" &&
      (!Number.isSafeInteger(input.baseline.lookbackMonths) || input.baseline.lookbackMonths < 1 || input.baseline.lookbackMonths > 120))
    throw new Error("Historical lookback must contain 1-120 months");
  if (input.thresholds?.reserveMinor !== undefined) {
    exact(input.thresholds.reserveMinor);
    if (input.thresholds.reserveMinor < 0) throw new Error("Cash reserve threshold must be non-negative");
  }
  if (input.thresholds?.runwayMonths !== undefined &&
      (!Number.isSafeInteger(input.thresholds.runwayMonths) || input.thresholds.runwayMonths < 1 || input.thresholds.runwayMonths > 120))
    throw new Error("Runway threshold must be 1-120 months");

  const ids = new Set<string>();
  for (const item of [...(input.events ?? []), ...(input.recurringDeltas ?? []), ...(input.assumptions ?? [])]) {
    if (!item.id.trim() || ids.has(item.id)) throw new Error("Forecast input ids must be non-empty and unique");
    ids.add(item.id); validateBasis(item.basis);
    const text = "description" in item ? item.description : item.label;
    if (!text.trim()) throw new Error("Forecast assumptions and deltas need a non-empty description");
  }
  for (const event of input.events ?? []) {
    day(event.date); exact(event.amountMinor);
    if (event.amountMinor < 0) throw new Error("Event amounts must be non-negative");
    if (event.date < input.startDate) throw new Error("One-time events cannot precede forecast start");
  }
  for (const delta of input.recurringDeltas ?? []) {
    day(delta.startDate); if (delta.endExclusive) day(delta.endExclusive); exact(delta.amountMinor);
    if (delta.amountMinor < 0) throw new Error("Recurring amounts must be non-negative");
    if (delta.startDate < input.startDate) throw new Error("Recurring changes cannot precede forecast start");
    if (delta.endExclusive && delta.endExclusive <= delta.startDate) throw new Error("Recurring end must follow its start");
  }
}

function signedDelta(driver: "inflow" | "outflow", change: "increase" | "decrease", amount: number) {
  const direction = change === "increase" ? 1 : -1;
  return driver === "inflow" ? { inflow: exact(direction * amount), outflow: 0 } : { inflow: 0, outflow: exact(direction * amount) };
}

function occurrences(delta: ForecastRecurringDelta, horizonEnd: string) {
  const dates: string[] = [];
  for (let index = 0; index <= 1200; index += 1) {
    const date = advance(delta.startDate, index, delta.cadence);
    if (date >= horizonEnd || (delta.endExclusive && date >= delta.endExclusive)) break;
    if (date >= delta.startDate) dates.push(date);
  }
  return dates;
}

function daysBetween(start: string, end: string) {
  return Math.max(0, Math.round((Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / DAY_MS));
}

export type CashForecast = ReturnType<typeof buildCashForecast>;

/**
 * Cash-centered conditional projection over Source-derived observed cash.
 * Starting cash is deliberately not an input: callers cannot override connected actuals.
 */
export function buildCashForecast(actuals: FinancialActuals, input: CashForecastInput) {
  validateInput(input);
  const actual = actuals.currencies.find(item => item.currency === input.currency);
  if (!actual) throw new Error("No observed eligible cash scope for that currency. Missing scope is not zero.");
  if (input.startDate < actuals.evaluatedAt.slice(0, 10)) throw new Error("Forecast start cannot precede the Numerical Model evaluation date");

  const explicitBaseline = input.baseline.method === "explicit_periodic" ? input.baseline : null;
  const baselineAvailable = explicitBaseline !== null;
  const baseline = {
    requestedMethod: input.baseline.method,
    status: baselineAvailable ? "conditional" as const : "unavailable" as const,
    method: baselineAvailable ? "explicit_periodic_cash_flow_assumption" : "no_defensible_historical_baseline",
    inflowsMinor: explicitBaseline?.inflowsMinor ?? 0,
    outflowsMinor: explicitBaseline?.outflowsMinor ?? 0,
    basis: explicitBaseline?.basis ?? null,
    reasons: baselineAvailable ? [] : input.baseline.method === "historical_recorded_average"
      ? ["history_completeness_unknown", "operating_classification_unavailable", "recorded_cash_movement_not_a_defensible_future_run_rate"]
      : ["no_baseline_cash_flow_assumption_supplied"],
  };
  const startingCash = actual.cash.valueMinor;
  const startingPosition = {
    status: actual.cash.status,
    nature: actual.cash.nature,
    method: actual.cash.method,
    valueMinor: startingCash,
    observedSubtotalMinor: actual.cash.observedSubtotalMinor,
    evaluatedAt: actuals.evaluatedAt,
    accountIds: actual.cash.accountIds,
    missingAccountIds: actual.cash.missingAccountIds,
    coverage: actual.cash.coverage,
    duplicateAccountRisk: actual.cash.duplicateAccountRisk,
    caveats: actual.cash.caveats,
    issues: actual.cash.issues,
  };
  const qualifications = [...new Set([
    "forecast_is_conditional_not_observed_actual",
    "future_inputs_are_limited_to_explicit_assumptions_and_events",
    "no_fx_conversion_currencies_are_separate",
    "period_end_threshold_resolution",
    ...([...(input.events ?? []), ...(input.recurringDeltas ?? [])].some(item => item.change === "decrease")
      ? ["flow_decreases_are_incremental_cash_effects_and_are_shown_separately_from_inflows_outflows"] : []),
    ...(baselineAvailable ? [] : ["trajectory_omits_unmodeled_baseline_activity"]),
    ...actual.cash.caveats,
    ...actual.cash.issues,
  ])].sort();

  if (startingCash === null) {
    return {
      version: "forecast-v1" as const, status: "unavailable" as const, companyId: actuals.companyId,
      currency: input.currency, evaluatedAt: actuals.evaluatedAt, startDate: input.startDate,
      horizon: input.horizon, startingPosition, baseline,
      assumptions: input.assumptions ?? [], events: input.events ?? [], recurringDeltas: input.recurringDeltas ?? [],
      trajectory: [] as ForecastTrajectoryRow[], derived: null,
      qualifications: [...new Set([...qualifications, "starting_cash_position_unavailable"])].sort(),
    };
  }

  const boundaries = Array.from({ length: input.horizon.periods + 1 }, (_, index) => advance(input.startDate, index, input.horizon.granularity));
  const horizonEnd = boundaries.at(-1)!;
  const recurring = (input.recurringDeltas ?? []).flatMap(delta => occurrences(delta, horizonEnd).map(date => ({ delta, date })));
  let cash = startingCash;
  const trajectory: ForecastTrajectoryRow[] = [];
  for (let index = 0; index < input.horizon.periods; index += 1) {
    const start = boundaries[index]; const endExclusive = boundaries[index + 1];
    const applied = [
      ...(input.events ?? []).filter(event => event.date >= start && event.date < endExclusive)
        .map(event => ({ item: event, date: event.date })),
      ...recurring.filter(item => item.date >= start && item.date < endExclusive)
        .map(item => ({ item: item.delta, date: item.date })),
    ];
    const deltas = applied.map(({ item }) => signedDelta(item.driver, item.change, item.amountMinor));
    const inflowDeltaMinor = sum(deltas.map(delta => delta.inflow));
    const outflowDeltaMinor = sum(deltas.map(delta => delta.outflow));
    const incrementalCashImpactMinor = sum([inflowDeltaMinor, -outflowDeltaMinor]);
    const netChangeMinor = sum([baseline.inflowsMinor, -baseline.outflowsMinor, incrementalCashImpactMinor]);
    const endingCashMinor = sum([cash, netChangeMinor]);
    trajectory.push({
      index, start, endExclusive, openingCashMinor: cash,
      baselineInflowsMinor: baseline.inflowsMinor, baselineOutflowsMinor: baseline.outflowsMinor,
      inflowDeltaMinor, outflowDeltaMinor, incrementalCashImpactMinor,
      inflowsMinor: sum([baseline.inflowsMinor, Math.max(0, inflowDeltaMinor)]),
      outflowsMinor: sum([baseline.outflowsMinor, Math.max(0, outflowDeltaMinor)]),
      inflowReductionsMinor: Math.max(0, -inflowDeltaMinor), outflowReductionsMinor: Math.max(0, -outflowDeltaMinor),
      netChangeMinor, endingCashMinor,
      applied: applied.map(({ item, date }) => ({ id: item.id, label: item.label, occurrenceDate: date, basis: item.basis })),
    });
    cash = endingCashMinor;
  }

  const endingCashMinor = trajectory.at(-1)!.endingCashMinor;
  const candidates = [{ cash: startingCash, date: input.startDate }, ...trajectory.map(row => ({ cash: row.endingCashMinor, date: row.endExclusive }))];
  const minimum = candidates.reduce((lowest, candidate) => candidate.cash < lowest.cash ? candidate : lowest);
  const crossing = (threshold: number) => candidates.find(candidate => candidate.cash <= threshold) ?? null;
  const zero = crossing(0);
  const reserve = input.thresholds?.reserveMinor === undefined ? null : crossing(input.thresholds.reserveMinor);
  const runway = zero ? {
    status: "projected_within_horizon" as const, zeroCashDate: zero.date, days: daysBetween(input.startDate, zero.date),
    months: { numerator: daysBetween(input.startDate, zero.date) * 400, denominator: 12175 },
    method: "time_from_forecast_start_to_first_period_end_at_or_below_zero",
  } : {
    status: "beyond_horizon" as const, zeroCashDate: null, atLeastDays: daysBetween(input.startDate, horizonEnd),
    method: "no_zero_cash_crossing_within_modeled_horizon",
  };
  let runwayThreshold: null | Record<string, unknown> = null;
  if (input.thresholds?.runwayMonths !== undefined) {
    if (!zero) runwayThreshold = { status: "unavailable", months: input.thresholds.runwayMonths, crossingDate: null,
      reason: "zero_cash_not_observed_within_horizon" };
    else {
      const point = candidates.find(candidate => zero.date <= addMonths(candidate.date, input.thresholds!.runwayMonths!));
      runwayThreshold = { status: point ? "crossed" : "not_crossed", months: input.thresholds.runwayMonths,
        crossingDate: point?.date ?? null, zeroCashDate: zero.date,
        method: "first_trajectory_boundary_with_zero_cash_within_requested_calendar_months" };
    }
  }

  return {
    version: "forecast-v1" as const, status: "conditional" as const, companyId: actuals.companyId,
    currency: input.currency, evaluatedAt: actuals.evaluatedAt, startDate: input.startDate,
    horizon: input.horizon, startingPosition, baseline,
    assumptions: input.assumptions ?? [], events: input.events ?? [], recurringDeltas: input.recurringDeltas ?? [], trajectory,
    derived: {
      endingCashMinor, minimumCashMinor: minimum.cash, minimumCashDate: minimum.date,
      zeroCash: zero ? { status: "crossed" as const, crossingDate: zero.date } : { status: "not_crossed_within_horizon" as const, crossingDate: null },
      reserveThreshold: input.thresholds?.reserveMinor === undefined ? null : {
        amountMinor: input.thresholds.reserveMinor, status: reserve ? "crossed" as const : "not_crossed_within_horizon" as const,
        crossingDate: reserve?.date ?? null,
      },
      runway, runwayThreshold,
      cumulativeIncrementalCashImpactMinor: sum(trajectory.map(row => row.incrementalCashImpactMinor)),
    },
    qualifications,
  };
}

export interface NamedForecastScenario {
  name: string;
  events?: ForecastCashEvent[];
  recurringDeltas?: ForecastRecurringDelta[];
  assumptions?: ForecastAssumption[];
}

export function simulateCashScenario(actuals: FinancialActuals, input: CashForecastInput, scenario: NamedForecastScenario) {
  if (!scenario.name.trim()) throw new Error("Scenario name is required");
  const baseline = buildCashForecast(actuals, input);
  const forecast = buildCashForecast(actuals, {
    ...input,
    events: [...(input.events ?? []), ...(scenario.events ?? [])],
    recurringDeltas: [...(input.recurringDeltas ?? []), ...(scenario.recurringDeltas ?? [])],
    assumptions: [...(input.assumptions ?? []), ...(scenario.assumptions ?? [])],
  });
  const difference = baseline.derived && forecast.derived ? {
    endingCashMinor: sum([forecast.derived.endingCashMinor, -baseline.derived.endingCashMinor]),
    minimumCashMinor: sum([forecast.derived.minimumCashMinor, -baseline.derived.minimumCashMinor]),
    cumulativeIncrementalCashImpactMinor: sum([
      forecast.derived.cumulativeIncrementalCashImpactMinor,
      -baseline.derived.cumulativeIncrementalCashImpactMinor,
    ]),
  } : null;
  return { version: "scenario-v1" as const, name: scenario.name, baseline, scenario: forecast, difference };
}

export function compareCashScenarios(actuals: FinancialActuals, input: CashForecastInput, scenarios: NamedForecastScenario[]) {
  if (scenarios.length < 1 || scenarios.length > 8) throw new Error("Compare between 1 and 8 scenarios");
  const names = scenarios.map(scenario => scenario.name.trim());
  if (names.some(name => !name) || new Set(names).size !== names.length) throw new Error("Scenario names must be non-empty and unique");
  const baseline = buildCashForecast(actuals, input);
  const results = scenarios.map(scenario => simulateCashScenario(actuals, input, scenario));
  return { version: "scenario-comparison-v1" as const, baseline, scenarios: results.map(result => ({
    name: result.name, forecast: result.scenario, difference: result.difference,
  })) };
}
