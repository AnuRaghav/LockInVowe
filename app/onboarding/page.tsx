"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { PlaidLinkButton } from "@/components/PlaidLinkButton";
import { calculateRunway } from "@/lib/finance/runway";

interface PlannedHireDraft {
  title: string;
  startDate: string;
  monthlyCostUsd: string;
}

const STEPS = ["connect", "questions", "review"] as const;
type Step = (typeof STEPS)[number];

const emptyHire = (): PlannedHireDraft => ({ title: "", startDate: "", monthlyCostUsd: "" });

/**
 * MVP onboarding wizard (see PROJECT_OVERVIEW.md "MVP Onboarding Flow"):
 * connect data sources, auto-construct what the data already answers,
 * then ask the founder only what's still missing.
 */
export default function OnboardingPage() {
  const [step, setStep] = useState<Step>("connect");
  const [cashOnHandUsd, setCashOnHandUsd] = useState<number | null>(null);
  const [loadingCash, setLoadingCash] = useState(false);

  const [mrrUsd, setMrrUsd] = useState("");
  const [monthlyExpensesUsd, setMonthlyExpensesUsd] = useState("");
  const [monthlyGrowthTargetPct, setMonthlyGrowthTargetPct] = useState("");
  const [minimumRunwayMonths, setMinimumRunwayMonths] = useState("12");
  const [plannedHires, setPlannedHires] = useState<PlannedHireDraft[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const refreshCash = useCallback(async () => {
    setLoadingCash(true);
    try {
      const res = await fetch("/api/onboarding");
      const data = await res.json();
      setCashOnHandUsd(typeof data.cashOnHandUsd === "number" ? data.cashOnHandUsd : null);
    } catch {
      // Bank isn't connected yet, or the fetch failed - the founder can still
      // continue and enter everything by hand.
    } finally {
      setLoadingCash(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount, not a derived-state sync
    void refreshCash();
  }, [refreshCash]);

  const updateHire = (index: number, patch: Partial<PlannedHireDraft>) => {
    setPlannedHires((hires) => hires.map((hire, i) => (i === index ? { ...hire, ...patch } : hire)));
  };

  const removeHire = (index: number) => {
    setPlannedHires((hires) => hires.filter((_, i) => i !== index));
  };

  const parsedMrr = Number(mrrUsd) || 0;
  const parsedExpenses = Number(monthlyExpensesUsd) || 0;
  const preview =
    cashOnHandUsd !== null && (mrrUsd || monthlyExpensesUsd)
      ? calculateRunway({
          cashOnHandUsd,
          monthlyRevenueUsd: parsedMrr,
          monthlyExpensesUsd: parsedExpenses,
        })
      : null;

  const canSubmitQuestions =
    mrrUsd.trim() !== "" &&
    monthlyExpensesUsd.trim() !== "" &&
    monthlyGrowthTargetPct.trim() !== "" &&
    minimumRunwayMonths.trim() !== "" &&
    plannedHires.every((hire) => hire.title.trim() && hire.startDate.trim() && hire.monthlyCostUsd.trim());

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mrrUsd: parsedMrr,
          monthlyExpensesUsd: parsedExpenses,
          monthlyGrowthTargetPct: Number(monthlyGrowthTargetPct) || 0,
          minimumRunwayMonths: Number(minimumRunwayMonths) || 0,
          plannedHires: plannedHires.map((hire) => ({
            title: hire.title,
            startDate: hire.startDate,
            monthlyCostUsd: Number(hire.monthlyCostUsd) || 0,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save.");
      setSaved(true);
      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-16">
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        {STEPS.map((s, i) => (
          <span key={s} className={s === step ? "font-semibold text-black dark:text-white" : ""}>
            {i + 1}. {s}
            {i < STEPS.length - 1 && <span className="mx-2">→</span>}
          </span>
        ))}
      </div>

      {step === "connect" && (
        <section className="flex flex-col gap-6">
          <div>
            <h1 className="text-2xl font-semibold">Connect your bank</h1>
            <p className="mt-1 text-zinc-600 dark:text-zinc-400">
              We use this to read your current cash balance automatically, so you don&apos;t
              have to type it in.
            </p>
          </div>
          <PlaidLinkButton />
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={refreshCash}
              className="text-sm underline underline-offset-4"
            >
              {loadingCash ? "Checking…" : "Refresh balance"}
            </button>
            {cashOnHandUsd !== null && (
              <span className="text-sm text-zinc-600 dark:text-zinc-400">
                Detected cash on hand: <strong>${cashOnHandUsd.toLocaleString()}</strong>
              </span>
            )}
          </div>
          <div>
            <button
              type="button"
              onClick={() => setStep("questions")}
              className="rounded-full bg-foreground px-5 py-3 text-background"
            >
              {cashOnHandUsd !== null ? "Continue" : "Skip for now"}
            </button>
          </div>
        </section>
      )}

      {step === "questions" && (
        <section className="flex flex-col gap-6">
          <div>
            <h1 className="text-2xl font-semibold">A few things we can&apos;t read from your bank</h1>
            <p className="mt-1 text-zinc-600 dark:text-zinc-400">
              This becomes your company&apos;s persistent financial model - Sam updates it over
              time, but it starts here.
            </p>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            Monthly recurring revenue (USD)
            <input
              type="number"
              min={0}
              value={mrrUsd}
              onChange={(e) => setMrrUsd(e.target.value)}
              className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Average monthly operating expenses (USD)
            <input
              type="number"
              min={0}
              value={monthlyExpensesUsd}
              onChange={(e) => setMonthlyExpensesUsd(e.target.value)}
              className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Target monthly growth rate (%)
            <input
              type="number"
              min={0}
              value={monthlyGrowthTargetPct}
              onChange={(e) => setMonthlyGrowthTargetPct(e.target.value)}
              className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Minimum runway you want to maintain (months)
            <input
              type="number"
              min={0}
              value={minimumRunwayMonths}
              onChange={(e) => setMinimumRunwayMonths(e.target.value)}
              className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Planned hires</span>
              <button
                type="button"
                onClick={() => setPlannedHires((hires) => [...hires, emptyHire()])}
                className="text-sm underline underline-offset-4"
              >
                + Add hire
              </button>
            </div>
            {plannedHires.map((hire, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2 rounded border border-zinc-200 p-3 dark:border-zinc-800">
                <label className="flex flex-1 min-w-[140px] flex-col gap-1 text-xs">
                  Title
                  <input
                    value={hire.title}
                    onChange={(e) => updateHire(i, { title: e.target.value })}
                    className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  Start date
                  <input
                    type="date"
                    value={hire.startDate}
                    onChange={(e) => updateHire(i, { startDate: e.target.value })}
                    className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  Monthly cost (USD)
                  <input
                    type="number"
                    min={0}
                    value={hire.monthlyCostUsd}
                    onChange={(e) => updateHire(i, { monthlyCostUsd: e.target.value })}
                    className="w-32 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </label>
                <button type="button" onClick={() => removeHire(i)} className="text-xs text-red-600 underline">
                  Remove
                </button>
              </div>
            ))}
          </div>

          {preview && (
            <div className="rounded border border-zinc-200 p-4 text-sm dark:border-zinc-800">
              <p>
                With ${cashOnHandUsd?.toLocaleString()} on hand, ${parsedMrr.toLocaleString()}/mo
                revenue, and ${parsedExpenses.toLocaleString()}/mo expenses:
              </p>
              <p className="mt-1 font-semibold">
                {preview.runwayMonths !== null
                  ? `${preview.runwayMonths} months of runway (${preview.status})`
                  : "Cash flow positive - no runway limit"}
              </p>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep("connect")}
              className="rounded-full border border-zinc-300 px-5 py-3 dark:border-zinc-700"
            >
              Back
            </button>
            <button
              type="button"
              disabled={!canSubmitQuestions || saving}
              onClick={submit}
              className="rounded-full bg-foreground px-5 py-3 text-background disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save and finish"}
            </button>
          </div>
        </section>
      )}

      {step === "review" && saved && (
        <section className="flex flex-col gap-4">
          <h1 className="text-2xl font-semibold">You&apos;re set up</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Your financial model is saved. Sam will use it to answer questions like &quot;What&apos;s
            my runway?&quot; and keep it up to date as things change.
          </p>
          <Link href="/" className="w-fit rounded-full bg-foreground px-5 py-3 text-background">
            Go to Sam
          </Link>
        </section>
      )}
    </div>
  );
}
