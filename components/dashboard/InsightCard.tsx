"use client";

import Link from "next/link";
import { ChatCircleText, TrendDown, TrendUp, WarningCircle } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";

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

const toneLabel: Record<InsightTone, string | undefined> = {
  positive: "Good news",
  warning: "Needs attention",
  critical: "Urgent",
  neutral: undefined,
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
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 14, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ delay: 0.15 + delay, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "flex flex-col gap-4 rounded-2xl border p-5",
        toneStyles[insight.tone],
        className,
      )}
    >
      <div className="flex flex-col gap-2">
        <p className="text-[13px] font-medium text-muted">{insight.category}</p>
        <div className="flex items-start gap-2">
          {Icon && (
            <Icon
              weight="fill"
              role="img"
              aria-label={toneLabel[insight.tone]}
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
        <p className="text-[12.5px] text-muted">{insight.stat.label}</p>

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
