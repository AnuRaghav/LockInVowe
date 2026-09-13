import Link from "next/link";
import { ChatCircleText } from "@phosphor-icons/react/dist/ssr";

import { InsightCard } from "@/components/dashboard/InsightCard";
import { NarratedInsight } from "@/components/dashboard/NarratedInsight";
import { SamLogo } from "@/components/SamLogo";
import type { DigestInsight } from "@/lib/insights/types";

const TODAY_LABEL = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date());

/**
 * The daily digest itself - split out of app/dashboard/page.tsx so
 * DashboardReveal can gate it behind the loading screen.
 *
 * Layout: all five insights in one uniform grid (3-then-2 on desktop), sized
 * to fit on one screen without scrolling - a hero-plus-grid shape read
 * better on paper but cost too much vertical space for a live demo.
 */
export function DashboardContent({ insights }: { insights: DigestInsight[] }) {
  const [hero] = insights;

  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6">
        <Link href="/" aria-label="Sam home" className="inline-flex shrink-0 items-center">
          <SamLogo />
        </Link>
        <div className="flex items-center gap-4">
          <div className="hidden items-center gap-1.5 font-mono text-[11px] uppercase tracking-widest text-muted-2 sm:flex">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
            </span>
            Daily digest &middot; {TODAY_LABEL}
          </div>
          <nav className="flex items-center gap-4">
            <Link
              href="/onboarding"
              className="text-[13px] text-muted underline underline-offset-4 hover:text-foreground"
            >
              Edit model
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
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-3 px-6 pb-6 pt-1">
        {hero && <NarratedInsight text={hero.note} className="py-1" />}

        <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {insights.map((insight, i) => (
            <InsightCard key={insight.id} insight={insight} delay={0.06 * i} />
          ))}
        </div>

        <Link
          href="/chat"
          className="inline-flex w-fit items-center gap-1.5 self-center rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-accent-ink transition-[background-color,transform] duration-200 hover:bg-accent-strong active:scale-[0.98]"
        >
          Chat with Sam
          <ChatCircleText weight="bold" className="h-3.5 w-3.5" />
        </Link>
      </main>
    </div>
  );
}
