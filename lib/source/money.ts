/**
 * Money in the Source Layer.
 *
 * One rule: money is an integer count of minor units plus an ISO 4217 code.
 * Never a float, never a bare number, never a column named `*_usd` that a
 * sibling `currency` column is free to contradict.
 *
 * The rule exists because the Numerical Model on top of this layer has to be
 * deterministic. Cents are exact in IEEE 754 up to 2^53, so summing millions of
 * them is exact; summing `12.34` twice already is not.
 *
 * Providers arrive on both sides of this line - Rho reports minor units
 * natively, Plaid reports decimals - so {@link decimalToMinor} is the single
 * place that conversion is allowed to happen.
 */

/** Fallback when a provider omits a currency. */
export const DEFAULT_CURRENCY = "USD";

/**
 * Minor units per major unit, as a power of ten.
 *
 * Only the exceptions are listed; everything unknown is assumed to be 2, which
 * is right for the overwhelming majority of ISO 4217 and, importantly, wrong
 * loudly rather than quietly for the rest.
 */
const MINOR_UNIT_EXPONENTS: Record<string, number> = {
  BHD: 3,
  CLP: 0,
  ISK: 0,
  IQD: 3,
  JOD: 3,
  JPY: 0,
  KRW: 0,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  PYG: 0,
  TND: 3,
  UGX: 0,
  VND: 0,
};

const DEFAULT_MINOR_UNIT_EXPONENT = 2;

/** How many decimal places this currency's minor unit occupies. */
export const minorUnitExponent = (currency: string): number =>
  MINOR_UNIT_EXPONENTS[currency.toUpperCase()] ?? DEFAULT_MINOR_UNIT_EXPONENT;

/**
 * Coerces a provider's currency field into a three-letter ISO 4217 code.
 *
 * Providers send `null`, lowercase, or nothing at all. A currency this layer
 * cannot recognise falls back rather than throwing, because a transaction with
 * an odd currency code is still a real thing that happened and dropping it
 * would be the worse failure.
 */
export const normalizeCurrency = (
  code: string | null | undefined,
  fallback: string = DEFAULT_CURRENCY
): string => {
  const trimmed = code?.trim().toUpperCase();
  return trimmed && /^[A-Z]{3}$/.test(trimmed) ? trimmed : fallback;
};

/**
 * Converts a provider's decimal amount to minor units.
 *
 * `Math.round` after scaling is what makes this exact for the values providers
 * actually send: `12.34 * 100` is `1233.9999999999998`, and rounding recovers
 * the 1234 that was meant.
 *
 * @throws when the value is not finite - a non-numeric amount is a mapping bug,
 * not a business condition, and should stop the sync rather than persist a 0.
 */
export const decimalToMinor = (value: number, currency: string): number => {
  if (!Number.isFinite(value)) {
    throw new Error(`Cannot convert non-finite amount "${value}" to minor units.`);
  }

  const scaled = Math.round(value * 10 ** minorUnitExponent(currency));

  if (!Number.isSafeInteger(scaled)) {
    throw new Error(`Amount "${value}" ${currency} overflows safe integer minor units.`);
  }

  return scaled;
};

/** Renders minor units back to a decimal string. For display and logs only. */
export const minorToDecimalString = (minor: number, currency: string): string => {
  const exponent = minorUnitExponent(currency);
  if (exponent === 0) return String(minor);

  const sign = minor < 0 ? "-" : "";
  const digits = String(Math.abs(minor)).padStart(exponent + 1, "0");

  return `${sign}${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
};
