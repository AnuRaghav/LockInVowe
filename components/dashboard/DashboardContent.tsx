import Link from "next/link";
import { ChatCircleText, WarningCircle } from "@phosphor-icons/react/dist/ssr";

import { SamLogo } from "@/components/SamLogo";
import { BlurFade } from "@/components/ui/blur-fade";
import type { Insight, InsightTone } from "@/lib/insights/types";
import { cn } from "@/lib/utils";

const toneStyles: Record<InsightTone, string> = {
  positive: "border-accent/30 bg-accent-soft",
  warning: "border-danger/25 bg-danger-soft",
  critical: "border-danger/40 bg-danger-soft",
  neutral: "border-border bg-surface",
};

/** The dashboard proper - split out of app/dashboard/page.tsx so DashboardReveal can gate it behind the loading screen. */
export function DashboardContent({ insights }: { insights: Insight[] }) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-6">
        <Link href="/" aria-label="Sam home" className="inline-flex shrink-0 items-center">
          <SamLogo />
        </Link>
        <nav className="flex items-center gap-5">
          <Link
            href="/onboarding"
            className="text-[13px] text-muted underline underline-offset-4 hover:text-foreground"
          >
            Edit your model
          </Link>
          <form action="/auth/sign-out" method="post">
            <button
              type="submit"
              className="text-[13px] text-muted underline underline-offset-4 hover:text-foreground"
            >
              Sign out
            </button>
          </form>
        </nav>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 pb-24 pt-8">
        <BlurFade className="flex flex-col gap-2">
          <h1 className="text-balance text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
            Here&apos;s where things stand.
          </h1>
          <p className="max-w-[60ch] text-[15px] leading-relaxed text-muted">
            Sam looked at your connected data and your model. Three things worth knowing before
            you ask anything.
          </p>
        </BlurFade>

        <BlurFade delay={0.05} className="grid gap-4 sm:grid-cols-3">
          {insights.map((insight) => (
            <Link
              key={insight.id}
              href="/chat"
              className={cn(
                "group flex flex-col gap-2.5 rounded-2xl border p-5 transition-[border-color,transform] duration-200 hover:-translate-y-0.5",
                toneStyles[insight.tone],
              )}
            >
              {insight.tone !== "neutral" && (
                <WarningCircle
                  weight="fill"
                  className={cn("h-5 w-5", insight.tone === "positive" ? "text-accent" : "text-danger")}
                />
              )}
              <h2 className="text-[15px] font-semibold leading-snug text-foreground">
                {insight.title}
              </h2>
              <p className="text-[13px] leading-relaxed text-muted">{insight.body}</p>
              {insight.followUpPrompt && (
                <span className="mt-auto inline-flex items-center gap-1.5 pt-1 text-[13px] font-medium text-accent opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                  Ask Sam
                  <ChatCircleText weight="bold" className="h-3.5 w-3.5" />
                </span>
              )}
            </Link>
          ))}
        </BlurFade>

        <BlurFade delay={0.1} className="flex flex-col items-start gap-3 border-t border-border pt-8">
          <p className="text-[13px] text-muted-2">Have a more specific question?</p>
          <Link
            href="/chat"
            className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-3 text-sm font-medium text-accent-ink transition-[background-color,transform] duration-200 hover:bg-accent-strong active:scale-[0.98]"
          >
            Chat with Sam
            <ChatCircleText weight="bold" className="h-4 w-4" />
          </Link>
        </BlurFade>
      </main>
    </div>
  );
}
