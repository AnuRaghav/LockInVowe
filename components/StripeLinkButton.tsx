"use client";

import { useCallback, useState } from "react";

import { cn } from "@/lib/utils";

interface StripeLinkButtonProps {
  className?: string;
  /** Called after the account is linked and its first sync finishes. */
  onLinked?: () => void;
}

/**
 * One-click Stripe link for onboarding.
 *
 * Unlike Plaid Link, connecting Stripe here has no user-facing handshake: the
 * MVP runs one Stripe sandbox account (see lib/source/stripe/client.ts), so
 * this button just registers it against the company and syncs it - the same
 * two calls the /connect test page's StripeConnectButton makes, trimmed to
 * the single-button shape PlaidLinkButton uses elsewhere in this flow.
 */
export const StripeLinkButton = ({ className, onLinked }: StripeLinkButtonProps) => {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const connect = useCallback(async () => {
    setBusy(true);
    setStatus("Connecting…");

    try {
      const connectRes = await fetch("/api/source/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "stripe" }),
      });
      const connectData = await connectRes.json();

      if (!connectRes.ok) {
        setStatus(`Couldn't link Stripe: ${connectData.error}`);
        return;
      }

      setStatus("Syncing revenue…");
      const syncRes = await fetch("/api/source/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId: connectData.connection.id }),
      });
      const syncData = await syncRes.json();

      setStatus(
        syncRes.ok
          ? `Synced ${syncData.counts.entries} Stripe entries.`
          : `Failed to sync: ${syncData.error}`
      );
      if (syncRes.ok) onLinked?.();
    } finally {
      setBusy(false);
    }
  }, [onLinked]);

  return (
    <div className={cn("flex flex-col items-start gap-2", className)}>
      <button
        type="button"
        onClick={connect}
        disabled={busy}
        className="whitespace-nowrap rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink transition-[background-color,transform] duration-200 hover:bg-accent-strong active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
      >
        {busy ? "Connecting…" : "Connect Stripe"}
      </button>
      <p role="status" aria-live="polite" className="text-[13px] text-muted empty:hidden">
        {status}
      </p>
    </div>
  );
};
