"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Lock, PencilSimple, Trash } from "@phosphor-icons/react";

import { inputBase, pillPrimary, pillSecondary, usd } from "@/components/onboarding/styles";
import type { FounderAlert } from "@/lib/founder/contract";
import { PREFERENCE_OPTIONS, describeAlert } from "@/lib/onboarding/choices";
import type { OnboardingPlayback, PlaybackCorrection, PlaybackTopic } from "@/lib/onboarding/playback";
import { cn } from "@/lib/utils";

type Correct = (correction: PlaybackCorrection) => Promise<boolean>;

function Section({ title, caption, children }: { title: string; caption?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        {caption && <p className="text-[13px] text-muted-2">{caption}</p>}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-border px-4 py-4 text-sm text-muted-2">{children}</p>;
}

function TopicCard({
  topic,
  onSave,
  onRemove,
}: {
  topic: PlaybackTopic;
  onSave: (body: string) => Promise<boolean>;
  onRemove?: () => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(topic.body);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<boolean>) => {
    setBusy(true);
    const ok = await action();
    setBusy(false);
    if (ok) setEditing(false);
  };

  return (
    <li className="flex flex-col gap-2 rounded-2xl border border-border bg-white/[0.03] p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[15px] font-medium text-foreground">{topic.title}</h3>
        {!editing && (
          <div className="flex flex-none gap-1">
            <button
              type="button"
              onClick={() => {
                setBody(topic.body);
                setEditing(true);
              }}
              aria-label={`Correct ${topic.title}`}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-2 transition-colors hover:bg-white/5 hover:text-foreground"
            >
              <PencilSimple className="h-4 w-4" />
            </button>
            {onRemove && (
              <button
                type="button"
                onClick={() => void run(onRemove)}
                disabled={busy}
                aria-label={`Delete ${topic.title}`}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-2 transition-colors hover:bg-danger-soft hover:text-danger"
              >
                <Trash className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {editing ? (
        <div className="flex flex-col gap-3">
          <textarea
            value={body}
            rows={5}
            maxLength={4000}
            onChange={(e) => setBody(e.target.value)}
            className={cn(inputBase, "px-3 text-sm leading-relaxed")}
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)} className={pillSecondary}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void run(() => onSave(body.trim()))}
              disabled={busy || !body.trim()}
              className={pillPrimary}
            >
              {busy ? "Saving…" : "Save correction"}
            </button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-muted">{topic.body}</p>
      )}
    </li>
  );
}

const NUMBER_FIELDS = [
  { key: "mrr_usd", label: "Monthly recurring revenue", unit: "usd" },
  { key: "monthly_expenses_usd", label: "Monthly spend excluding payroll", unit: "usd" },
  { key: "gross_margin_pct", label: "Gross margin", unit: "%" },
  { key: "monthly_revenue_churn_pct", label: "Monthly revenue churn", unit: "%" },
  { key: "monthly_growth_target_pct", label: "Monthly growth target", unit: "%" },
  { key: "minimum_runway_months", label: "Minimum runway", unit: "months" },
  { key: "collection_lag_months", label: "Months until customers pay", unit: "months" },
  { key: "collection_rate_pct", label: "Share of revenue collected", unit: "%" },
] as const;

function NumberRow({
  field,
  value,
  onSave,
}: {
  field: (typeof NUMBER_FIELDS)[number];
  value: number;
  onSave: Correct;
}) {
  const [draft, setDraft] = useState(String(value));
  const [busy, setBusy] = useState(false);
  const changed = draft.trim() !== "" && Number(draft) !== value;

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-2.5 last:border-b-0">
      <label htmlFor={`number-${field.key}`} className="text-sm text-muted">
        {field.label}
      </label>
      <span className="flex items-center gap-2">
        {field.unit === "usd" && <span className="text-sm text-muted-2">$</span>}
        <input
          id={`number-${field.key}`}
          type="number"
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className={cn(inputBase, "w-32 px-3 py-1.5 text-right text-sm")}
        />
        {field.unit !== "usd" && <span className="w-12 text-sm text-muted-2">{field.unit}</span>}
        <button
          type="button"
          disabled={!changed || busy}
          onClick={async () => {
            setBusy(true);
            await onSave({ kind: "assumption", key: field.key, value: Number(draft) });
            setBusy(false);
          }}
          className="rounded-full px-3 py-1.5 text-[13px] font-medium text-accent transition-opacity disabled:opacity-0"
        >
          Save
        </button>
      </span>
    </li>
  );
}

const list = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const planLines = (assumptions: OnboardingPlayback["assumptions"]): string[] => [
  ...list<{ label: string; amountUsd: number; expectedCloseDate: string }>(assumptions.planned_raises).map(
    (raise) => `${raise.label}: ${usd(raise.amountUsd)}, expected to close ${raise.expectedCloseDate}`
  ),
  ...list<{ label: string; amountUsd: number; date: string }>(assumptions.one_time_costs).map(
    (cost) => `${cost.label}: ${usd(cost.amountUsd)} on ${cost.date}`
  ),
  ...list<{ title: string; startDate: string; monthlyCostUsd: number }>(assumptions.planned_hires).map(
    (hire) => `Hire ${hire.title} from ${hire.startDate}, ${usd(hire.monthlyCostUsd)} / mo`
  ),
];

function ProfileCard({ company, onSave }: { company: OnboardingPlayback["company"]; onSave: Correct }) {
  const [name, setName] = useState(company.name ?? "");
  const [description, setDescription] = useState(company.description ?? "");
  const [busy, setBusy] = useState(false);
  const changed = name.trim() !== (company.name ?? "") || description.trim() !== (company.description ?? "");

  return (
    <div className="grid gap-3 rounded-2xl border border-border bg-white/[0.03] p-4 sm:grid-cols-[0.8fr_1.6fr_auto] sm:items-end">
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] text-muted">Company name</span>
        <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} className={cn(inputBase, "px-3 py-2 text-sm")} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] text-muted">What it does</span>
        <input
          value={description}
          maxLength={400}
          onChange={(e) => setDescription(e.target.value)}
          className={cn(inputBase, "px-3 py-2 text-sm")}
        />
      </label>
      <button
        type="button"
        disabled={!changed || busy || (!name.trim() && !description.trim())}
        onClick={async () => {
          setBusy(true);
          await onSave({
            kind: "company-profile",
            ...(name.trim() && { name: name.trim() }),
            ...(description.trim() && { description: description.trim() }),
          });
          setBusy(false);
        }}
        className={pillSecondary}
      >
        Save
      </button>
    </div>
  );
}

function PreferencesCard({ preferences, onSave }: { preferences: OnboardingPlayback["preferences"]; onSave: Correct }) {
  const fields = Object.entries(PREFERENCE_OPTIONS) as Array<
    [keyof typeof PREFERENCE_OPTIONS, { label: string; options: Record<string, string> }]
  >;
  const flag = preferences?.flagOptimisticAssumptions;
  const alerts: FounderAlert[] = preferences?.alerts ?? [];

  return (
    <ul className="flex flex-col rounded-2xl border border-border bg-white/[0.03] px-4">
      {fields.map(([field, { label, options }]) => (
        <li key={field} className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-2.5">
          <label htmlFor={`preference-${field}`} className="text-sm text-muted">
            {label}
          </label>
          <select
            id={`preference-${field}`}
            value={preferences?.[field] ?? ""}
            onChange={(e) =>
              void onSave({ kind: "preference", patch: { [field]: e.target.value } } as PlaybackCorrection)
            }
            className={cn(inputBase, "w-auto px-3 py-1.5 text-sm")}
          >
            <option value="" disabled>
              Not set yet
            </option>
            {Object.entries(options).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </li>
      ))}
      <li className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-2.5">
        <label htmlFor="preference-flag" className="text-sm text-muted">
          Flag plans that look optimistic
        </label>
        <select
          id="preference-flag"
          value={flag === undefined ? "" : String(flag)}
          onChange={(e) =>
            void onSave({ kind: "preference", patch: { flagOptimisticAssumptions: e.target.value === "true" } })
          }
          className={cn(inputBase, "w-auto px-3 py-1.5 text-sm")}
        >
          <option value="" disabled>
            Not set yet
          </option>
          <option value="true">Yes, even if I don&apos;t ask</option>
          <option value="false">Only when I ask</option>
        </select>
      </li>
      <li className="flex flex-wrap items-start justify-between gap-3 py-2.5">
        <span className="text-sm text-muted">Raise without being asked</span>
        <span className="text-right text-sm text-foreground">
          {alerts.length === 0 ? "Nothing set" : alerts.map(describeAlert).join(" · ")}
        </span>
      </li>
    </ul>
  );
}

/**
 * Playback: what Sam understood, laid out for the founder to check and fix
 * before it becomes the baseline. Every fix is saved as a correction.
 */
export function PlaybackStep({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const [playback, setPlayback] = useState<OnboardingPlayback | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/onboarding/playback");
        const data = await res.json();
        if (cancelled) return;
        if (res.ok) setPlayback(data);
        else setError(data.error ?? "Couldn't load what Sam understood.");
      } catch {
        if (!cancelled) setError("Couldn't load what Sam understood. Refresh to try again.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const correct: Correct = async (correction) => {
    setError(null);
    try {
      const res = await fetch("/api/onboarding/playback", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ correction }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't save that change.");
        return false;
      }
      setPlayback(data);
      return true;
    } catch {
      setError("Couldn't save that change.");
      return false;
    }
  };

  const finish = async () => {
    setFinishing(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/complete", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't finish onboarding.");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't finish onboarding.");
    } finally {
      setFinishing(false);
    }
  };

  const numbers = playback
    ? NUMBER_FIELDS.filter((field) => typeof playback.assumptions[field.key] === "number")
    : [];
  const plans = playback ? planLines(playback.assumptions) : [];
  const openCount = playback ? Object.keys(playback.openItems).length : 0;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-balance text-2xl font-semibold tracking-tight text-foreground sm:text-[28px]">
          Here&apos;s what Sam understood
        </h1>
        <p className="max-w-[56ch] leading-relaxed text-muted">
          Fix anything that&apos;s off. Corrections are saved as corrections, so Sam can tell a misreading from a change of plan.
        </p>
      </div>

      {!playback && !error && <p className="text-sm text-muted-2">Loading…</p>}

      {playback && (
        <>
          <Section title="Your company">
            <ProfileCard company={playback.company} onSave={correct} />
            {playback.companyTopics.length === 0 ? (
              <Empty>Nothing written up yet.</Empty>
            ) : (
              <ul className="flex flex-col gap-2">
                {playback.companyTopics.map((topic) => (
                  <TopicCard
                    key={`${topic.key}-${topic.body.length}`}
                    topic={topic}
                    onSave={(body) => correct({ kind: "company-topic", key: topic.key, body })}
                  />
                ))}
              </ul>
            )}
          </Section>

          <Section title="Numbers and plans" caption="Used by forecasts as your assumptions, not as verified actuals.">
            {numbers.length === 0 && plans.length === 0 ? (
              <Empty>No numbers recorded.</Empty>
            ) : (
              <>
                {numbers.length > 0 && (
                  <ul className="flex flex-col rounded-2xl border border-border bg-white/[0.03] px-4">
                    {numbers.map((field) => (
                      <NumberRow
                        key={`${field.key}-${String(playback.assumptions[field.key])}`}
                        field={field}
                        value={playback.assumptions[field.key] as number}
                        onSave={correct}
                      />
                    ))}
                  </ul>
                )}
                {plans.length > 0 && (
                  <ul className="flex flex-col gap-1 px-1 text-sm text-muted">
                    {plans.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </Section>

          <Section title="How Sam will work with you">
            <PreferencesCard preferences={playback.preferences} onSave={correct} />
          </Section>

          <Section title="What matters to you">
            {playback.founderTopics.length === 0 ? (
              <Empty>Nothing written up yet.</Empty>
            ) : (
              <ul className="flex flex-col gap-2">
                {playback.founderTopics.map((topic) => (
                  <TopicCard
                    key={`${topic.key}-${topic.body.length}`}
                    topic={topic}
                    onSave={(body) => correct({ kind: "founder-topic", key: topic.key, body })}
                  />
                ))}
              </ul>
            )}
          </Section>

          {playback.personalTopics.length > 0 && (
            <Section title="Personal" caption="Only you can see this. Delete anything you'd rather Sam didn't keep.">
              <ul className="flex flex-col gap-2">
                {playback.personalTopics.map((topic) => (
                  <TopicCard
                    key={`${topic.key}-${topic.body.length}`}
                    topic={{ ...topic, title: topic.title }}
                    onSave={(body) => correct({ kind: "founder-topic", key: topic.key, body })}
                    onRemove={() => correct({ kind: "remove-founder-topic", key: topic.key })}
                  />
                ))}
              </ul>
              <p className="inline-flex items-center gap-1.5 text-[13px] text-muted-2">
                <Lock weight="bold" className="h-3.5 w-3.5" />
                Never shared with anyone else at your company.
              </p>
            </Section>
          )}

          {openCount > 0 && (
            <p className="text-[13px] text-muted-2">
              {openCount} {openCount === 1 ? "question was" : "questions were"} left for later. Sam will raise them when they
              matter.
            </p>
          )}
        </>
      )}

      <div className="flex flex-col gap-3 border-t border-border pt-5">
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={onBack} className={pillSecondary}>
            <ArrowLeft className="h-4 w-4" />
            Back to interview
          </button>
          <button
            type="button"
            onClick={finish}
            disabled={!playback?.readyToComplete || finishing}
            className={pillPrimary}
          >
            {finishing ? "Finishing…" : "Looks right"}
          </button>
        </div>
      </div>
    </div>
  );
}
