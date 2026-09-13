"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlaidLink, type PlaidLinkOnSuccess } from "react-plaid-link";

import { cn } from "@/lib/utils";

interface PlaidLinkButtonProps {
  className?: string;
  /** Called after the account is exchanged and the first sync finishes. */
  onLinked?: () => void;
}

/** Where the in-flight link_token is parked across an OAuth redirect. */
const LINK_TOKEN_STORAGE_KEY = "plaid_link_token";

/**
 * True once the browser has come back from an OAuth institution's redirect.
 * Plaid appends this query param to whatever `redirect_uri` was configured
 * in the link_token - see app/api/plaid/create-link-token/route.ts.
 */
const isOAuthResumption = () =>
  typeof window !== "undefined" && window.location.search.includes("oauth_state_id=");

/**
 * End-to-end Plaid Link flow: fetch a link token, open Plaid Link, exchange
 * the resulting public token, then trigger one sync through the
 * provider-neutral /api/source/sync route.
 *
 * Also handles OAuth institutions (most large US banks): those send the
 * browser away to the bank and back to `PLAID_REDIRECT_URI` mid-flow. This
 * component renders on that redirect page too (see app/plaid-oauth/page.tsx)
 * and, when it detects the return trip, resumes the *same* Link session
 * instead of starting a new one - Plaid rejects a fresh token here.
 */
export const PlaidLinkButton = ({ className, onLinked }: PlaidLinkButtonProps) => {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [resuming] = useState(isOAuthResumption);

  useEffect(() => {
    if (resuming) {
      const stored = sessionStorage.getItem(LINK_TOKEN_STORAGE_KEY);
      if (stored) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- resuming an external session on mount, not a derived-state sync
        setLinkToken(stored);
      } else {
        setStatus("Lost track of that connection attempt - go back and try again.");
      }
      return;
    }

    fetch("/api/plaid/create-link-token", { method: "POST" })
      .then((res) => res.json())
      .then((data) => {
        if (data.linkToken) sessionStorage.setItem(LINK_TOKEN_STORAGE_KEY, data.linkToken);
        setLinkToken(data.linkToken ?? null);
      })
      .catch(() => setStatus("Couldn't reach Plaid. Refresh the page to try again."));
  }, [resuming]);

  const onSuccess: PlaidLinkOnSuccess = useCallback(
    async (publicToken, metadata) => {
      sessionStorage.removeItem(LINK_TOKEN_STORAGE_KEY);
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
    ...(resuming && typeof window !== "undefined"
      ? { receivedRedirectUri: window.location.href }
      : {}),
  });

  // Resuming after OAuth has no user-facing "click to connect" step - Link
  // reopens itself to the point the bank redirect interrupted.
  useEffect(() => {
    if (resuming && ready) open();
  }, [resuming, ready, open]);

  if (resuming) {
    return (
      <div className={cn("flex flex-col items-start gap-2", className)}>
        <p role="status" aria-live="polite" className="text-[13px] text-muted">
          {status || "Finishing connection…"}
        </p>
      </div>
    );
  }

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
