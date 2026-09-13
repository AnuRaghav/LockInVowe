/** Shared class strings for the onboarding flow, so every step reads as one surface. */

export const pillPrimary =
  "inline-flex items-center justify-center gap-2 rounded-full bg-accent px-5 py-3 text-sm font-medium text-accent-ink transition-[background-color,transform] duration-200 hover:bg-accent-strong active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent disabled:active:scale-100";

export const pillSecondary =
  "inline-flex items-center justify-center gap-2 rounded-full border border-border-strong px-5 py-3 text-sm font-medium text-foreground transition-[border-color,color,transform] duration-200 hover:border-accent hover:text-accent active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border-strong disabled:hover:text-foreground disabled:active:scale-100";

export const inputBase =
  "w-full rounded-xl border border-border bg-black/20 py-2.5 text-[15px] text-foreground tabular-nums outline-none transition-colors placeholder:text-muted-2 hover:border-border-strong focus:border-accent focus-visible:outline-none focus:ring-2 focus:ring-accent/25";

export const chip =
  "rounded-full border border-border-strong px-3.5 py-2 text-[13px] text-foreground transition-[border-color,color,background-color] duration-200 hover:border-accent hover:text-accent active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border-strong disabled:hover:text-foreground";

export const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
