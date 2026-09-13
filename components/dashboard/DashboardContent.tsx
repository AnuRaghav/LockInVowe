import Link from "next/link";
import { ChatCircleText } from "@phosphor-icons/react/dist/ssr";

import { InsightCard } from "@/components/dashboard/InsightCard";
import { NarratedInsight } from "@/components/dashboard/NarratedInsight";
import { SamLogo } from "@/components/SamLogo";
import { BlurFade } from "@/components/ui/blur-fade";
import type { DigestInsight } from "@/lib/insights/types";

const TODAY_LABEL = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(
  new Date(),
);

/**
 * The daily digest itself - split out of app/dashboard/page.tsx so
 * DashboardReveal can gate it behind the loading screen.
 *
 * Layout: the first insight runs full-width as the headline read, the
 * remaining four sit in a 2-column grid - a hero-plus-grid shape rather than
 * five equal boxes, so there's a clear "start here" the way a real digest
 * would lead with its most important item.
 */
export function DashboardContent({ insights }: { insights: DigestInsight[] }) {
  const [hero, ...rest] = insights;

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

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 pb-24 pt-8">
        <BlurFade className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-[13px] text-muted-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
            </span>
            Sam&apos;s daily digest &middot; {TODAY_LABEL}
          </div>
          <h1 className="text-balance text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
            Five things worth knowing today.
          </h1>
          <p className="max-w-[60ch] text-[15px] leading-relaxed text-muted">
            Sam went through your connected accounts, payroll, and revenue overnight. Here&apos;s
            what stood out — ask about any of it.
          </p>
        </BlurFade>

        {hero && (
          <>
            <NarratedInsight text={hero.note} />
            <InsightCard insight={hero} delay={0} />
          </>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {rest.map((insight, i) => (
            <InsightCard key={insight.id} insight={insight} delay={0.08 * (i + 1)} />
          ))}
        </div>

        <BlurFade delay={0.5} className="flex flex-col items-start gap-3 border-t border-border pt-8">
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
