"use client";

import { useEffect, useState } from "react";

/**
 * Manual test control for the Gusto connector. "Connect" starts the OAuth
 * redirect; "Sync" pulls employees + processed payrolls for whichever
 * connection this company most recently linked.
 */
export const GustoConnectButton = () => {
  const [status, setStatus] = useState("");
  const [syncing, setSyncing] = useState(false);

  // The OAuth callback (app/api/gusto/callback) redirects back here with
  // ?gustoLinked=1 or ?gustoError=<message> - surface whichever landed,
  // since a failed callback otherwise fails silently from the user's POV.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("gustoError");
    const syncError = params.get("gustoSyncError");
    const linked = params.get("gustoLinked");
    if (!error && !linked) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the OAuth return params
    setStatus(
      error
        ? `Connect failed: ${error}`
        : syncError
          ? `Connected, but the first sync failed: ${syncError}`
          : `Connected. Synced ${params.get("gustoEmployees") ?? "0"} employees, ${params.get("gustoPayrolls") ?? "0"} payroll runs.`
    );

    const url = new URL(window.location.href);
    ["gustoError", "gustoSyncError", "gustoLinked", "gustoEmployees", "gustoPayrolls"].forEach((key) =>
      url.searchParams.delete(key)
    );
    window.history.replaceState({}, "", url.toString());
  }, []);

  const sync = async () => {
    setSyncing(true);
    setStatus("Syncing payroll...");

    try {
      const res = await fetch("/api/gusto/sync", { method: "POST" });
      const data = await res.json();

      setStatus(
        res.ok
          ? `Synced ${data.employeesSynced} employees, ${data.payrollRunsSynced} payroll runs.`
          : `Failed to sync: ${data.error}`
      );
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <a
        href="/api/gusto/authorize?returnTo=/connect"
        className="rounded-full bg-foreground px-5 py-3 text-background"
      >
        Connect Gusto
      </a>
      <button
        type="button"
        onClick={sync}
        disabled={syncing}
        className="text-sm underline text-muted disabled:opacity-50"
      >
        Sync payroll
      </button>
      {status && <p className="text-sm text-muted">{status}</p>}
    </div>
  );
};
