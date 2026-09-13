"use client";

import { VoiceInput } from "@/components/chat/VoiceInput";
import { cn } from "@/lib/utils";

/**
 * Voice-first input for Sam.
 *
 * Speaking is the only primary action here: a recording is transcribed and sent
 * immediately, then Sam answers back with generated speech once the run settles.
 */
export function Composer({
  onSend,
  onStop,
  running = false,
  disabled = false,
  focusKey,
  variant = "dock",
}: {
  onSend: (content: string) => void;
  onStop: () => void;
  running?: boolean;
  disabled?: boolean;
  /** Remounts the recorder after a thread switch or completed run. */
  focusKey?: string | number;
  variant?: "dock" | "hero";
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-5 sm:px-6",
        variant === "hero"
          ? "flex max-w-[46rem] flex-col items-center justify-center pb-0"
          : "max-w-[46rem] pb-5 sm:pb-6",
      )}
    >
      <VoiceInput
        key={focusKey}
        disabled={disabled}
        running={running}
        onStop={onStop}
        onTranscript={(text) => onSend(text)}
        variant={variant}
      />
    </div>
  );
}
