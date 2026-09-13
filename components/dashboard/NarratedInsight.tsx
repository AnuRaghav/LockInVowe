"use client";

import { motion, useReducedMotion } from "motion/react";
import { useMemo } from "react";

import { SamOrb } from "@/components/SamOrb";
import { cn } from "@/lib/utils";

const WORD_STAGGER_S = 0.09;

/** Numbers, money, and percentages read as the emphasized part of a spoken line. */
const HIGHLIGHT_PATTERN = /^[$]?-?[\d][\d,.]*%?x?$|^\$[\d][\d,.]*[a-zA-Z]*$/;

const isHighlighted = (word: string) => HIGHLIGHT_PATTERN.test(word.replace(/[.,;:]+$/, ""));

/**
 * The orb narrating one line, word by word - the "an agent is actually
 * telling you this" moment. Purely presentational: `text` is a plain string
 * someone already decided to say (see lib/insights/digest.ts), not something
 * this component generates or fetches.
 */
export function NarratedInsight({ text, className }: { text: string; className?: string }) {
  const words = useMemo(() => text.split(" "), [text]);
  const reduceMotion = useReducedMotion();

  return (
    <div className={cn("flex flex-col items-center gap-6 py-4 text-center", className)}>
      <SamOrb energy={0.6} className="h-20 w-20 shrink-0" />
      <p className="max-w-2xl text-balance text-xl font-medium leading-snug tracking-tight text-foreground sm:text-2xl">
        {words.map((word, i) =>
          reduceMotion ? (
            <span key={i} className={cn(isHighlighted(word) && "text-accent")}>
              {word}{" "}
            </span>
          ) : (
            <motion.span
              key={i}
              initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ delay: i * WORD_STAGGER_S, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className={cn("inline-block", isHighlighted(word) && "text-accent")}
            >
              {word}&nbsp;
            </motion.span>
          ),
        )}
      </p>
    </div>
  );
}
