import { z } from "zod";

/**
 * What Sam draws: finished series, never a query or a formula.
 *
 * Shared by the `create_chart` tool (validation), the conversation store
 * (persistence), and the chat (rendering), so all three agree on one shape.
 * Values are copied from finance tool results; nothing here computes.
 */

export const CHART_TYPES = ["line", "bar"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

/**
 * Five, not more: the chart palette's sixth slot is too low-contrast on the
 * chat surface, and past five series a chart stops being readable anyway.
 */
export const MAX_CHART_SERIES = 5;
export const MAX_CHART_POINTS = 120;

export const chartSpecSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    type: z.enum(CHART_TYPES),
    xLabel: z.string().trim().min(1).max(60).optional(),
    yLabel: z.string().trim().min(1).max(60).optional(),
    series: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(60),
            points: z
              .array(z.object({ x: z.string().trim().min(1).max(40), y: z.number().finite() }).strict())
              .min(1)
              .max(MAX_CHART_POINTS),
          })
          .strict()
      )
      .min(1)
      .max(MAX_CHART_SERIES)
      .refine((series) => new Set(series.map((s) => s.name)).size === series.length, "Series names must be unique."),
  })
  .strict();

export type ChartSpec = z.infer<typeof chartSpecSchema>;

/**
 * One row per x value with a column per series - the shape Recharts plots.
 * Series columns are keyed by position (`s0`, `s1`, ...) so no series name can
 * collide with `x`. x order is first appearance across series, so periods stay
 * in the order Sam gave them rather than being re-sorted as strings.
 */
export const chartSeriesKey = (index: number) => `s${index}`;

export const toChartRows = (spec: ChartSpec): Array<Record<string, string | number>> => {
  const rows = new Map<string, Record<string, string | number>>();
  spec.series.forEach((series, index) => {
    for (const point of series.points) {
      const row = rows.get(point.x) ?? { x: point.x };
      row[chartSeriesKey(index)] = point.y;
      rows.set(point.x, row);
    }
  });
  return [...rows.values()];
};
