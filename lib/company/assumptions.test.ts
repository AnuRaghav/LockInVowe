import { describe, expect, it } from "vitest";

import {
  ASSUMPTION_KEYS,
  ASSUMPTION_SCHEMAS,
  InvalidAssumptionError,
  parseAssumptionValue,
} from "@/lib/company/assumptions";

describe("assumption schemas", () => {
  it("has a schema for every key", () => {
    expect(Object.keys(ASSUMPTION_SCHEMAS).sort()).toEqual(Object.values(ASSUMPTION_KEYS).sort());
  });

  it("still accepts values the existing onboarding flow writes", () => {
    // Gusto employees can arrive without a start date.
    expect(
      parseAssumptionValue("current_team", [{ name: "Alex Kim", title: "", startDate: "", monthlyCostUsd: 12_000 }])
    ).toHaveLength(1);
    expect(parseAssumptionValue("minimum_runway_months", 0)).toBe(0);
    // Derived cash can be overdrawn.
    expect(parseAssumptionValue("cash_on_hand_usd", -1_250)).toBe(-1_250);
  });

  it("validates the keys the interview adds", () => {
    expect(parseAssumptionValue("gross_margin_pct", -40)).toBe(-40);
    expect(parseAssumptionValue("collection_lag_months", 1)).toBe(1);
    expect(parseAssumptionValue("revenue_proxy_accepted", true)).toBe(true);
    expect(
      parseAssumptionValue("planned_raises", [
        { label: "Series A", expectedCloseDate: "2027-06-30", amountUsd: 8_000_000, feesUsd: 40_000 },
      ])
    ).toHaveLength(1);
  });

  it("rejects malformed values with the key named", () => {
    const attempts: Array<[Parameters<typeof parseAssumptionValue>[0], unknown]> = [
      ["mrr_usd", -1],
      ["monthly_revenue_churn_pct", 140],
      ["collection_lag_months", 1.5],
      ["one_time_costs", [{ label: "Lease deposit", date: "2026-02-30", amountUsd: 20_000, kind: "operating" }]],
      ["planned_raises", [{ label: "Seed extension", expectedCloseDate: "2027-01-01", amountUsd: 1, feesUsd: 0, lead: "x" }]],
      ["revenue_proxy_accepted", "yes"],
    ];

    for (const [key, value] of attempts) {
      expect(() => parseAssumptionValue(key, value), key).toThrow(InvalidAssumptionError);
      expect(() => parseAssumptionValue(key, value), key).toThrow(key);
    }
  });
});
