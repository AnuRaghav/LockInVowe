import { minorToDecimalString } from "@/lib/source/money";
import type { CashForecast, ForecastBaseline, ForecastCashEvent, ForecastRecurringDelta } from "./forecast";

const money = (minor: number | null, currency: string) => ({
  minor,
  display: minor === null ? "unavailable" : `${currency} ${minorToDecimalString(minor, currency)}`,
});

function monthsDisplay(value: { numerator: number; denominator: number }) {
  const scaled = Math.round((value.numerator * 100) / value.denominator);
  return `${Math.floor(scaled / 100)}.${String(scaled % 100).padStart(2, "0")} months`;
}

function presentBaseline(value: ForecastBaseline, currency: string) {
  return value.method === "explicit_periodic" ? {
    method: value.method, inflows: money(value.inflowsMinor, currency), outflows: money(value.outflowsMinor, currency), basis: value.basis,
  } : value;
}

export function presentForecastInputs(currency: string, input: {
  baseline?: ForecastBaseline;
  events?: ForecastCashEvent[];
  recurringDeltas?: ForecastRecurringDelta[];
  assumptions?: unknown[];
}) {
  const monetary = <T extends ForecastCashEvent | ForecastRecurringDelta>(item: T) => ({
    ...item, amount: money(item.amountMinor, currency), amountMinor: undefined,
  });
  return {
    ...(input.baseline ? { baseline: presentBaseline(input.baseline, currency) } : {}),
    events: (input.events ?? []).map(monetary),
    recurringDeltas: (input.recurringDeltas ?? []).map(monetary),
    assumptions: input.assumptions ?? [],
  };
}

function baseline(value: CashForecast) {
  return {
    ...value.baseline,
    inflows: money(value.baseline.inflowsMinor, value.currency),
    outflows: money(value.baseline.outflowsMinor, value.currency),
    inflowsMinor: undefined,
    outflowsMinor: undefined,
  };
}

function derived(value: CashForecast) {
  if (!value.derived) return null;
  const runway = value.derived.runway.status === "projected_within_horizon"
    ? { ...value.derived.runway, monthsDisplay: monthsDisplay(value.derived.runway.months) }
    : value.derived.runway;
  return {
    endingCash: money(value.derived.endingCashMinor, value.currency),
    minimumCash: money(value.derived.minimumCashMinor, value.currency),
    minimumCashDate: value.derived.minimumCashDate,
    zeroCash: value.derived.zeroCash,
    reserveThreshold: value.derived.reserveThreshold ? {
      ...value.derived.reserveThreshold,
      amount: money(value.derived.reserveThreshold.amountMinor, value.currency),
      amountMinor: undefined,
    } : null,
    runway,
    runwayThreshold: value.derived.runwayThreshold,
    cumulativeIncrementalCashImpact: money(value.derived.cumulativeIncrementalCashImpactMinor, value.currency),
  };
}

export function forecastConsequences(value: CashForecast) {
  return {
    status: value.status,
    currency: value.currency,
    startDate: value.startDate,
    horizon: value.horizon,
    endingCash: value.derived ? money(value.derived.endingCashMinor, value.currency) : money(null, value.currency),
    minimumCash: value.derived ? money(value.derived.minimumCashMinor, value.currency) : money(null, value.currency),
    minimumCashDate: value.derived?.minimumCashDate ?? null,
    zeroCash: value.derived?.zeroCash ?? null,
    reserveThreshold: value.derived?.reserveThreshold ? {
      ...value.derived.reserveThreshold,
      amount: money(value.derived.reserveThreshold.amountMinor, value.currency),
      amountMinor: undefined,
    } : null,
    runway: value.derived ? (value.derived.runway.status === "projected_within_horizon"
      ? { ...value.derived.runway, monthsDisplay: monthsDisplay(value.derived.runway.months) }
      : value.derived.runway) : null,
    runwayThreshold: value.derived?.runwayThreshold ?? null,
    cumulativeIncrementalCashImpact: value.derived
      ? money(value.derived.cumulativeIncrementalCashImpactMinor, value.currency)
      : money(null, value.currency),
    qualifications: value.qualifications,
  };
}

export function summarizeCashForecast(value: CashForecast, page: { offset: number; limit: number }) {
  const rows = value.trajectory.slice(page.offset, page.offset + page.limit).map(row => ({
    index: row.index,
    period: { start: row.start, endExclusive: row.endExclusive },
    openingCash: money(row.openingCashMinor, value.currency),
    incrementalCashImpact: money(row.incrementalCashImpactMinor, value.currency),
    inflows: money(row.inflowsMinor, value.currency),
    outflows: money(row.outflowsMinor, value.currency),
    inflowReductions: money(row.inflowReductionsMinor, value.currency),
    outflowReductions: money(row.outflowReductionsMinor, value.currency),
    netChange: money(row.netChangeMinor, value.currency),
    endingCash: money(row.endingCashMinor, value.currency),
    applied: row.applied.map(item => ({ id: item.id, label: item.label, occurrenceDate: item.occurrenceDate })),
  }));
  return {
    version: value.version,
    status: value.status,
    companyId: value.companyId,
    currency: value.currency,
    evaluatedAt: value.evaluatedAt,
    startDate: value.startDate,
    horizon: value.horizon,
    startingPosition: {
      ...value.startingPosition,
      value: money(value.startingPosition.valueMinor, value.currency),
      observedSubtotal: money(value.startingPosition.observedSubtotalMinor, value.currency),
      valueMinor: undefined,
      observedSubtotalMinor: undefined,
    },
    baseline: baseline(value),
    ...presentForecastInputs(value.currency, { events: value.events, recurringDeltas: value.recurringDeltas, assumptions: value.assumptions }),
    derived: derived(value),
    trajectory: rows,
    pagination: {
      offset: page.offset,
      total: value.trajectory.length,
      nextOffset: page.offset + page.limit < value.trajectory.length ? page.offset + page.limit : null,
    },
    qualifications: value.qualifications,
    instruction: "Trajectory pages are partial; derived consequences use the complete modeled horizon. Do not sum pages yourself.",
  };
}

export function moneyDifference(value: number | null, currency: string) {
  return money(value, currency);
}
