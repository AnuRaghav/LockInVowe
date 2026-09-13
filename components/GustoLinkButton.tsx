"use client";

import { useState } from "react";

import type { GustoReturnPath } from "@/lib/gusto/client";
import { cn } from "@/lib/utils";

interface GustoLinkButtonProps {
  className?: string;
  /** Page Gusto's OAuth callback sends the founder back to. */
  returnTo?: GustoReturnPath;
}

/**
 * Starts Gusto's OAuth flow for onboarding.
 *
 * A plain link rather than a fetch like StripeLinkButton: OAuth needs a
 * top-level navigation to Gusto and back. The callback runs the first sync and
 * returns with `?gustoLinked=1` (or `?gustoError=`), which the page reads.
 */
export const GustoLinkButton = ({ className, returnTo = "/onboarding" }: GustoLinkButtonProps) => {
  const [navigating, setNavigating] = useState(false);

  return (
    <a
      href={`/api/gusto/authorize?returnTo=${encodeURIComponent(returnTo)}`}
      onClick={() => setNavigating(true)}
      aria-disabled={navigating}
      className={cn(
        "whitespace-nowrap rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink transition-[background-color,transform] duration-200 hover:bg-accent-strong active:scale-[0.98]",
        navigating && "pointer-events-none opacity-45",
        className,
      )}
    >
      {navigating ? "Opening Gusto…" : "Connect Gusto"}
    </a>
  );
};
