"use client";

import { useState } from "react";

import { pillPrimary, pillSecondary } from "@/components/onboarding/styles";

/**
 * Skips the interview questions, with one confirmation. Sam starts from the
 * connected accounts and anything already said, and asks the rest over time.
 */
export function SkipInterview({
  label,
  onSkipped,
  disabled,
}: {
  label: string;
  onSkipped: () => void;
  disabled?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={disabled}
        className="self-start text-[13px] text-muted underline underline-offset-4 transition-colors hover:text-foreground disabled:opacity-40"
      >
        {label}
      </button>
    );
  }

  const skip = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/skip", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't skip onboarding.");
      onSkipped();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't skip onboarding.");
      setBusy(false);
    }
  };

  return (
    <div role="dialog" aria-label="Skip the questions" className="flex w-full basis-full flex-col gap-3 rounded-2xl border border-border bg-black/20 p-4">
      <p className="text-[15px] text-foreground">Skip the questions?</p>
      <p className="text-sm leading-relaxed text-muted">
        Sam will start from your connected accounts and anything you&apos;ve already said, then ask about the rest in
        conversation when it matters. You won&apos;t be able to come back to this interview.
      </p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={() => setConfirming(false)} disabled={busy} className={pillSecondary}>
          Keep going
        </button>
        <button type="button" onClick={skip} disabled={busy} className={pillPrimary}>
          {busy ? "Skipping…" : "Skip questions"}
        </button>
      </div>
    </div>
  );
}
