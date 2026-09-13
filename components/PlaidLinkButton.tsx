"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlaidLink, type PlaidLinkOnSuccess } from "react-plaid-link";

/**
 * Minimal end-to-end Plaid Link flow: fetch a link token, open Plaid Link,
 * exchange the resulting public token, then trigger one sync through the
 * provider-neutral /api/source/sync route. Exists to exercise the connector
 * manually - swap for the real onboarding UI once that flow is designed.
 */
export const PlaidLinkButton = () => {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    fetch("/api/plaid/create-link-token", { method: "POST" })
      .then((res) => res.json())
      .then((data) => setLinkToken(data.linkToken ?? null))
      .catch(() => setStatus("Failed to load Plaid Link."));
  }, []);

  const onSuccess: PlaidLinkOnSuccess = useCallback(async (publicToken, metadata) => {
      setStatus("Linking account...");

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
        setStatus(`Failed to link: ${exchangeData.error}`);
        return;
      }

      setStatus("Syncing transactions...");
      const syncRes = await fetch("/api/source/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId: exchangeData.connectionId }),
      });
      const syncData = await syncRes.json();

      setStatus(
        syncRes.ok
          ? `Synced ${syncData.counts.accounts} accounts, ${syncData.counts.entries} entries.`
          : `Failed to sync: ${syncData.error}`
      );
    },
    []
  );

  const { open, ready } = usePlaidLink({
    token: linkToken ?? "",
    onSuccess,
  });

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => open()}
        disabled={!ready || !linkToken}
        className="rounded-full bg-foreground px-5 py-3 text-background disabled:opacity-50"
      >
        Connect a bank account
      </button>
      {status && <p className="text-sm text-zinc-600 dark:text-zinc-400">{status}</p>}
    </div>
  );
};
