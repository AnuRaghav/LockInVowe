"use client";

import Link from "next/link";
import { ChatCircleText, TrendDown, TrendUp, WarningCircle } from "@phosphor-icons/react";
import { motion } from "motion/react";

import { ChartFigure } from "@/components/chat/ChartFigure";
import { NumberTicker } from "@/components/ui/number-ticker";
import type { DigestInsight, InsightTone } from "@/lib/insights/types";
import { cn } from "@/lib/utils";

const toneStyles: Record<InsightTone, string> = {
  positive: "border-accent/30 bg-accent-soft",
  warning: "border-danger/25 bg-danger-soft",
  critical: "border-danger/40 bg-danger-soft",
  neutral: "border-border bg-surface",
};

const toneIcon: Record<InsightTone, typeof TrendUp | null> = {
  positive: TrendUp,
  warning: TrendDown,
  critical: WarningCircle,
  neutral: null,
};

interface InsightCardProps {
  insight: DigestInsight;
  /** Entrance stagger, in seconds. */
  delay?: number;
  className?: string;
}

/** One card in the daily digest: the CFO's note, the number that backs it, and the chart. */
export function InsightCard({ insight, delay = 0, className }: InsightCardProps) {
  const Icon = toneIcon[insight.tone];

  return (
    <motion.div
      initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ delay: 0.15 + delay, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "flex flex-col gap-4 rounded-2xl border p-5 transition-transform duration-200 hover:-translate-y-0.5",
        toneStyles[insight.tone],
        className,
      )}
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-widest text-muted-2">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
          </span>
          {insight.category}
        </div>
        <div className="flex items-start gap-2">
          {Icon && (
            <Icon
              weight="fill"
              className={cn("mt-0.5 h-4.5 w-4.5 shrink-0", insight.tone === "positive" ? "text-accent" : "text-danger")}
            />
          )}
          <h2 className="text-[15px] font-semibold leading-snug text-foreground">{insight.title}</h2>
        </div>

        <div className="flex items-baseline gap-1.5">
          <span className="text-3xl font-semibold tabular-nums tracking-tight text-foreground">
            {insight.stat.prefix}
            <NumberTicker value={insight.stat.value} decimalPlaces={insight.stat.decimalPlaces} />
            {insight.stat.suffix}
          </span>
        </div>
        <p className="text-[12.5px] text-muted-2">{insight.stat.label}</p>

        <p className="text-[13px] leading-relaxed text-muted">{insight.note}</p>
      </div>

      <ChartFigure spec={insight.chart} />

      <Link
        href="/chat"
        className="group mt-auto inline-flex items-center gap-1.5 self-start text-[13px] font-medium text-accent"
      >
        Ask Sam about this
        <ChatCircleText
          weight="bold"
          className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
        />
      </Link>
    </motion.div>
  );
}
