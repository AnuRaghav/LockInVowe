"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { chartSeriesKey, toChartRows, type ChartSpec } from "@/lib/charts/spec";

/**
 * A chart Sam drew, rendered from the stored series.
 *
 * Colours are the reference data-viz palette's dark steps, validated against
 * the chat surface (slots 1-5; the sixth is under 3:1 there, which is why
 * specs cap at five series). Literal values rather than CSS variables because
 * SVG presentation attributes don't resolve `var()`.
 */
const SERIES_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"];
const INK = { muted: "rgba(244, 245, 242, 0.68)", faint: "rgba(244, 245, 242, 0.5)", grid: "rgba(255, 255, 255, 0.08)" };

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const exact = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function ChartFigure({ spec, heightClassName = "h-64" }: { spec: ChartSpec; heightClassName?: string }) {
  const rows = toChartRows(spec);
  const multiSeries = spec.series.length > 1;
  const withUnit = (value: number) => (spec.yLabel ? `${exact.format(value)} ${spec.yLabel}` : exact.format(value));

  const axes = (
    <>
      <CartesianGrid vertical={false} stroke={INK.grid} />
      <XAxis
        dataKey="x"
        tick={{ fill: INK.muted, fontSize: 12 }}
        tickLine={false}
        axisLine={{ stroke: INK.grid }}
        minTickGap={16}
        label={spec.xLabel ? { value: spec.xLabel, position: "insideBottom", offset: -4, fill: INK.faint, fontSize: 12 } : undefined}
      />
      <YAxis
        tick={{ fill: INK.muted, fontSize: 12 }}
        tickLine={false}
        axisLine={false}
        width={56}
        tickFormatter={(value: number) => compact.format(value)}
      />
      <Tooltip
        cursor={spec.type === "bar" ? { fill: "rgba(255, 255, 255, 0.04)" } : { stroke: INK.faint, strokeWidth: 1 }}
        contentStyle={{ background: "#262927", border: "1px solid rgba(255, 255, 255, 0.11)", borderRadius: 8, fontSize: 13 }}
        labelStyle={{ color: "#f4f5f2", marginBottom: 4 }}
        itemStyle={{ color: "#f4f5f2", padding: 0 }}
        formatter={(value) => (typeof value === "number" ? withUnit(value) : value)}
      />
      {multiSeries && (
        <Legend
          verticalAlign="top"
          align="left"
          height={32}
          iconType="circle"
          iconSize={8}
          formatter={(name) => <span style={{ color: INK.muted, fontSize: 12.5 }}>{name}</span>}
        />
      )}
    </>
  );

  const margin = { top: 4, right: 8, bottom: spec.xLabel ? 16 : 0, left: 0 };

  return (
    <figure className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <figcaption className="flex flex-col gap-0.5">
        <span className="text-[14px] font-medium text-foreground">{spec.title}</span>
        {spec.yLabel && <span className="text-[12.5px] text-muted-2">{spec.yLabel}</span>}
      </figcaption>
      <div className={heightClassName + " w-full"}>
        <ResponsiveContainer width="100%" height="100%">
          {spec.type === "bar" ? (
            <BarChart data={rows} margin={margin} barGap={2}>
              {axes}
              {spec.series.map((series, index) => (
                <Bar
                  key={series.name}
                  dataKey={chartSeriesKey(index)}
                  name={series.name}
                  fill={SERIES_COLORS[index]}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={36}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          ) : (
            <LineChart data={rows} margin={margin}>
              {axes}
              {spec.series.map((series, index) => (
                <Line
                  key={series.name}
                  dataKey={chartSeriesKey(index)}
                  name={series.name}
                  type="monotone"
                  stroke={SERIES_COLORS[index]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "#1f2220" }}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
      <details className="text-[13px] text-muted">
        <summary className="cursor-pointer select-none text-muted-2 hover:text-muted">View data</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-left tabular-nums">
            <thead>
              <tr className="border-b border-border text-muted-2">
                <th className="py-1.5 pr-4 font-medium">{spec.xLabel ?? ""}</th>
                {spec.series.map((series) => (
                  <th key={series.name} className="py-1.5 pr-4 font-medium">{series.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={String(row.x)} className="border-b border-border/60">
                  <td className="py-1.5 pr-4 text-muted">{row.x}</td>
                  {spec.series.map((series, index) => {
                    const value = row[chartSeriesKey(index)];
                    return (
                      <td key={series.name} className="py-1.5 pr-4 text-foreground">
                        {typeof value === "number" ? exact.format(value) : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
