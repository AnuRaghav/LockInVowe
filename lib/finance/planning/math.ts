/** Exact minor-unit arithmetic; rates are integer basis points (100 bps = 1%). */
export function integer(value: number, name: string, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}`);
  return value;
}

export function money(value: number) {
  return integer(value, "money", -Number.MAX_SAFE_INTEGER);
}

export function sum(...values: number[]) {
  return money(Number(values.reduce((total, value) => total + BigInt(money(value)), BigInt(0))));
}

/** Half away from zero, rounded once after the exact rational multiplication. */
export function multiply(value: number, numerator: number, denominator = 10_000) {
  money(value); money(numerator); integer(denominator, "denominator", 1);
  const product = BigInt(value) * BigInt(numerator);
  const magnitude = product < BigInt(0) ? -product : product;
  const divisor = BigInt(denominator);
  const rounded = (magnitude + divisor / BigInt(2)) / divisor;
  return money(Number(product < BigInt(0) ? -rounded : rounded));
}

export function date(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error("Invalid UTC date");
  return value;
}

export function addMonths(value: string, months: number) {
  date(value); integer(months, "month offset", -1200, 1200);
  const original = new Date(`${value}T00:00:00Z`);
  const target = new Date(original);
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const last = new Date(target);
  last.setUTCMonth(last.getUTCMonth() + 1);
  last.setUTCDate(0);
  target.setUTCDate(Math.min(original.getUTCDate(), last.getUTCDate()));
  return date(target.toISOString().slice(0, 10));
}

export function daysBetween(start: string, end: string) {
  return (Date.parse(`${date(end)}T00:00:00Z`) - Date.parse(`${date(start)}T00:00:00Z`)) / 86_400_000;
}

export interface MonthlyWindow { startDate: string; months: number }
export function periods(window: MonthlyWindow) {
  date(window.startDate); integer(window.months, "forecast months", 1, 120);
  if (!window.startDate.endsWith("-01")) throw new Error("Monthly operating plans must start on the first of a month");
  return Array.from({ length: window.months }, (_, index) => ({
    index, start: addMonths(window.startDate, index), endExclusive: addMonths(window.startDate, index + 1),
  }));
}

export function uniqueIds(items: { id: string }[]) {
  if (items.some(item => !item.id.trim()) || new Set(items.map(item => item.id)).size !== items.length)
    throw new Error("Planning ids must be non-empty and unique");
}
