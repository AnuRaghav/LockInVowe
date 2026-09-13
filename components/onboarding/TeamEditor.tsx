"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "@phosphor-icons/react";

import { inputBase, pillPrimary, pillSecondary, usd } from "@/components/onboarding/styles";
import { cn } from "@/lib/utils";

/** One person, as the table edits them: numbers kept as input strings. */
interface PersonDraft {
  name: string;
  title: string;
  startDate: string;
  monthlyCostUsd: string;
}

interface SavedPerson {
  name?: string;
  title: string;
  startDate: string;
  monthlyCostUsd: number;
}

const emptyPerson = (): PersonDraft => ({ name: "", title: "", startDate: "", monthlyCostUsd: "" });

const toDraft = (person: SavedPerson): PersonDraft => ({
  name: person.name ?? "",
  title: person.title,
  startDate: person.startDate,
  monthlyCostUsd: String(person.monthlyCostUsd),
});

function PeopleList({
  heading,
  caption,
  people,
  withName,
  addLabel,
  empty,
  onChange,
}: {
  heading: string;
  caption: string;
  people: PersonDraft[];
  withName: boolean;
  addLabel: string;
  empty: string;
  onChange: (people: PersonDraft[]) => void;
}) {
  const update = (index: number, patch: Partial<PersonDraft>) =>
    onChange(people.map((person, i) => (i === index ? { ...person, ...patch } : person)));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <h3 className="text-sm font-medium text-foreground">{heading}</h3>
          <p className="text-[13px] text-muted-2">{caption}</p>
        </div>
        <button
          type="button"
          onClick={() => onChange([...people, emptyPerson()])}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-accent transition-colors hover:text-accent-strong"
        >
          <Plus weight="bold" className="h-3.5 w-3.5" />
          {addLabel}
        </button>
      </div>

      {people.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-4 text-sm text-muted-2">{empty}</p>
      ) : (
        <ul className="flex max-h-[22rem] flex-col gap-2 overflow-y-auto pr-1">
          {people.map((person, i) => (
            <li
              key={i}
              className={cn(
                "grid grid-cols-2 items-end gap-3 rounded-2xl border border-border bg-white/[0.03] p-3",
                withName ? "sm:grid-cols-[1.1fr_1.1fr_0.9fr_0.8fr_auto]" : "sm:grid-cols-[1.4fr_1fr_1fr_auto]"
              )}
            >
              {withName && (
                <label className="flex flex-col gap-1.5">
                  <span className="text-[13px] text-muted">Name</span>
                  <input
                    value={person.name}
                    placeholder="Alex Kim"
                    onChange={(e) => update(i, { name: e.target.value })}
                    className={cn(inputBase, "px-3 py-2 text-sm")}
                  />
                </label>
              )}
              <label className={cn("flex flex-col gap-1.5", !withName && "col-span-2 sm:col-span-1")}>
                <span className="text-[13px] text-muted">Role</span>
                <input
                  value={person.title}
                  placeholder="Engineer"
                  onChange={(e) => update(i, { title: e.target.value })}
                  className={cn(inputBase, "px-3 py-2 text-sm")}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] text-muted">Start date</span>
                <input
                  type="date"
                  value={person.startDate}
                  onChange={(e) => update(i, { startDate: e.target.value })}
                  className={cn(inputBase, "px-3 py-2 text-sm")}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] text-muted">Monthly cost</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={person.monthlyCostUsd}
                  onChange={(e) => update(i, { monthlyCostUsd: e.target.value })}
                  className={cn(inputBase, "px-3 py-2 text-sm")}
                />
              </label>
              <button
                type="button"
                onClick={() => onChange(people.filter((_, j) => j !== i))}
                aria-label={`Remove ${person.name || person.title || "row"}`}
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
  );
}

/**
 * The current team and planned hires as a table, for the hiring part of the
 * interview. Typing a team into a chat is slow; this saves the structured
 * values directly, and the interview carries on with why each role exists.
 */
export function TeamEditor({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const [team, setTeam] = useState<PersonDraft[]>([]);
  const [hires, setHires] = useState<PersonDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/onboarding");
        const data = await res.json();
        if (cancelled) return;
        if (Array.isArray(data.currentTeam)) setTeam(data.currentTeam.map(toDraft));
        if (Array.isArray(data.assumptions?.planned_hires)) setHires(data.assumptions.planned_hires.map(toDraft));
      } catch {
        // Start empty; the founder can still add people by hand.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const teamTotal = team.reduce((sum, person) => sum + (Number(person.monthlyCostUsd) || 0), 0);
  const incomplete =
    team.some((person) => !person.name.trim() || !person.monthlyCostUsd.trim()) ||
    hires.some((hire) => !hire.title.trim() || !hire.startDate || !hire.monthlyCostUsd.trim());

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/team", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentTeam: team.map((person) => ({
            name: person.name,
            title: person.title,
            startDate: person.startDate,
            monthlyCostUsd: Number(person.monthlyCostUsd) || 0,
          })),
          plannedHires: hires.map((hire) => ({
            title: hire.title,
            startDate: hire.startDate,
            monthlyCostUsd: Number(hire.monthlyCostUsd) || 0,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't save the team.");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the team.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="rounded-2xl border border-border p-4 text-sm text-muted-2">Loading your team…</p>;
  }

  return (
    <div className="flex flex-col gap-6 rounded-2xl border border-border bg-black/20 p-4 sm:p-5">
      <PeopleList
        heading="Current team"
        caption={`${team.length} ${team.length === 1 ? "person" : "people"} · ${usd(teamTotal)} / mo`}
        people={team}
        withName
        addLabel="Add person"
        empty="No one on payroll yet."
        onChange={setTeam}
      />
      <PeopleList
        heading="Planned hires"
        caption="Monthly cost fully loaded, from the start date."
        people={hires}
        withName={false}
        addLabel="Add hire"
        empty="No hires planned."
        onChange={setHires}
      />

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {incomplete && (
          <p className="mr-auto text-[13px] text-muted-2">Every person needs a name and cost; every hire a role, date, and cost.</p>
        )}
        <button type="button" onClick={onCancel} className={pillSecondary}>
          Cancel
        </button>
        <button type="button" onClick={save} disabled={incomplete || saving} className={pillPrimary}>
          {saving ? "Saving…" : "Save team"}
        </button>
      </div>
    </div>
  );
}
