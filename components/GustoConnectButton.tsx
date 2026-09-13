"use client";

import { useState } from "react";

/**
 * Manual test control for the Gusto connector. "Connect" starts the OAuth
 * redirect; "Sync" pulls employees + processed payrolls for whichever
 * connection this company most recently linked.
 */
export const GustoConnectButton = () => {
  const [status, setStatus] = useState("");
  const [syncing, setSyncing] = useState(false);

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
        href="/api/gusto/authorize"
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
