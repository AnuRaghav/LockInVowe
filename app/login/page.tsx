"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { createClient } from "@/lib/supabase/client";

type Mode = "sign-in" | "sign-up";

/**
 * Email/password auth. Every founder is their own company (see
 * lib/company/context.ts) - this is the only door in.
 */
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";

  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const supabase = createClient();

    if (mode === "sign-in") {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      setSubmitting(false);
      if (signInError) {
        setError(signInError.message);
        return;
      }
      router.push(next);
      router.refresh();
      return;
    }

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent(next)}` },
    });
    setSubmitting(false);

    if (signUpError) {
      setError(signUpError.message);
      return;
    }

    // A project with email confirmation off already has a session here.
    if (data.session) {
      router.push(next);
      router.refresh();
      return;
    }

    setCheckEmail(true);
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8">
        <div className="mb-6 flex items-center gap-2">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-accent" />
          <span className="text-[15px] font-semibold tracking-tight text-foreground">Sam</span>
        </div>

        {checkEmail ? (
          <p className="text-sm leading-relaxed text-muted">
            Check <strong className="text-foreground">{email}</strong> for a confirmation link,
            then come back and sign in.
          </p>
        ) : (
          <>
            <h1 className="mb-6 text-xl font-semibold tracking-tight text-foreground">
              {mode === "sign-in" ? "Sign in" : "Create an account"}
            </h1>

            <form onSubmit={submit} className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-muted">Email</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="rounded-lg border border-border bg-transparent px-3 py-2 text-foreground outline-none focus:border-accent"
                />
              </label>

              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-muted">Password</span>
                <input
                  type="password"
                  required
                  minLength={6}
                  autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="rounded-lg border border-border bg-transparent px-3 py-2 text-foreground outline-none focus:border-accent"
                />
              </label>

              {error && <p className="text-[13px] text-danger">{error}</p>}

              <button
                type="submit"
                disabled={submitting}
                className="mt-2 rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-45"
              >
                {submitting ? "Working…" : mode === "sign-in" ? "Sign in" : "Sign up"}
              </button>
            </form>

            <button
              type="button"
              onClick={() => {
                setMode(mode === "sign-in" ? "sign-up" : "sign-in");
                setError(null);
              }}
              className="mt-6 text-[13px] text-muted underline underline-offset-4 hover:text-foreground"
            >
              {mode === "sign-in" ? "Need an account? Sign up" : "Already have an account? Sign in"}
            </button>
          </>
        )}

        <Link href="/" className="mt-6 block text-[13px] text-muted underline underline-offset-4 hover:text-foreground">
          ← Back
        </Link>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
