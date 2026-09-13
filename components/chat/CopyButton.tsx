"use client";

import { useEffect, useState } from "react";
import { Check, ClipboardText } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";

export function CopyButton({
  text,
  label = "Copy",
  copiedLabel = "Copied",
  className,
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!copied && !failed) return;
    const timer = setTimeout(() => {
      setCopied(false);
      setFailed(false);
    }, 1800);
    return () => clearTimeout(timer);
  }, [copied, failed]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setFailed(false);
    } catch {
      setCopied(false);
      setFailed(true);
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? copiedLabel : label}
      title={failed ? "Copy failed" : copied ? copiedLabel : label}
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded px-1 py-1 text-xs text-muted-2 transition-colors hover:text-accent",
        copied && "text-accent",
        failed && "text-danger",
        className,
      )}
    >
      {copied ? <Check size={16} weight="bold" /> : <ClipboardText size={16} />}
      {failed ? "Copy failed" : copied ? copiedLabel : label}
    </button>
  );
}
