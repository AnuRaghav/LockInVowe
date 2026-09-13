"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowClockwise, ArrowLeft, Bank, Check, CreditCard, Plus, Users, X } from "@phosphor-icons/react";

import { GustoLinkButton } from "@/components/GustoLinkButton";
import { PlaidLinkButton } from "@/components/PlaidLinkButton";
import { SamOrb } from "@/components/SamOrb";
import { SamLogo } from "@/components/SamLogo";
import { StripeLinkButton } from "@/components/StripeLinkButton";
import { BlurFade } from "@/components/ui/blur-fade";
import { NumberTicker } from "@/components/ui/number-ticker";
import { calculateRunway, type RunwayStatus } from "@/lib/finance/runway";
import { cn } from "@/lib/utils";

interface PlannedHireDraft {
  title: string;
  startDate: string;
  monthlyCostUsd: string;
}

const STEPS = [
  { key: "connect", label: "Connect" },
  { key: "questions", label: "Model" },
  { key: "review", label: "Done" },
] as const;
type StepKey = (typeof STEPS)[number]["key"];

const emptyHire = (): PlannedHireDraft => ({ title: "", startDate: "", monthlyCostUsd: "" });

/** Someone already on payroll, as the Model step edits them (numbers kept as input strings). */
interface TeamMemberDraft extends PlannedHireDraft {
  name: string;
}

const emptyMember = (): TeamMemberDraft => ({ ...emptyHire(), name: "" });

const STATUS_LABEL: Record<RunwayStatus, string> = {
  cash_flow_positive: "Cash flow positive",
  healthy: "Healthy",
  warning: "Getting tight",
  critical: "Critical",
};

const pillPrimary =
  "inline-flex items-center justify-center gap-2 rounded-full bg-accent px-5 py-3 text-sm font-medium text-accent-ink transition-[background-color,transform] duration-200 hover:bg-accent-strong active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100";
const pillSecondary =
  "inline-flex items-center justify-center gap-2 rounded-full border border-border-strong px-5 py-3 text-sm font-medium text-foreground transition-[border-color,color,transform] duration-200 hover:border-accent hover:text-accent active:scale-[0.98]";
const inputBase =
  "w-full rounded-xl border border-border bg-black/20 py-2.5 text-[15px] text-foreground tabular-nums outline-none transition-colors placeholder:text-muted-2 hover:border-border-strong focus:border-accent focus-visible:outline-none focus:ring-2 focus:ring-accent/25";

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

function MoneyField({
  label,
  help,
  value,
  onChange,
  prefix,
  suffix,
}: {
  label: string;
  help: string;
  value: string;
  onChange: (v: string) => void;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <span className="relative block">
        {prefix && (
          <span aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-2">
            {prefix}
          </span>
        )}
        <input
          type="number"
          inputMode="decimal"
          min={0}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(inputBase, prefix ? "pl-7" : "pl-3.5", suffix ? "pr-12" : "pr-3.5")}
        />
        {suffix && (
          <span aria-hidden className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-muted-2">
            {suffix}
          </span>
        )}
      </span>
      <span className="text-[13px] text-muted-2">{help}</span>
    </label>
  );
}

/**
 * MVP onboarding wizard (see PROJECT_OVERVIEW.md "MVP Onboarding Flow"):
 * connect data sources, auto-construct what the data already answers,
 * then ask the founder only what's still missing.
 */
export default function OnboardingPage() {
  const [step, setStep] = useState<StepKey>("connect");
  const [cashOnHandUsd, setCashOnHandUsd] = useState<number | null>(null);
  const [loadingCash, setLoadingCash] = useState(false);
  const [stripeConnected, setStripeConnected] = useState(false);
  const [payrollConnected, setPayrollConnected] = useState(false);
  const [monthlyPayrollCostUsd, setMonthlyPayrollCostUsd] = useState<number | null>(null);
  const [gustoStatus, setGustoStatus] = useState<{ tone: "ok" | "error"; message: string } | null>(null);

  const [mrrUsd, setMrrUsd] = useState("");
  const [mrrTouched, setMrrTouched] = useState(false);
  const [monthlyExpensesUsd, setMonthlyExpensesUsd] = useState("");
  const [monthlyGrowthTargetPct, setMonthlyGrowthTargetPct] = useState("");
  const [minimumRunwayMonths, setMinimumRunwayMonths] = useState("12");
  const [plannedHires, setPlannedHires] = useState<PlannedHireDraft[]>([]);
  // null until payroll is connected; seeded from Gusto (or the founder's saved
  // edits) and then owned by the founder once they touch it.
  const [team, setTeam] = useState<TeamMemberDraft[] | null>(null);
  const [teamTouched, setTeamTouched] = useState(false);
  const [teamSource, setTeamSource] = useState<"founder" | "gusto" | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const refreshCash = useCallback(async () => {
    setLoadingCash(true);
    try {
      const res = await fetch("/api/onboarding");
      const data = await res.json();
      setCashOnHandUsd(typeof data.cashOnHandUsd === "number" ? data.cashOnHandUsd : null);
      setStripeConnected(Boolean(data.stripeConnected));
      setPayrollConnected(Boolean(data.payrollConnected));
      setMonthlyPayrollCostUsd(
        typeof data.monthlyPayrollCostUsd === "number" ? data.monthlyPayrollCostUsd : null,
      );
      // Only prefill from Stripe's derived revenue while the founder hasn't
      // typed their own number - never clobber a value they're editing.
      setMrrUsd((current) => {
        if (mrrTouched || current.trim() !== "") return current;
        return typeof data.mrrUsd === "number" ? String(data.mrrUsd) : current;
      });
      if (!teamTouched && Array.isArray(data.currentTeam)) {
        setTeamSource(data.currentTeamSource ?? null);
        setTeam(
          data.currentTeam.map(
            (member: { name: string; title: string; startDate: string; monthlyCostUsd: number }) => ({
              name: member.name,
              title: member.title,
              startDate: member.startDate,
              monthlyCostUsd: String(member.monthlyCostUsd),
            }),
          ),
        );
      }
    } catch {
      // No connectors are linked yet, or the fetch failed - the founder can
      // still continue and enter everything by hand.
    } finally {
      setLoadingCash(false);
    }
  }, [mrrTouched, teamTouched]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount, not a derived-state sync
    void refreshCash();
  }, [refreshCash]);

  // Gusto's OAuth leaves the page and comes back through
  // app/api/gusto/callback, which has already run the first sync. Read the
  // outcome it left in the URL once, then clear it so a refresh doesn't replay it.
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
      const employees = params.get("gustoEmployees") ?? "0";
      setGustoStatus({ tone: "ok", message: `Synced ${employees} employees from Gusto.` });
    }

    const url = new URL(window.location.href);
    ["gustoError", "gustoSyncError", "gustoLinked", "gustoEmployees", "gustoPayrolls"].forEach((key) =>
      url.searchParams.delete(key),
    );
    window.history.replaceState({}, "", url.toString());
  }, []);

  const updateHire = (index: number, patch: Partial<PlannedHireDraft>) => {
    setPlannedHires((hires) => hires.map((hire, i) => (i === index ? { ...hire, ...patch } : hire)));
  };

  const removeHire = (index: number) => {
    setPlannedHires((hires) => hires.filter((_, i) => i !== index));
  };

  const editTeam = (edit: (members: TeamMemberDraft[]) => TeamMemberDraft[]) => {
    setTeamTouched(true);
    setTeam((members) => edit(members ?? []));
  };

  const teamTotalUsd =
    team === null ? null : Math.round(team.reduce((sum, member) => sum + (Number(member.monthlyCostUsd) || 0), 0));
  // The team, once loaded, is the payroll figure: edits to it are corrections to Gusto.
  const payrollUsd = teamTotalUsd ?? monthlyPayrollCostUsd;

  const parsedMrr = Number(mrrUsd) || 0;
  // With payroll known, the typed field is everything *except* payroll, and burn
  // is the two added together. Without it, the field is total expenses as before.
  const otherExpensesUsd = Number(monthlyExpensesUsd) || 0;
  const parsedExpenses = otherExpensesUsd + (payrollUsd ?? 0);
  const parsedFloor = Number(minimumRunwayMonths) || 0;
  const preview =
    cashOnHandUsd !== null && (mrrUsd || monthlyExpensesUsd || payrollUsd)
      ? calculateRunway({
          cashOnHandUsd,
          monthlyRevenueUsd: parsedMrr,
          monthlyExpensesUsd: parsedExpenses,
        })
      : null;
  const belowFloor = preview?.runwayMonths != null && parsedFloor > 0 && preview.runwayMonths < parsedFloor;

  const missingCore = [mrrUsd, monthlyExpensesUsd, monthlyGrowthTargetPct, minimumRunwayMonths].some(
    (v) => v.trim() === "",
  );
  const incompleteHire = plannedHires.some(
    (hire) => !hire.title.trim() || !hire.startDate.trim() || !hire.monthlyCostUsd.trim(),
  );
  const incompleteMember = (team ?? []).some((member) => !member.name.trim() || !member.monthlyCostUsd.trim());
  const canSubmitQuestions = !missingCore && !incompleteHire && !incompleteMember;

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
          minimumRunwayMonths: parsedFloor,
          plannedHires: plannedHires.map((hire) => ({
            title: hire.title,
            startDate: hire.startDate,
            monthlyCostUsd: Number(hire.monthlyCostUsd) || 0,
          })),
          ...(team !== null && {
            currentTeam: team.map((member) => ({
              name: member.name,
              title: member.title,
              startDate: member.startDate,
              monthlyCostUsd: Number(member.monthlyCostUsd) || 0,
            })),
          }),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't save your model. Try again.");
      setSaved(true);
      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save your model. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const stepIndex = STEPS.findIndex((s) => s.key === step);
  const orbEnergy = saving ? 1 : step === "review" ? 0.8 : cashOnHandUsd !== null ? 0.55 : 0.25;

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
                i > stepIndex && "text-muted-2",
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
                  Sam reads your cash, revenue, and payroll automatically, so you don&apos;t have to type them in.
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
                  {cashOnHandUsd !== null ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-[13px] font-medium text-accent">
                      <Check weight="bold" className="h-3.5 w-3.5" />
                      Connected
                    </span>
                  ) : (
                    <PlaidLinkButton onLinked={refreshCash} />
                  )}
                </li>
                <li className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-border bg-white/[0.03] p-4">
                  <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-accent-soft text-accent">
                    <CreditCard weight="duotone" className="h-5 w-5" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[15px] font-medium text-foreground">Stripe</span>
                    <span className="text-[13px] text-muted-2">Revenue via balance transactions</span>
                  </span>
                  {stripeConnected ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-[13px] font-medium text-accent">
                      <Check weight="bold" className="h-3.5 w-3.5" />
                      Connected
                    </span>
                  ) : (
                    <StripeLinkButton onLinked={refreshCash} />
                  )}
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
                  {payrollConnected ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-[13px] font-medium text-accent">
                      <Check weight="bold" className="h-3.5 w-3.5" />
                      Connected
                    </span>
                  ) : (
                    <GustoLinkButton />
                  )}
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
                  onClick={refreshCash}
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
                  onClick={() => setStep("questions")}
                  className={cashOnHandUsd !== null ? pillPrimary : pillSecondary}
                >
                  {cashOnHandUsd !== null ? "Continue" : "Skip for now"}
                </button>
              </div>
            </BlurFade>
          )}

          {step === "questions" && (
            <BlurFade key="questions" className="flex flex-col gap-8">
              <div className="flex flex-col gap-2">
                <h1 className="text-balance text-2xl font-semibold tracking-tight text-foreground sm:text-[28px]">
                  A few things your bank can&apos;t tell us
                </h1>
                <p className="max-w-[56ch] leading-relaxed text-muted">
                  These become your company&apos;s financial model. Sam keeps them up to date, but they start here.
                </p>
              </div>

              <div className="grid gap-x-5 gap-y-6 sm:grid-cols-2">
                <MoneyField
                  label="Monthly recurring revenue"
                  help={
                    stripeConnected
                      ? "Prefilled from Stripe's last 30 days - adjust if it's not representative."
                      : "What you bill each month today."
                  }
                  prefix="$"
                  value={mrrUsd}
                  onChange={(v) => {
                    setMrrTouched(true);
                    setMrrUsd(v);
                  }}
                />
                <MoneyField
                  label={payrollUsd !== null ? "Other monthly expenses" : "Monthly operating expenses"}
                  help={
                    payrollUsd !== null
                      ? `Rent, software, everything except payroll. Your team's ${usd(payrollUsd)} / mo is added automatically.`
                      : "Average over the last few months."
                  }
                  prefix="$"
                  value={monthlyExpensesUsd}
                  onChange={setMonthlyExpensesUsd}
                />
                <MoneyField
                  label="Target monthly growth"
                  help="Used for your base-case forecast."
                  suffix="%"
                  value={monthlyGrowthTargetPct}
                  onChange={setMonthlyGrowthTargetPct}
                />
                <MoneyField
                  label="Minimum runway to protect"
                  help="Sam warns you before a decision crosses it."
                  suffix="mo"
                  value={minimumRunwayMonths}
                  onChange={setMinimumRunwayMonths}
                />
              </div>

              {team !== null && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-col">
                      <h2 className="text-sm font-medium text-foreground">Current team</h2>
                      <p className="text-[13px] text-muted-2">
                        {teamSource === "founder" && !teamTouched ? "Your saved edits" : "From Gusto"} ·{" "}
                        {team.length} {team.length === 1 ? "person" : "people"} · {usd(teamTotalUsd ?? 0)} / mo
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => editTeam((members) => [...members, emptyMember()])}
                      className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-accent transition-colors hover:text-accent-strong"
                    >
                      <Plus weight="bold" className="h-3.5 w-3.5" />
                      Add person
                    </button>
                  </div>
                  {team.length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-border px-4 py-5 text-sm text-muted-2">
                      No one on payroll. Add people to include their cost.
                    </p>
                  ) : (
                    <ul className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto pr-1">
                      {team.map((member, i) => (
                        <li
                          key={i}
                          className="grid grid-cols-2 items-end gap-3 rounded-2xl border border-border bg-white/[0.03] p-3 sm:grid-cols-[1.1fr_1.1fr_0.9fr_0.8fr_auto]"
                        >
                          <label className="flex flex-col gap-1.5">
                            <span className="text-[13px] text-muted">Name</span>
                            <input
                              value={member.name}
                              placeholder="Alex Kim"
                              onChange={(e) =>
                                editTeam((members) =>
                                  members.map((m, j) => (j === i ? { ...m, name: e.target.value } : m)),
                                )
                              }
                              className={cn(inputBase, "px-3 py-2 text-sm")}
                            />
                          </label>
                          <label className="flex flex-col gap-1.5">
                            <span className="text-[13px] text-muted">Role</span>
                            <input
                              value={member.title}
                              placeholder="Engineer"
                              onChange={(e) =>
                                editTeam((members) =>
                                  members.map((m, j) => (j === i ? { ...m, title: e.target.value } : m)),
                                )
                              }
                              className={cn(inputBase, "px-3 py-2 text-sm")}
                            />
                          </label>
                          <label className="flex flex-col gap-1.5">
                            <span className="text-[13px] text-muted">Start date</span>
                            <input
                              type="date"
                              value={member.startDate}
                              onChange={(e) =>
                                editTeam((members) =>
                                  members.map((m, j) => (j === i ? { ...m, startDate: e.target.value } : m)),
                                )
                              }
                              className={cn(inputBase, "px-3 py-2 text-sm")}
                            />
                          </label>
                          <label className="flex flex-col gap-1.5">
                            <span className="text-[13px] text-muted">Monthly cost</span>
                            <input
                              type="number"
                              inputMode="decimal"
                              min={0}
                              value={member.monthlyCostUsd}
                              onChange={(e) =>
                                editTeam((members) =>
                                  members.map((m, j) => (j === i ? { ...m, monthlyCostUsd: e.target.value } : m)),
                                )
                              }
                              className={cn(inputBase, "px-3 py-2 text-sm")}
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => editTeam((members) => members.filter((_, j) => j !== i))}
                            aria-label={`Remove ${member.name || "person"}`}
                            className="col-span-2 inline-flex h-10 items-center justify-center gap-1.5 rounded-xl text-sm text-muted-2 transition-colors hover:bg-danger-soft hover:text-danger sm:col-span-1 sm:w-10"
                          >
                            <X weight="bold" className="h-4 w-4" />
                            <span className="sm:hidden">Remove</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-medium text-foreground">Planned hires</h2>
                  <button
                    type="button"
                    onClick={() => setPlannedHires((hires) => [...hires, emptyHire()])}
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-accent transition-colors hover:text-accent-strong"
                  >
                    <Plus weight="bold" className="h-3.5 w-3.5" />
                    Add hire
                  </button>
                </div>
                {plannedHires.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-border px-4 py-5 text-sm text-muted-2">
                    No hires planned. Add one to see how it moves your runway.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {plannedHires.map((hire, i) => (
                      <li
                        key={i}
                        className="grid grid-cols-2 items-end gap-3 rounded-2xl border border-border bg-white/[0.03] p-3 sm:grid-cols-[1.4fr_1fr_1fr_auto]"
                      >
                        <label className="col-span-2 flex flex-col gap-1.5 sm:col-span-1">
                          <span className="text-[13px] text-muted">Role</span>
                          <input
                            value={hire.title}
                            placeholder="Senior engineer"
                            onChange={(e) => updateHire(i, { title: e.target.value })}
                            className={cn(inputBase, "px-3 py-2 text-sm")}
                          />
                        </label>
                        <label className="flex flex-col gap-1.5">
                          <span className="text-[13px] text-muted">Start date</span>
                          <input
                            type="date"
                            value={hire.startDate}
                            onChange={(e) => updateHire(i, { startDate: e.target.value })}
                            className={cn(inputBase, "px-3 py-2 text-sm")}
                          />
                        </label>
                        <label className="flex flex-col gap-1.5">
                          <span className="text-[13px] text-muted">Monthly cost</span>
                          <input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            value={hire.monthlyCostUsd}
                            onChange={(e) => updateHire(i, { monthlyCostUsd: e.target.value })}
                            className={cn(inputBase, "px-3 py-2 text-sm")}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => removeHire(i)}
                          aria-label={`Remove ${hire.title || "hire"}`}
                          className="col-span-2 inline-flex h-10 items-center justify-center gap-1.5 rounded-xl text-sm text-muted-2 transition-colors hover:bg-danger-soft hover:text-danger sm:col-span-1 sm:w-10"
                        >
                          <X weight="bold" className="h-4 w-4" />
                          <span className="sm:hidden">Remove</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {preview && (
                <div
                  aria-live="polite"
                  className="flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-border bg-black/20 p-5"
                >
                  <div>
                    <p className="text-[13px] text-muted-2">Runway, live</p>
                    <p className="mt-1 text-4xl font-semibold tracking-tight text-foreground">
                      {preview.runwayMonths !== null ? (
                        <>
                          <NumberTicker value={preview.runwayMonths} decimalPlaces={1} />
                          <span className="ml-1.5 text-lg font-medium text-muted">months</span>
                        </>
                      ) : (
                        "No limit"
                      )}
                    </p>
                    <p className="mt-1 text-[13px] text-muted">
                      {usd(cashOnHandUsd ?? 0)} cash, {usd(parsedMrr)} in, {usd(parsedExpenses)} out each month
                      {payrollUsd !== null && ` (${usd(payrollUsd)} payroll + ${usd(otherExpensesUsd)} other)`}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-3 py-1.5 text-[13px] font-medium",
                      belowFloor || preview.status === "critical" || preview.status === "warning"
                        ? "bg-danger-soft text-danger"
                        : "bg-accent-soft text-accent",
                    )}
                  >
                    {belowFloor ? `Below your ${parsedFloor} mo floor` : STATUS_LABEL[preview.status]}
                  </span>
                </div>
              )}

              <div className="flex flex-col gap-3 border-t border-border pt-5">
                {error && (
                  <p role="alert" className="text-sm text-danger">
                    {error}
                  </p>
                )}
                {!canSubmitQuestions && (
                  <p className="text-[13px] text-muted-2 sm:text-right">
                    {missingCore
                      ? "Fill in all four numbers to save."
                      : incompleteMember
                        ? "Every team member needs a name and monthly cost."
                        : "Finish or remove the open hire to save."}
                  </p>
                )}
                <div className="flex items-center justify-between gap-3">
                  <button type="button" onClick={() => setStep("connect")} className={pillSecondary}>
                    <ArrowLeft className="h-4 w-4" />
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={!canSubmitQuestions || saving}
                    onClick={submit}
                    className={pillPrimary}
                  >
                    {saving ? "Saving…" : "Save my model"}
                  </button>
                </div>
              </div>
            </BlurFade>
          )}

          {step === "review" && saved && (
            <BlurFade key="review" className="flex flex-col gap-7">
              <div className="flex flex-col gap-2">
                <h1 className="text-balance text-2xl font-semibold tracking-tight text-foreground sm:text-[28px]">
                  Your model is saved
                </h1>
                <p className="max-w-[56ch] leading-relaxed text-muted">
                  Sam will use this to answer questions like &ldquo;what&apos;s my runway?&rdquo; and keep it current as
                  things change.
                </p>
              </div>

              <div className="grid gap-6 sm:grid-cols-2">
                <section>
                  <h2 className="text-[13px] text-muted-2">Observed from your connections</h2>
                  <dl className="mt-3 flex flex-col">
                    <div className="flex items-baseline justify-between gap-3 border-b border-border py-2.5">
                      <dt className="text-sm text-muted">Cash on hand</dt>
                      <dd className="text-[15px] font-medium tabular-nums text-foreground">
                        {cashOnHandUsd !== null ? usd(cashOnHandUsd) : "Not connected"}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 border-b border-border py-2.5">
                      <dt className="text-sm text-muted">Monthly payroll</dt>
                      <dd className="text-[15px] font-medium tabular-nums text-foreground">
                        {payrollUsd !== null ? usd(payrollUsd) : "Not connected"}
                      </dd>
                    </div>
                    {preview?.runwayMonths != null && (
                      <div className="flex items-baseline justify-between gap-3 py-2.5">
                        <dt className="text-sm text-muted">Runway today</dt>
                        <dd className="text-[15px] font-medium tabular-nums text-foreground">
                          {preview.runwayMonths} months
                        </dd>
                      </div>
                    )}
                  </dl>
                </section>
                <section>
                  <h2 className="text-[13px] text-muted-2">Assumptions from you</h2>
                  <dl className="mt-3 flex flex-col">
                    {[
                      ["MRR", usd(parsedMrr)],
                      ["Monthly expenses", payrollUsd !== null ? `${usd(parsedExpenses)} incl. payroll` : usd(parsedExpenses)],
                      ["Growth target", `${Number(monthlyGrowthTargetPct) || 0}% / mo`],
                      ["Runway floor", `${parsedFloor} months`],
                      ...(team !== null ? [["Current team", `${team.length} people`]] : []),
                      ["Planned hires", String(plannedHires.length)],
                    ].map(([k, v], i, arr) => (
                      <div
                        key={k}
                        className={cn(
                          "flex items-baseline justify-between gap-3 py-2.5",
                          i < arr.length - 1 && "border-b border-border",
                        )}
                      >
                        <dt className="text-sm text-muted">{k}</dt>
                        <dd className="text-[15px] font-medium tabular-nums text-foreground">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              </div>

              <div className="flex flex-wrap justify-between gap-3 border-t border-border pt-5">
                <button type="button" onClick={() => setStep("questions")} className={pillSecondary}>
                  Edit answers
                </button>
                {/* Everything above is the model Sam answers from - onboarding
                    completion just hands off to the dashboard, not chat directly. */}
                <Link href="/dashboard" className={pillPrimary}>
                  Go to your dashboard
                </Link>
              </div>
            </BlurFade>
          )}
        </div>
      </main>
    </div>
  );
}
