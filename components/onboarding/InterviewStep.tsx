"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Check, Lock, UsersThree } from "@phosphor-icons/react";

import { TeamEditor } from "@/components/onboarding/TeamEditor";
import { chip, pillPrimary, pillSecondary } from "@/components/onboarding/styles";
import { GENERAL_REPLIES, PERSONAL_DECLINE_REPLY } from "@/lib/onboarding/choices";
import type { OnboardingTurnResult } from "@/lib/onboarding/interview";
import type { InterviewStateView, InterviewTurnView } from "@/lib/onboarding/state";
import { cn } from "@/lib/utils";

type TurnResponse = Partial<OnboardingTurnResult> & { interview?: InterviewStateView; error?: string };

const TEAM_SAVED_MESSAGE = "I've updated my current team and planned hires in the table.";

function Turn({ turn }: { turn: InterviewTurnView }) {
  const founder = turn.role === "founder";

  return (
    <li className={cn("flex", founder ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed",
          founder ? "rounded-br-md bg-accent-soft text-foreground" : "rounded-bl-md bg-white/[0.05] text-foreground"
        )}
      >
        {turn.text === null ? (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
            <Lock weight="bold" className="h-3.5 w-3.5" />
            {founder ? "Personal answer · not kept in the transcript" : "Personal question"}
          </span>
        ) : (
          <p className="whitespace-pre-wrap">{turn.text}</p>
        )}
      </div>
    </li>
  );
}

/**
 * The onboarding interview: Sam asks, the founder answers, and progress through
 * the sections is shown as it happens. Quick replies are offered by Sam for the
 * question it just asked; typing is always an option.
 */
export function InterviewStep({ onFinished }: { onFinished: () => void }) {
  const [interview, setInterview] = useState<InterviewStateView | null>(null);
  const [pendingTurn, setPendingTurn] = useState<InterviewTurnView | null>(null);
  const [thinking, setThinking] = useState(false);
  const [choices, setChoices] = useState<readonly string[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showTeam, setShowTeam] = useState(false);
  const started = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);

  const send = useCallback(async (message?: string) => {
    setThinking(true);
    setError(null);
    setChoices([]);
    if (message) {
      setPendingTurn({ role: "founder", text: message, personal: false, at: new Date().toISOString() });
    }

    try {
      const res = await fetch("/api/onboarding/interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message ? { message } : {}),
      });
      const data = (await res.json()) as TurnResponse;

      if (!res.ok || !data.ok || !data.interview) {
        setError(data.error ?? "Sam couldn't reply just then. Try sending that again.");
        if (message) setDraft(message);
        return;
      }

      setInterview(data.interview);
      setChoices(data.choices?.options ?? []);
    } catch {
      setError("Sam couldn't reply just then. Try sending that again.");
      if (message) setDraft(message);
    } finally {
      setPendingTurn(null);
      setThinking(false);
    }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    (async () => {
      try {
        const res = await fetch("/api/onboarding/interview");
        const data = (await res.json()) as InterviewStateView & { error?: string };
        if (!res.ok) {
          setError(data.error ?? "Couldn't load onboarding.");
          return;
        }
        setInterview(data);
        if (!data.sessionId || data.transcript.length === 0) await send();
      } catch {
        setError("Couldn't load onboarding. Refresh to try again.");
      }
    })();
  }, [send]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [interview, pendingTurn, thinking]);

  const submit = (text: string) => {
    const message = text.trim();
    if (!message || thinking) return;
    setDraft("");
    void send(message);
  };

  const turns = [...(interview?.transcript ?? []), ...(pendingTurn ? [pendingTurn] : [])];
  const current = interview?.currentSection ?? null;
  const replies = [
    ...choices,
    ...GENERAL_REPLIES,
    ...(current === "personal" ? [PERSONAL_DECLINE_REPLY] : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-balance text-2xl font-semibold tracking-tight text-foreground sm:text-[28px]">
          Tell Sam about your company
        </h1>
        <p className="max-w-[56ch] leading-relaxed text-muted">
          About ten minutes. Answer in your own words, skip anything, and come back to it later if you like.
        </p>
      </div>

      {interview && (
        <ol aria-label="Interview sections" className="flex flex-wrap gap-1.5">
          {interview.sections.map((section) => (
            <li
              key={section.id}
              aria-current={section.state === "current" ? "step" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] transition-colors",
                section.state === "done" && "text-accent",
                section.state === "current" && "bg-white/10 text-foreground",
                section.state === "todo" && "text-muted-2"
              )}
            >
              {section.state === "done" && <Check weight="bold" className="h-3 w-3" />}
              {section.personal && section.state !== "done" && <Lock weight="bold" className="h-3 w-3" />}
              {section.title}
            </li>
          ))}
        </ol>
      )}

      <div className="flex max-h-[min(60vh,32rem)] min-h-[16rem] flex-col overflow-y-auto rounded-2xl border border-border bg-black/20 p-3 sm:p-4">
        <ul aria-live="polite" className="flex flex-col gap-3">
          {turns.map((turn, i) => (
            <Turn key={`${turn.at}-${i}`} turn={turn} />
          ))}
          {thinking && (
            <li className="flex justify-start">
              <span className="rounded-2xl rounded-bl-md bg-white/[0.05] px-4 py-3 text-[13px] text-muted">
                Sam is thinking…
              </span>
            </li>
          )}
        </ul>
        <div ref={bottom} />
      </div>

      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-danger-soft px-4 py-3">
          <p className="text-sm text-danger">{error}</p>
          {!interview?.transcript.length && (
            <button type="button" onClick={() => void send()} className={pillSecondary}>
              Try again
            </button>
          )}
        </div>
      )}

      {interview?.onboardingComplete ? (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border p-4">
          <p className="text-[15px] text-foreground">That&apos;s everything Sam needs to get started.</p>
          <button type="button" onClick={onFinished} className={pillPrimary}>
            Review what Sam understood
          </button>
        </div>
      ) : (
        <>
          {current === "company-plans" && !showTeam && (
            <button
              type="button"
              onClick={() => setShowTeam(true)}
              disabled={thinking}
              className={cn(pillSecondary, "self-start")}
            >
              <UsersThree weight="duotone" className="h-4 w-4" />
              Edit team and planned hires in a table
            </button>
          )}
          {showTeam && (
            <TeamEditor
              onCancel={() => setShowTeam(false)}
              onSaved={() => {
                setShowTeam(false);
                void send(TEAM_SAVED_MESSAGE);
              }}
            />
          )}

          <div className="flex flex-wrap gap-2">
            {replies.map((reply) => (
              <button key={reply} type="button" onClick={() => submit(reply)} disabled={thinking} className={chip}>
                {reply}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(draft);
            }}
            className="flex items-end gap-2 rounded-2xl border border-border bg-black/20 p-2 focus-within:border-accent"
          >
            <label htmlFor="onboarding-answer" className="sr-only">
              Your answer
            </label>
            <textarea
              id="onboarding-answer"
              value={draft}
              rows={2}
              maxLength={4000}
              placeholder={current === "personal" ? "Only you will see this. Skip anything." : "Type your answer…"}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit(draft);
                }
              }}
              className="max-h-40 min-h-[2.75rem] flex-1 resize-none bg-transparent px-2 py-2 text-[15px] text-foreground outline-none placeholder:text-muted-2"
            />
            <button
              type="submit"
              disabled={thinking || !draft.trim()}
              aria-label="Send"
              className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-full bg-accent text-accent-ink transition-colors hover:bg-accent-strong disabled:opacity-40"
            >
              <ArrowUp weight="bold" className="h-4 w-4" />
            </button>
          </form>
        </>
      )}
    </div>
  );
}
