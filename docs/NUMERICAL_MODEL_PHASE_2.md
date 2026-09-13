# Numerical Model — Phase 2: financial actuals

## Entry points and boundary

`lib/finance/actuals.ts` consumes `ReconciledFinancialState`, never raw provider
responses, LLM-supplied financial inputs or semantic assumptions:

```ts
const reconciled = await loadReconciledFinancialState(companyId, {
  now: new Date(), staleAfterMs: 24 * 60 * 60 * 1000,
});
const actuals = deriveFinancialActuals(reconciled); // default: 3 full calendar months
const period = analyzeCashPeriod(reconciled, "USD", {
  start: "2026-06-01", endExclusive: "2026-09-01",
});
const comparison = compareCashPeriods(reconciled, "USD", currentPeriod, priorPeriod);
```

The existing reader remains the trusted server/company boundary. Reuse one
reconciled snapshot for multiple analyses so scope and evaluation time agree.
No tables, migrations, cache, route, tool or UI were added. Calculations are pure
and on demand; current volumes do not warrant materialization. Preserve returned
results/evidence if immutable historical reporting is later needed. Tier 1 is a
current projection, so reevaluating after source corrections can change history.
The output is versioned `phase2-v1` and names its Phase 1 version.

## Definitions

### Position

**Observed cash** is the sum of the latest `current_minor` balance per Phase 1
eligible checking/savings account, within one currency. It is not available
funds, all company cash, or cash minus credit debt. Each currency is independent.
The account list is explicit, including missing accounts. If any eligible account
lacks a usable balance, the scoped total is unavailable; the known observed
subtotal and missing-account IDs remain separate. Empty scope is not zero cash.

**Credit position** is the sum of latest signed credit balances, separate from
cash. Negative means value owed under Source conventions; positive is a credit
position, not additional cash. Rho's unverified balance-sign convention is
explicitly qualified. Investments, rewards and other accounts (including Stripe
balances) do not become cash.

Select latest observations by timestamp, not ID/input order. Conflicting values
at the same latest instant make the account unavailable; identical ties count
once but retain all evidence. A newer currency mismatch does not fall back to an
older convenient balance. Future observations beyond the snapshot's evaluation
time are not selected. Results expose mixed observation/check times, never a
fabricated common balance-as-of instant. Value-deduped old balance rows can still
be the last checked value at a recent sync.

### Recorded cash behavior

Periods are **half-open UTC days**, `[start, endExclusive)`, ending no later than
the snapshot evaluation date (completed days only). Default windows are last
full calendar month, trailing three full months and the preceding three full
months. Current partial months are not annualized. Other trailing windows of
1–120 months can be requested.

**Recorded cash inflows/outflows** sum positive/absolute negative reconciled cash
effects by each leg's own date. **Net recorded cash movement** is their difference.
This includes internal, unresolved, financing-like and repayment cash effects;
it is **not** labelled externally driven cash change, operating cash flow, or
balance-to-balance actual cash change.

The recorded population partitions into:

- proven cash-to-cash transfers;
- proven internal movements involving non-cash accounts (including repayments);
- unresolved internal/external relationships.

Unresolved inflows and outflows remain separate, plus their gross sum. Equal and
opposite uncertain entries cannot cancel away uncertainty. No materiality cutoff
silently discards small items. Pending/excluded Source records remain outside
actuals, with exclusion references retained.

**External cash movement** requires deterministic external relationship evidence.
Phase 1's actual type currently has only `internal | unresolved`. Therefore any
unresolved nonzero cash activity makes external totals unavailable. If all
recorded cash activity is proven internal, external totals are qualified zero
for that recorded population — not proof of zero external activity across a
complete period. Internal repayments still reduce observed cash even when their
external bucket is zero. No new classification rules were introduced in Phase 2.

**Recorded cash consumption** is cash-account debits excluding only proven
cash-to-cash transfers. It includes repayments and may include unresolved
transfers, financing repayments, capital purchases and other non-operating
activity. It is explicitly **not gross external consumption or operating burn**.
Its monthly mean divides the recorded trailing-window total by the exact number
of full calendar months. The ratio is represented as integer numerator and
denominator, without rounding money to fractional minor units. Unknown history
means this is a recorded-data mean, not a defensible complete historical run rate;
zero rows do not establish zero business consumption.

### Burn, comparisons and runway

**Gross operating burn** requires deterministically identified operating cash
outflows. **Net operating burn** additionally subtracts deterministically
identified operating inflows. Phase 1 has no operating classifications. These
results explicitly return unavailable, identified operating portions of zero
(no identified records, not zero operating activity), and the unclassified cash
portion. A repayment's zero new spend does not determine the operating nature
of its cash flow. No deposit is assumed to be revenue or financing.

Cash comparisons return current minus prior recorded totals and an exact
relative-change ratio `(current - prior) / abs(prior)`. Zero prior totals yield
no relative change, not infinity. Arbitrary requested windows expose their
lengths and compare totals, not normalized rates. Default trailing/prior windows
contain equal numbers of full calendar months. Unresolved amounts are retained
for each window and differences are flagged. Operating-burn trend is unavailable
until comparable operating burn exists.

**Simple historical runway** has the intended definition:

`eligible observed cash / defensible trailing monthly net operating burn`.

It is unavailable under the current Phase 1 contract: no operating classification
evidence and no established continuous history exist. Cash position failures,
staleness and possible duplicate coverage add explicit reasons. No caller can
supply a convenient denominator or LLM interpretation to bypass this restriction.
Recorded net cash decline and gross account debits are not silently substituted
for burn. In particular, a financing inflow cannot manufacture cash-flow-positive
status or infinite runway. The response includes cash basis, burn window, account
scope, exclusions, intended historical-continuation assumption and omitted future
commitments/plans/fundraising. There is deliberately no dormant fictional
classification pathway just to demonstrate a numeric runway result. A later
source-backed operating/history contract is needed before that result can become
available. The legacy `runway.ts` conversational calculator remains separate and
unchanged; it is not invoked here.

## Qualification and traceability

Results are practical bundles rather than naked scalars. Each position or period
analysis carries currency, method, observed/derived nature, evaluation time,
period where relevant, account scope, coverage, source freshness/errors/run
history, provider limitations and issues. Monthly means, comparisons and runway
reference their included basis bundles. Snapshot-wide health is also retained.

Position evidence names exact balance rows, values, raw records and syncs. Flow
buckets name contributing entry/activity IDs; evidence carries amount/date,
provider identity, raw revision ID and sync ID. Reconciliation evidence also
retains **all linked legs**, including credit legs or dates outside the requested
window that justify an exclusion. This makes an internal-transfer exclusion
traceable, not merely a computed label.

Stale or partially failed syncs do not erase recorded observations: values remain
qualified with their health. Missing cash balances withhold the full position.
Known integrity problems (conflicting supersession, account-currency mismatch,
cross-currency grouping) withhold trustworthy flow/consumption totals while
retaining explicitly labelled recorded-row audit subtotals. Those subtotals are
not safe economic totals. Duplicate-coverage risk remains a caveat, never a fuzzy
deduplication rule. All amounts and sums are checked safe integers with BigInt
intermediates; unsafe results throw. No FX, dollars-as-floats or rounded financial
state is introduced.

## Founder questions now answerable

- What cash and credit positions can we observe, in each currency and account set?
- What posted cash effects are recorded for a period, and which are proven internal?
- How much recorded cash left excluding known cash transfers, including repayments?
- How do recorded totals compare across periods, and how much remains unresolved?
- Why can't the available data establish external flows, operating burn or runway?

Not implemented: accounting revenue, actual historical balance-to-balance cash
change, operating/financing classification, normalized burn, recurring/vendor
inference, forecasts/scenarios, recommendations, Semantic Model, Context Builder,
Sam tools, UI or a persistence/caching service.

## Tests

`actuals.test.ts` drives real Rho mapper output through Tier 1-shaped rows and
Phase 1 before derivation. Coverage includes balances/scope/currencies, credit
repayments, transfer legs across window boundaries, lifecycle exclusions,
financing ambiguity, gross unresolved exposure, exact monthly means, zero
baselines, calendar boundaries, missing/conflicting observations, stale/failed
sources, overflow, provenance and unavailable burn/runway. The existing local
Postgres integration test now also checks persisted Source -> Phase 1 -> actuals.
