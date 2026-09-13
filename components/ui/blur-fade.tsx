"use client";

// Adapted from Magic UI (magicui.design/r/blur-fade): collapses to a static render under reduced motion.
import { motion, useReducedMotion, type MotionProps } from "motion/react";

interface BlurFadeProps extends MotionProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  duration?: number;
  offset?: number;
  blur?: string;
}

export function BlurFade({
  children,
  className,
  delay = 0,
  duration = 0.5,
  offset = 8,
  blur = "6px",
  ...props
}: BlurFadeProps) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;

  return (
    <motion.div
      initial={{ opacity: 0, y: offset, filter: `blur(${blur})` }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ delay: 0.04 + delay, duration, ease: [0.16, 1, 0.3, 1] }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}
