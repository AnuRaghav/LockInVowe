"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowClockwise, Bank, Check, CreditCard, Users } from "@phosphor-icons/react";

import { GustoLinkButton } from "@/components/GustoLinkButton";
import { InterviewStep } from "@/components/onboarding/InterviewStep";
import { PlaybackStep } from "@/components/onboarding/PlaybackStep";
import { pillPrimary, pillSecondary, usd } from "@/components/onboarding/styles";
import { PlaidLinkButton } from "@/components/PlaidLinkButton";
import { SamLogo } from "@/components/SamLogo";
import { SamOrb } from "@/components/SamOrb";
import { StripeLinkButton } from "@/components/StripeLinkButton";
import { BlurFade } from "@/components/ui/blur-fade";
import { NumberTicker } from "@/components/ui/number-ticker";
import { cn } from "@/lib/utils";

const STEPS = [
  { key: "connect", label: "Connect" },
  { key: "interview", label: "Interview" },
  { key: "review", label: "Review" },
  { key: "done", label: "Done" },
] as const;
type StepKey = (typeof STEPS)[number]["key"];

const connectedBadge = (
  <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-[13px] font-medium text-accent">
    <Check weight="bold" className="h-3.5 w-3.5" />
    Connected
  </span>
);

/**
 * Onboarding (see docs/ONBOARDING_OVERHAUL.md): connect data sources, a short
 * interview with Sam about the company and the founder, then a playback the
 * founder corrects before it becomes Sam's baseline.
 */
export default function OnboardingPage() {
  const [step, setStep] = useState<StepKey>("connect");
  const [cashOnHandUsd, setCashOnHandUsd] = useState<number | null>(null);
  const [loadingCash, setLoadingCash] = useState(false);
  const [stripeConnected, setStripeConnected] = useState(false);
  const [payrollConnected, setPayrollConnected] = useState(false);
  const [monthlyPayrollCostUsd, setMonthlyPayrollCostUsd] = useState<number | null>(null);
  const [gustoStatus, setGustoStatus] = useState<{ tone: "ok" | "error"; message: string } | null>(null);

  const refreshConnections = useCallback(async () => {
    setLoadingCash(true);
    try {
      const res = await fetch("/api/onboarding");
      const data = await res.json();
      setCashOnHandUsd(typeof data.cashOnHandUsd === "number" ? data.cashOnHandUsd : null);
      setStripeConnected(Boolean(data.stripeConnected));
      setPayrollConnected(Boolean(data.payrollConnected));
      setMonthlyPayrollCostUsd(typeof data.monthlyPayrollCostUsd === "number" ? data.monthlyPayrollCostUsd : null);
    } catch {
      // Nothing linked yet, or the fetch failed - the founder can still continue.
    } finally {
      setLoadingCash(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount, not a derived-state sync
    void refreshConnections();
  }, [refreshConnections]);

  // Gusto's OAuth leaves the page and comes back through app/api/gusto/callback,
  // which has already run the first sync. Read the outcome once, then clear it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("gustoError");
    const syncError = params.get("gustoSyncError");
    const linked = params.get("gustoLinked");
    if (!error && !linked) return;

    if (error) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the OAuth return params
      setGustoStatus({ tone: "error", message: `Couldn't connect Gusto: ${error}` });
    } else if (syncError) {
      setGustoStatus({ tone: "error", message: `Connected, but the first sync failed: ${syncError}` });
    } else {
      setGustoStatus({ tone: "ok", message: `Synced ${params.get("gustoEmployees") ?? "0"} employees from Gusto.` });
    }

    const url = new URL(window.location.href);
    ["gustoError", "gustoSyncError", "gustoLinked", "gustoEmployees", "gustoPayrolls"].forEach((key) =>
      url.searchParams.delete(key)
    );
    window.history.replaceState({}, "", url.toString());
  }, []);

  const stepIndex = STEPS.findIndex((s) => s.key === step);
  const orbEnergy = step === "done" ? 0.8 : step === "interview" ? 0.6 : cashOnHandUsd !== null ? 0.5 : 0.25;

  return (
    <div className="relative flex flex-1 flex-col">
      <header className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between gap-4 px-5">
        <Link href="/" aria-label="Sam home" className="inline-flex shrink-0 items-center">
          <SamLogo />
        </Link>
        <ol aria-label="Onboarding progress" className="glass-pill flex items-center gap-1 rounded-full p-1">
          {STEPS.map((s, i) => (
            <li
              key={s.key}
              aria-current={i === stepIndex ? "step" : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] transition-colors duration-300",
                i === stepIndex && "bg-white/12 text-foreground",
                i < stepIndex && "text-accent",
                i > stepIndex && "text-muted-2"
              )}
            >
              {i < stepIndex ? <Check weight="bold" className="h-3 w-3" /> : <span className="tabular-nums">{i + 1}</span>}
              <span className="hidden sm:inline">{s.label}</span>
            </li>
          ))}
        </ol>
      </header>

      <div aria-hidden className="pointer-events-none mx-auto -mb-16 h-44 w-44 sm:h-52 sm:w-52">
        <SamOrb energy={orbEnergy} points={420} className="h-full w-full" />
      </div>

      <main className="relative mx-auto w-full max-w-2xl px-4 pb-16 sm:px-5">
        <div className="glass rounded-3xl p-5 sm:p-8">
          {step === "connect" && (
            <BlurFade key="connect" className="flex flex-col gap-7">
              <div className="flex flex-col gap-2">
                <h1 className="text-balance text-2xl font-semibold tracking-tight text-foreground sm:text-[28px]">
                  Connect where your money lives
                </h1>
                <p className="max-w-[56ch] leading-relaxed text-muted">
                  Sam reads your cash, revenue, and payroll automatically, so the interview can skip what the data already
                  says.
                </p>
              </div>

              <ul className="flex flex-col gap-2">
                <li className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-border bg-white/[0.03] p-4">
                  <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-accent-soft text-accent">
                    <Bank weight="duotone" className="h-5 w-5" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[15px] font-medium text-foreground">Bank accounts</span>
                    <span className="text-[13px] text-muted-2">Balances and transactions via Plaid</span>
                  </span>
                  {cashOnHandUsd !== null ? connectedBadge : <PlaidLinkButton onLinked={refreshConnections} />}
                </li>
                <li className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-border bg-white/[0.03] p-4">
                  <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-accent-soft text-accent">
                    <CreditCard weight="duotone" className="h-5 w-5" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[15px] font-medium text-foreground">Stripe</span>
                    <span className="text-[13px] text-muted-2">Revenue via balance transactions</span>
                  </span>
                  {stripeConnected ? connectedBadge : <StripeLinkButton onLinked={refreshConnections} />}
                </li>
                <li className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-border bg-white/[0.03] p-4">
                  <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-accent-soft text-accent">
                    <Users weight="duotone" className="h-5 w-5" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[15px] font-medium text-foreground">Payroll</span>
                    <span className="text-[13px] text-muted-2">
                      {payrollConnected && monthlyPayrollCostUsd !== null
                        ? `${usd(monthlyPayrollCostUsd)} / mo payroll via Gusto`
                        : "Headcount and loaded cost via Gusto"}
                    </span>
                    {gustoStatus && (
                      <span
                        role="status"
                        className={cn("mt-1 text-[13px]", gustoStatus.tone === "error" ? "text-danger" : "text-muted")}
                      >
                        {gustoStatus.message}
                      </span>
                    )}
                  </span>
                  {payrollConnected ? connectedBadge : <GustoLinkButton />}
                </li>
              </ul>

              <div
                aria-live="polite"
                className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5"
              >
                {cashOnHandUsd !== null ? (
                  <div>
                    <p className="text-[13px] text-muted-2">Cash on hand</p>
                    <p className="text-2xl font-semibold tracking-tight text-foreground">
                      $<NumberTicker value={cashOnHandUsd} />
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-2">
                    {loadingCash ? "Checking for a connected bank…" : "No bank connected yet. You can add it later."}
                  </p>
                )}
                <button
                  type="button"
                  onClick={refreshConnections}
                  disabled={loadingCash}
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm text-muted transition-colors hover:text-foreground disabled:opacity-50"
                >
                  <ArrowClockwise className={cn("h-4 w-4", loadingCash && "animate-spin")} />
                  Refresh
                </button>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setStep("interview")}
                  className={cashOnHandUsd !== null ? pillPrimary : pillSecondary}
                >
                  {cashOnHandUsd !== null ? "Continue" : "Skip for now"}
                </button>
              </div>
            </BlurFade>
          )}

          {step === "interview" && (
            <BlurFade key="interview">
              <InterviewStep onFinished={() => setStep("review")} />
            </BlurFade>
          )}

          {step === "review" && (
            <BlurFade key="review">
              <PlaybackStep onBack={() => setStep("interview")} onDone={() => setStep("done")} />
            </BlurFade>
          )}

          {step === "done" && (
            <BlurFade key="done" className="flex flex-col gap-7">
              <div className="flex flex-col gap-2">
                <h1 className="text-balance text-2xl font-semibold tracking-tight text-foreground sm:text-[28px]">
                  Sam is ready
                </h1>
                <p className="max-w-[56ch] leading-relaxed text-muted">
                  Sam now knows your company and how you like to work. Anything you skipped, Sam will ask about when it
                  actually matters.
                </p>
              </div>
              <div className="flex justify-end border-t border-border pt-5">
                <Link href="/" className={pillPrimary}>
                  Back to home
                </Link>
              </div>
            </BlurFade>
          )}
        </div>
      </main>
    </div>
  );
}
