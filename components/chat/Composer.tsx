"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";

const MAX_HEIGHT_PX = 220;

/**
 * The single input for a thread. Enter sends, Shift+Enter adds a line - the
 * convention founders already expect - and the textarea grows with the draft
 * up to a cap so a long question never pushes the conversation off screen.
 */
export function Composer({
  onSend,
  disabled = false,
  running = false,
  placeholder = "Ask Sam about runway, hiring, or spend…",
}: {
  onSend: (content: string) => void;
  disabled?: boolean;
  running?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value]);

  const canSend = value.trim().length > 0 && !disabled && !running;

  const send = () => {
    if (!canSend) return;
    onSend(value.trim());
    setValue("");
  };

  return (
    <div className="mx-auto w-full max-w-[46rem] px-6 pb-6">
      <div
        className={cn(
          "flex items-end gap-2 rounded-2xl border border-border bg-black/25 p-2.5 transition-colors",
          "focus-within:border-accent/60",
          disabled && "opacity-60",
        )}
      >
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          disabled={disabled}
          placeholder={running ? "Sam is working…" : placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          className="max-h-[220px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] leading-relaxed text-foreground outline-none placeholder:text-muted-2 disabled:cursor-not-allowed"
        />
        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          aria-label="Send message"
          className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-accent text-accent-ink transition-[background-color,opacity,transform] duration-200 hover:bg-accent-strong active:scale-95 disabled:cursor-not-allowed disabled:bg-surface-strong disabled:text-muted-2 disabled:active:scale-100"
        >
          <ArrowUp weight="bold" className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-2 px-1 text-[12px] text-muted-2">
        {running ? "Sam is working through your numbers…" : "Enter to send · Shift + Enter for a new line"}
      </p>
    </div>
  );
}
