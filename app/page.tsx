import Link from "next/link";
import { ArrowRight, Bank, ChartLineUp, ChatCircleText } from "@phosphor-icons/react/dist/ssr";

import { SamOrb } from "@/components/SamOrb";
import { BlurFade } from "@/components/ui/blur-fade";

const flow = [
  {
    icon: Bank,
    title: "Connect",
    body: "Link your bank. Sam reads balances and transactions so you never type your cash position.",
  },
  {
    icon: ChartLineUp,
    title: "Model",
    body: "Sam builds a persistent financial memory of your business that evolves over time, keeping your model aligned with your current goals and needs.",
  },
  {
    icon: ChatCircleText,
    title: "Ask",
    body: "Ask about runway, hiring, spending, and growth. Sam builds forecasts grounded in your business so you can make your next decision with confidence.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center px-6">
        <span className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-accent" />
          Sam
        </span>
      </header>

      <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-12 px-6 pb-16 pt-8 md:grid-cols-[1.05fr_1fr] md:gap-8 md:pt-4">
        <BlurFade className="flex flex-col items-start gap-6">
          <h1 className="text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.03em] text-foreground md:text-5xl lg:text-6xl">
            Know your runway before you make the call.
          </h1>
          <p className="max-w-[46ch] text-lg leading-relaxed text-muted">
            Sam AI is an AI CFO that builds a persistent, company-specific financial memory and
            continuously adapts as your business changes. It keeps your financial model up to
            date so you can forecast runway, hiring, spending, and growth—and make better
            decisions with confidence.
          </p>
          <Link
            href="/onboarding"
            className="group mt-2 inline-flex items-center gap-2 rounded-full bg-accent py-3 pl-6 pr-5 text-[15px] font-medium text-accent-ink shadow-[0_10px_30px_-8px_rgba(90,186,65,0.55)] transition-[background-color,transform] duration-200 hover:bg-accent-strong active:scale-[0.98]"
          >
            Build my model
            <ArrowRight weight="bold" className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
        </BlurFade>

        <BlurFade delay={0.15} className="mx-auto flex w-full max-w-[520px] flex-col items-center">
          <SamOrb energy={0.55} className="aspect-square w-[82%] max-w-[420px]" />
          <figure className="glass -mt-[22%] w-[92%] max-w-[380px] rounded-2xl p-5">
            <figcaption className="text-[13px] text-muted-2">Example answer</figcaption>
            <p className="mt-1.5 text-[15px] font-medium text-foreground">
              &ldquo;Can we hire three engineers this quarter?&rdquo;
            </p>
            <div className="mt-4 flex items-end justify-between gap-4 border-t border-border pt-4">
              <div>
                <p className="text-3xl font-semibold tabular-nums tracking-tight text-foreground">
                  10.8<span className="ml-1 text-base font-medium text-muted">mo</span>
                </p>
                <p className="mt-0.5 text-[13px] text-muted">runway with 3 hires, down from 15.2</p>
              </div>
              <span className="whitespace-nowrap rounded-full bg-danger-soft px-2.5 py-1 text-xs font-medium text-danger">
                Below 12 mo floor
              </span>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              Hire two now. Make the third conditional on $250K MRR.
            </p>
          </figure>
        </BlurFade>
      </main>

      <section className="mx-auto w-full max-w-6xl px-6 pb-24">
        <h2 className="text-balance text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
          How Sam builds your financial model.
        </h2>
        <ol className="mt-10 grid gap-10 md:grid-cols-3 md:gap-8">
          {flow.map(({ icon: Icon, title, body }) => (
            <li key={title} className="flex flex-col gap-3 border-t border-border pt-6">
              <Icon weight="duotone" className="h-6 w-6 text-accent" />
              <h3 className="text-base font-semibold text-foreground">{title}</h3>
              <p className="max-w-[38ch] text-[15px] leading-relaxed text-muted">{body}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
