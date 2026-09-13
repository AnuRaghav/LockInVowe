"use client";

// Adapted from Magic UI (magicui.design/r/number-ticker): re-animates on value change and honors reduced motion.
import { useEffect, useRef, type ComponentPropsWithoutRef } from "react";
import { useInView, useMotionValue, useReducedMotion, useSpring } from "motion/react";

import { cn } from "@/lib/utils";

interface NumberTickerProps extends ComponentPropsWithoutRef<"span"> {
  value: number;
  startValue?: number;
  decimalPlaces?: number;
}

export function NumberTicker({
  value,
  startValue = 0,
  className,
  decimalPlaces = 0,
  ...props
}: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  const motionValue = useMotionValue(startValue);
  const springValue = useSpring(motionValue, { damping: 60, stiffness: 180 });
  const isInView = useInView(ref, { once: true, margin: "0px" });

  const format = (n: number) =>
    Intl.NumberFormat("en-US", {
      minimumFractionDigits: decimalPlaces,
      maximumFractionDigits: decimalPlaces,
    }).format(Number(n.toFixed(decimalPlaces)));

  useEffect(() => {
    if (!isInView) return;
    if (reduce) {
      motionValue.jump(value);
      springValue.jump(value);
      if (ref.current) ref.current.textContent = format(value);
      return;
    }
    motionValue.set(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motionValue, springValue, isInView, value, reduce]);

  useEffect(
    () =>
      springValue.on("change", (latest) => {
        if (ref.current) ref.current.textContent = format(latest);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [springValue, decimalPlaces],
  );

  return (
    <span ref={ref} className={cn("inline-block tabular-nums", className)} {...props}>
      {format(startValue)}
    </span>
  );
}
