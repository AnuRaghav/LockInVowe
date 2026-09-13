import Link from "next/link";
import { ArrowRight, Lightbulb, Rocket, UserSwitch } from "@phosphor-icons/react/dist/ssr";

import { SamOrb } from "@/components/SamOrb";
import { SamLogo } from "@/components/SamLogo";
import { BlurFade } from "@/components/ui/blur-fade";
import { createClient } from "@/lib/supabase/server";

const points = [
  {
    icon: Lightbulb,
    title: "Insights in the background",
    body: "Sam keeps an eye on your numbers and saves what it finds.",
  },
  {
    icon: UserSwitch,
    title: "Delegate the work",
    body: "Hand off forecasts, hiring math, and spend reviews.",
  },
  {
    icon: Rocket,
    title: "Made for startups",
    body: "Runway, burn, hiring, and fundraising.",
  },
];

export default async function Home() {
  // Public marketing page (see proxy.ts) - the CTA below sends an anonymous
  // visitor through /login and back via ?next=, so this only needs to know
  // whether to offer "Log in" or "Sign out".
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        <Link href="/" aria-label="Sam home" className="inline-flex shrink-0 items-center">
          <SamLogo />
        </Link>
        {user ? (
          <form action="/auth/sign-out" method="post">
            <button
              type="submit"
              className="text-[13px] text-muted underline underline-offset-4 hover:text-foreground"
            >
              Sign out
            </button>
          </form>
        ) : (
          <Link
            href="/login"
            className="text-[13px] text-muted underline underline-offset-4 hover:text-foreground"
          >
            Log in
          </Link>
        )}
      </header>

      <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-12 px-6 pb-16 pt-8 md:grid-cols-[1.05fr_1fr] md:gap-8 md:pt-4">
        <BlurFade className="flex flex-col items-start gap-8">
          <h1 className="text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.03em] text-foreground md:text-5xl lg:text-6xl">
            Sam handles your startup&apos;s finances.
          </h1>
          <Link
            href="/onboarding"
            className="group inline-flex items-center gap-2 rounded-full bg-accent py-3 pl-6 pr-5 text-[15px] font-medium text-accent-ink shadow-[0_10px_30px_-8px_rgba(90,186,65,0.55)] transition-[background-color,transform] duration-200 hover:bg-accent-strong active:scale-[0.98]"
          >
            Get started
            <ArrowRight weight="bold" className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
        </BlurFade>

        <BlurFade delay={0.15} className="mx-auto flex w-full max-w-[520px] justify-center">
          <SamOrb energy={0.55} className="aspect-square w-[82%] max-w-[420px]" />
        </BlurFade>
      </main>

      <section aria-label="What Sam does" className="mx-auto w-full max-w-6xl px-6 pb-24">
        <ul className="grid gap-10 md:grid-cols-3 md:gap-8">
          {points.map(({ icon: Icon, title, body }) => (
            <li key={title} className="flex flex-col gap-3 border-t border-border pt-6">
              <Icon weight="duotone" className="h-6 w-6 text-accent" />
              <h2 className="text-base font-semibold text-foreground">{title}</h2>
              <p className="max-w-[38ch] text-[15px] leading-relaxed text-muted">{body}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
