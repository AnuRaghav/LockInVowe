"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Microphone, Stop } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";

const MAX_HEIGHT_PX = 220;

/**
 * The one way a founder says anything to Sam.
 *
 * Voice will arrive as speech-to-text feeding this same submit path - never a
 * second conversation system - so the microphone has a seat here already and
 * the send affordance stays the single place a turn begins.
 */
export function Composer({
  onSend,
  onStop,
  running = false,
  disabled = false,
  /** A send that never became a run, handed back verbatim. */
  draft,
  /** Changing this refocuses the input - after a thread switch or a finished run. */
  focusKey,
}: {
  onSend: (content: string) => void;
  onStop: () => void;
  running?: boolean;
  disabled?: boolean;
  draft?: { text: string; key: number } | null;
  focusKey?: string | number;
}) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value]);

  useEffect(() => {
    if (!disabled && !running) textareaRef.current?.focus();
  }, [focusKey, disabled, running]);



  // Adjusting state during render (rather than in an effect) is React's own
  // pattern for reacting to a changed prop: a handed-back draft refills an
  // empty composer without clobbering something newly typed.
  const [restoredKey, setRestoredKey] = useState<number | null>(null);
  if (draft && draft.key !== restoredKey) {
    setRestoredKey(draft.key);
    if (!value) setValue(draft.text);
  }

  const canSend = value.trim().length > 0 && !disabled && !running;

  const send = () => {
    // Guards the double-Enter and the empty submit in one place.
    if (!canSend) return;
    onSend(value.trim());
    setValue("");
  };

  return (
    <div className="mx-auto w-full max-w-[46rem] px-5 pb-5 sm:px-6 sm:pb-6">
      <div
        className={cn(
          "flex items-end gap-1.5 rounded-2xl border border-border bg-black/25 p-2 transition-colors",
          "focus-within:border-accent/60",
          disabled && "opacity-60",
        )}
      >
        <button
          type="button"
          disabled
          aria-label="Voice input (coming soon)"
          title="Voice input is coming soon"
          className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-xl text-muted-2 transition-colors disabled:cursor-not-allowed"
        >
          <Microphone className="h-[18px] w-[18px]" />
        </button>
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          disabled={disabled}
          placeholder={running ? "Sam is working…" : "Ask Sam about runway, hiring, or spend…"}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          className="max-h-[220px] flex-1 resize-none self-center bg-transparent px-1 py-1.5 text-[15px] leading-relaxed text-foreground outline-none placeholder:text-muted-2 disabled:cursor-not-allowed"
        />
        {running ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop Sam"
            className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-border-strong text-foreground transition-colors hover:border-accent hover:text-accent"
          >
            <Stop weight="fill" className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={send}
            disabled={!canSend}
            aria-label="Send message"
            className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-accent text-accent-ink transition-[background-color,opacity,transform] duration-200 hover:bg-accent-strong active:scale-95 disabled:cursor-not-allowed disabled:bg-surface-strong disabled:text-muted-2 disabled:active:scale-100"
          >
            <ArrowUp weight="bold" className="h-4 w-4" />
          </button>
        )}
      </div>
      <p className="mt-2 px-1 text-[12px] text-muted-2">
        {running ? "Sam is working — you can stop any time." : "Enter to send · Shift + Enter for a new line"}
      </p>
    </div>
  );
}
