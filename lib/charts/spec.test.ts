import { describe, expect, it } from "vitest";

import { chartSpecSchema, toChartRows, type ChartSpec } from "@/lib/charts/spec";

const spec: ChartSpec = {
  title: "Cash, base vs hiring",
  type: "line",
  series: [
    { name: "Base", points: [{ x: "2026-10", y: 900000 }, { x: "2026-11", y: 850000 }] },
    { name: "x", points: [{ x: "2026-11", y: 810000 }, { x: "2026-12", y: 760000 }] },
  ],
};

describe("toChartRows", () => {
  it("merges series by x in first-appearance order, leaving gaps where a series has no point", () => {
    expect(toChartRows(spec)).toEqual([
      { x: "2026-10", s0: 900000 },
      { x: "2026-11", s0: 850000, s1: 810000 },
      { x: "2026-12", s1: 760000 },
    ]);
  });
});

describe("chartSpecSchema", () => {
  it("rejects duplicate series names, which would make the legend ambiguous", () => {
    const duplicate = { ...spec, series: [spec.series[0], spec.series[0]] };
    expect(chartSpecSchema.safeParse(duplicate).success).toBe(false);
  });

  it("rejects non-finite values", () => {
    const bad = { ...spec, series: [{ name: "Base", points: [{ x: "a", y: Number.POSITIVE_INFINITY }] }] };
    expect(chartSpecSchema.safeParse(bad).success).toBe(false);
  });
});
