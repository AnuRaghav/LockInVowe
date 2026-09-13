import { describe, expect, it } from "vitest";

import {
  decimalToMinor,
  minorToDecimalString,
  minorUnitExponent,
  normalizeCurrency,
} from "@/lib/source/money";

describe("decimalToMinor", () => {
  it("converts the decimals providers actually send without float drift", () => {
    // 12.34 * 100 is 1233.9999999999998 in IEEE 754.
    expect(decimalToMinor(12.34, "USD")).toBe(1234);
    expect(decimalToMinor(0.1 + 0.2, "USD")).toBe(30);
    expect(decimalToMinor(1234567.89, "USD")).toBe(123456789);
  });

  it("keeps the sign", () => {
    expect(decimalToMinor(-42.5, "USD")).toBe(-4250);
  });

  it("respects currencies whose minor unit is not two decimals", () => {
    expect(minorUnitExponent("JPY")).toBe(0);
    expect(decimalToMinor(1500, "JPY")).toBe(1500);
    expect(decimalToMinor(1.5, "BHD")).toBe(1500);
  });

  it("refuses a non-finite amount rather than persisting a zero", () => {
    expect(() => decimalToMinor(Number.NaN, "USD")).toThrow(/non-finite/);
  });
});

describe("normalizeCurrency", () => {
  it("upcases and trims what providers send", () => {
    expect(normalizeCurrency(" usd ")).toBe("USD");
  });

  it("falls back rather than dropping a real transaction", () => {
    expect(normalizeCurrency(null)).toBe("USD");
    expect(normalizeCurrency("BITCOIN")).toBe("USD");
    expect(normalizeCurrency(undefined, "EUR")).toBe("EUR");
  });
});

describe("minorToDecimalString", () => {
  it("renders minor units back for display", () => {
    expect(minorToDecimalString(1234, "USD")).toBe("12.34");
    expect(minorToDecimalString(-5, "USD")).toBe("-0.05");
    expect(minorToDecimalString(1500, "JPY")).toBe("1500");
  });
});
