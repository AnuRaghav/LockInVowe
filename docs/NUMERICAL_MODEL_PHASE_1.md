# Numerical Model — Phase 1

## Boundary

`lib/finance/source-reader.ts` exposes the internal server function
`loadReconciledFinancialState(companyId, { now, staleAfterMs })`.
Company scope must come from trusted authorization context. There is no new route,
Sam tool, Server Action, financial table, provider call, or write to Source data.

`lib/finance/reconciliation.ts` is the pure deterministic implementation. Its input
is the **complete current** company-scoped Tier 1 population, including tombstones,
non-posted entries, balance observations, connection health and sync runs. It is
not a date-range input or an historical as-of reconstruction. `now` evaluates
freshness; it does not rewind Tier 1. The output is versioned `phase1-v1`.

The reader paginates all tables with stable ordering, including when a server cap
returns fewer rows than requested. It checks sync runs and connection metadata
before/after reading and rejects running or concurrently changed syncs. This
fences the existing SourceStore writers, which start a run before persistence;
it is not a transaction against arbitrary out-of-band database writes. Failed
runs can have persisted partial observations; those observations are retained
with failure health and provenance rather than represented as a successful sync.

## Output

- `activities`: posted, live financial effects grouped only by exact Rho movement
  key scoped to its connection; otherwise one unresolved activity per entry.
- `pending`: live, unsuperseded pending observations, outside finalized effects.
- `excluded`: withdrawn, superseded pending, failed and scheduled records, with
  exclusion reason and replacement references.
- `accounts`: Source account scope, cash eligibility, all balance evidence,
  first observed activity date and unknown history completeness.
- `health`: explicit freshness threshold and evaluation time, last successful
  connection sync, connection status/errors, run history, coverage and caveats.

Each effect keeps its own date and exact Source entry (row ID, provider identity,
raw-record ID, last-seen sync and observation time). Account and balance evidence
is likewise retained. Rho grouping does not choose an arbitrary shared posting
date: legs may cross period boundaries. Reconcile first, filter effects by date
later. IDs are stable within a current grouping, not a persistent event registry.
Earlier calculated results must retain their evidence if historical replay is
needed; this phase does not persist derived snapshots.

## Rules and signs

Only checking and savings are eligible cash. Credit, investment, rewards and other
are not. The repo now includes Stripe; its synthetic `other` balance accounts are
preserved but never promoted to operating cash or matched to bank payouts.

Money remains integer minor units in each currency. Unsafe source integers or
aggregate results throw rather than round. BigInt intermediates make group sums
exact; public values remain safe integer numbers, compatible with Source/JSON.
Currencies are never combined. Source currency defaulting remains a disclosed
upstream limitation, not something reconciliation repairs or verifies.

Rho internal proof requires multiple observed accounts, one currency, opposite
signs, a zero sum, matching account currency, and all observed linked records
posted/live. Missing/unbalanced, cross-currency and mixed-lifecycle groups stay
unresolved. Equal and opposite Plaid amounts, descriptions, categories and dates
are never used to match transfers. There is no cross-connection deduplication.

Plaid posted successors retire pending predecessors by the provider's exact link,
including when a successor is later withdrawn. The pending record is not revived.
Conflicting successors are flagged rather than choosing one by amount or date.
Rho lifecycle updates already have one current Tier 1 identity.

- `cashMinor`: signed change in eligible cash accounts.
- `creditPositionMinor`: signed credit position change (positive reduces debt).
- `liabilityMinor`: the opposite sign (positive increases debt), under Source's
  convention; not an accounting valuation or a clamp at zero.
- `spendMinor`: zero for proven internal movements; otherwise **null**, not zero.
  Neither a negative card entry nor a provider personal-finance category by itself
  proves a purchase rather than fees, adjustments or other activity. This version
  introduces no purchase/operating classification allowlist.

**A checking-to-credit repayment reduces eligible cash and reduces liability;
it does not create new spend.** Zero sum across account legs is not zero cash
when one leg is credit. Only cash-to-cash transfers necessarily have zero net
eligible cash effect. Do not blanket-filter every `internal` movement when
explaining observed cash change.

## Unknowns and Phase 2 contract

No activity is labelled external merely because no internal link was found.
`relationship: unresolved` preserves the uncertainty; operating meaning and
spend remain unknown. Unresolved reason codes accompany exact effect amounts so
Phase 2 can quantify uncertainty by currency/period without cancellation masking
its gross size. No materiality threshold is invented here.

Coverage and history continuity remain unknown. First observed activity is not a
promise of complete history. Multiple connections flag possible duplicate-account
coverage; no records are suppressed on that suspicion. Rho's 180-day initial
history, 14-day lifecycle reread limitation and unverified credit-balance sign
remain disclosed. Balance `observed_at` is value-change evidence, not last-check
freshness; connection and account observations are separately retained. Missing
balances are an empty evidence list, never a fabricated zero.

Phase 2 can derive scoped observed cash and separate credit positions from balance
evidence, realized per-account and per-currency cash movement, proven internal
transfer/repayment effects, and unresolved activity magnitudes. It must propagate
health, source limitations and duplicate risk. Definitive external flow totals
and operating burn still require enough relationship/classification evidence;
this boundary deliberately does not manufacture it. No burn, runway, forecast,
semantic memory or Sam integration was added. Existing legacy runway code is
unchanged and is not wired to this layer.

## Verification

Unit tests exercise actual Plaid/Rho mapper outputs projected into SourceStore's
Tier 1 shape. The opt-in integration test runs real Rho mapping -> SourceStore ->
local Postgres -> paginated reader -> reconciliation, including lifecycle updates,
idempotency, balance-value dedupe, raw-record traces, running-sync rejection,
partial failed syncs and company isolation. It does not need provider credentials.

```sh
npm test
# With local Supabase running:
eval "$(npx supabase status -o env)"
SUPABASE_INTEGRATION=1 NEXT_PUBLIC_SUPABASE_URL="$API_URL" \
  SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
  npx vitest run lib/finance/reconciliation.integration.test.ts
npm run typecheck
npm run lint
npm run build
```
