"use client";

import { useState } from "react";

/**
 * Manual test control for the Stripe connector. Unlike Plaid (Link handshake)
 * and Gusto (OAuth redirect), linking Stripe here has no user-facing flow: the
 * MVP runs one Stripe sandbox account (see lib/source/stripe/client.ts), so
 * "Connect" just registers that account against this company. "Sync" then
 * pulls its balance + balance transactions through the provider-neutral
 * /api/source/sync route.
 */
export const StripeConnectButton = () => {
  const [status, setStatus] = useState("");
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    setBusy(true);
    setStatus("Connecting…");

    try {
      const res = await fetch("/api/source/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "stripe" }),
      });
      const data = await res.json();

      if (!res.ok) {
        setStatus(`Couldn't link Stripe: ${data.error}`);
        return;
      }

      setConnectionId(data.connection.id);
      setStatus(`Linked ${data.connection.display_name}. Syncing…`);

      const syncRes = await fetch("/api/source/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId: data.connection.id }),
      });
      const syncData = await syncRes.json();

      setStatus(
        syncRes.ok
          ? `Synced ${syncData.counts.accounts} accounts, ${syncData.counts.entries} entries.`
          : `Failed to sync: ${syncData.error}`
      );
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    if (!connectionId) return;
    setBusy(true);
    setStatus("Syncing…");

    try {
      const res = await fetch("/api/source/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId }),
      });
      const data = await res.json();

      setStatus(
        res.ok
          ? `Synced ${data.counts.accounts} accounts, ${data.counts.entries} entries.`
          : `Failed to sync: ${data.error}`
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={connect}
        disabled={busy}
        className="rounded-full bg-foreground px-5 py-3 text-background disabled:opacity-50"
      >
        {connectionId ? "Re-link Stripe" : "Connect Stripe (Sandbox)"}
      </button>
      {connectionId && (
        <button
          type="button"
          onClick={sync}
          disabled={busy}
          className="text-sm underline text-muted disabled:opacity-50"
        >
          Sync transactions
        </button>
      )}
      {status && <p className="text-sm text-muted">{status}</p>}
    </div>
  );
};
