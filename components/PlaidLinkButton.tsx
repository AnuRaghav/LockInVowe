"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlaidLink, type PlaidLinkOnSuccess } from "react-plaid-link";

import { cn } from "@/lib/utils";

interface PlaidLinkButtonProps {
  className?: string;
  /** Called after the account is exchanged and the first sync finishes. */
  onLinked?: () => void;
}

/**
 * Minimal end-to-end Plaid Link flow: fetch a link token, open Plaid Link,
 * exchange the resulting public token, then trigger one sync through the
 * provider-neutral /api/source/sync route. Exists to exercise the connector
 * manually - swap for the real onboarding UI once that flow is designed.
 */
export const PlaidLinkButton = ({ className, onLinked }: PlaidLinkButtonProps) => {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/plaid/create-link-token", { method: "POST" })
      .then((res) => res.json())
      .then((data) => setLinkToken(data.linkToken ?? null))
      .catch(() => setStatus("Couldn't reach Plaid. Refresh the page to try again."));
  }, []);

  const onSuccess: PlaidLinkOnSuccess = useCallback(
    async (publicToken, metadata) => {
      setBusy(true);
      setStatus("Linking account…");

      const exchangeRes = await fetch("/api/plaid/exchange-public-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicToken,
          institutionName: metadata.institution?.name ?? null,
        }),
      });
      const exchangeData = await exchangeRes.json();

      if (!exchangeRes.ok) {
        setBusy(false);
        setStatus(`Couldn't link the account: ${exchangeData.error}`);
        return;
      }

      setStatus("Syncing transactions...");
      const syncRes = await fetch("/api/source/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId: exchangeData.connectionId }),
      });
      const syncData = await syncRes.json();
      setBusy(false);

      setStatus(
        syncRes.ok
          ? `Synced ${syncData.counts.accounts} accounts, ${syncData.counts.entries} entries.`
          : `Failed to sync: ${syncData.error}`
      );
      if (syncRes.ok) onLinked?.();
    },
    [onLinked],
  );

  const { open, ready } = usePlaidLink({
    token: linkToken ?? "",
    onSuccess,
  });

  return (
    <div className={cn("flex flex-col items-start gap-2", className)}>
      <button
        type="button"
        onClick={() => open()}
        disabled={!ready || !linkToken || busy}
        className="whitespace-nowrap rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink transition-[background-color,transform] duration-200 hover:bg-accent-strong active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
      >
        {!linkToken && !status ? "Preparing…" : busy ? "Connecting…" : "Connect bank"}
      </button>
      <p role="status" aria-live="polite" className="text-[13px] text-muted empty:hidden">
        {status}
      </p>
    </div>
  );
};
