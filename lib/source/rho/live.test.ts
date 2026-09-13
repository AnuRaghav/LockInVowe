import { describe, expect, it } from "vitest";

import { createRhoAdapter } from "@/lib/source/rho/adapter";
import type { SourceSyncPage } from "@/lib/source/types";

/**
 * Live smoke test against Rho's sandbox.
 *
 * Opt-in, because the rest of the suite must stay hermetic:
 *
 *   RHO_LIVE_SMOKE=1 npm test
 *
 * Worth keeping in the repo rather than running once and deleting: it is the
 * only check that the hand-written client in `client.ts` still matches the
 * shape Rho actually serves. The sandbox accepts any non-empty bearer token, so
 * no credential is needed.
 */
const enabled = Boolean(process.env.RHO_LIVE_SMOKE);

describe.skipIf(!enabled)("Rho sandbox (live)", () => {
  it("pulls real accounts and entries through the neutral adapter", async () => {
    const pages: SourceSyncPage[] = [];

    for await (const page of createRhoAdapter().pull({
      connection: {
        id: "conn_live",
        companyId: "company_live",
        provider: "rho",
        providerConnectionId: "rho_live",
        credentials: { api_token: "rhobat_smoke_test", environment: "sandbox" },
        syncState: {},
      },
      now: new Date(),
    })) {
      pages.push(page);
    }

    const accounts = pages.flatMap((page) => page.accounts ?? []);
    const entries = pages.flatMap((page) => page.entries ?? []);

    expect(accounts.length).toBeGreaterThan(0);
    expect(entries.length).toBeGreaterThan(0);
    // The invariant that matters downstream: every amount is an exact integer
    // count of minor units, whatever Rho sent.
    expect(entries.every((entry) => Number.isSafeInteger(entry.amountMinor))).toBe(true);
    // And Rho's movement link survives normalization.
    expect(entries.every((entry) => entry.movementKey)).toBe(true);
  }, 60_000);
});
