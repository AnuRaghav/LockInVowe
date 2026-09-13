// Adapted from Magic UI (magicui.design/r/animated-shiny-text): tuned to the dark palette, static under reduced motion.
import type { ComponentPropsWithoutRef, CSSProperties } from "react";

import { cn } from "@/lib/utils";

export function AnimatedShinyText({
  children,
  className,
  shimmerWidth = 80,
  ...props
}: ComponentPropsWithoutRef<"span"> & { shimmerWidth?: number }) {
  return (
    <span
      style={{ "--shiny-width": `${shimmerWidth}px` } as CSSProperties}
      className={cn(
        "text-muted motion-safe:animate-shiny-text motion-safe:bg-clip-text motion-safe:bg-no-repeat",
        "motion-safe:bg-size-[var(--shiny-width)_100%] motion-safe:bg-position-[0_0]",
        "motion-safe:bg-linear-to-r motion-safe:from-transparent motion-safe:via-white/90 motion-safe:via-50% motion-safe:to-transparent",
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
