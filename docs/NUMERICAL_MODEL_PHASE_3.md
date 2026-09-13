# Numerical Model — Phase 3: Sam integration

## Product path

```
/api/chat -> trusted company context -> prepareSamRun
  -> run-local FinancialSession
    -> loadReconciledFinancialState (paginated, sync-fenced Source reader)
    -> reconcileFinancialActivity (Phase 1)
    -> deriveFinancialActuals (Phase 2)
  -> Context Builder -> compact numerical snapshot -> Sam system prompt
  -> financial tools -> same successful snapshot -> structured tool results -> Sam
```

`runSamAgent`, `runSamAgentStructured` and `streamSamAgent` still share the existing
execution harness. The context schema adds a trusted financial capability, not
model-selected company identity or financial values. Tool schemas accept only
currency, calendar windows, and evidence pagination. Injected capabilities and
loaded snapshots are checked against the trusted company scope.

`lib/finance/session.ts` holds one successful read per run; concurrent baseline
and tool requests share it. It is not a global cache. A later run reads fresh
Source state. Failed reads are not cached as truth and can be retried by a later
tool call. Default source loading is bounded at five seconds and aborts pending
PostgREST requests on timeout; errors sent to the model are sanitized. The stale
threshold is explicitly 24 hours, not a provider freshness guarantee.

Low-level `createSamAgent` factories still require their caller to assemble
context if used directly. The application and public run/stream entry points use
`prepareSamRun`. Direct tool calls without a run session use the same trusted
loader but do not promise reuse across independent invocations.

## Automatic numerical brief

The Context Builder receives a structured `numerical` sibling, separate from the
semantic brief, relevant memories and thread notes. `prompt.ts` is the only place
it becomes prompt text. It includes:

- evaluation time, observed account coverage and duplicate risk;
- connected/unhealthy source counts;
- observed cash and signed credit positions, cash account/missing balance counts;
- cash freshness, including accounts not recently observed;
- last full month's recorded cash inflows/outflows/net and gross unresolved cash;
- external-flow, operating-burn and runway availability/reasons;
- provider/history/currency and projection limitations.

The baseline shows at most two currencies, reports how many were omitted, and
points to runtime discovery for the rest. It contains no raw payloads, merchant
strings, ledger dump, complete sync log, or balance evidence array. Money is
formatted deterministically from integer minor units, including zero- and
three-decimal currencies. Sam uses supplied display strings, not its own currency
conversion/arithmetic.

Missing numerical infrastructure/read failures are explicit `unavailable`, not
zero cash and not fallback founder values. No eligible accounts is a distinct
state. Load failures mark the harness context degraded while semantic context can
remain available. Conversely, a semantic/context-provider failure does not erase
independently available numerical state. Missing custom-builder numerical context
is filled during run preparation.

## Runtime financial tools

All five are read-only, retry-safe and governed by the existing execution,
no-progress, timeout, result-size and observability policies:

| Tool | Capability |
| --- | --- |
| `financial_position` | Cash/credit for one currency; omit currency to page through observed currencies |
| `financial_cash_flow` | Recorded effects for completed half-open UTC days; internal/unresolved breakdown and external/burn availability |
| `financial_burn_runway` | Supported burn/runway status, basis and reasons; trailing recorded cash-consumption comparison, clearly not operating burn |
| `compare_financial_periods` | Exact recorded cash-movement/consumption deltas with both windows and qualifications |
| `explain_financial_number` | Cash/credit balance evidence or cash-movement/consumption entry evidence; complete basis totals plus paged provenance |

`lib/finance/sam-surface.ts` supplies deterministic presentation projections of
Phase 2, not a second calculation engine. Ordinary tool results omit unbounded
ledger and sync-history arrays but retain method, account scope counts, currency,
time, freshness and qualifications. Full account and source references remain
reachable through evidence pages. Evidence pagination never changes totals.
Noncash or outside-period legs proving reconciliation remain in trace evidence.
The existing harness refuses oversized results rather than silently truncating
qualifications; trace callers can reduce page size. Extremely large single
movement evidence can still hit that ceiling.

The tools return the standard `{ok, data/error}` envelope. `ok:true` means the tool
executed; individual metrics may remain `qualified` or `unavailable`. Tool lifecycle
events expose only static labels, sizes, timing and the opt-in qualitative runway
availability summary — not arguments, balances or raw financial results.

## Removed authority path

`calculate_runway`, its registration, policy, export and adapter were removed.
There is no Sam tool accepting cash/revenue/expense scalars. Strict schemas reject
extra company or monetary inputs rather than quietly accepting them.

The legacy `lib/finance/runway.ts` remains solely for the pre-existing onboarding
UI estimate. It is explicitly deprecated for authoritative company runway and has
no Sam import/tool path. This phase does not migrate onboarding assumptions or do
Semantic Model work. Semantic briefs may still contain founder-stated financial
claims; Sam's prompt now explicitly treats those, memory tool results, thread
notes and earlier assistant claims as beliefs, never replacements for verified
actuals. The old blanket instruction that context is always current was removed.
Client chat `system`/`tool` messages cannot impersonate server numerical context.

## Founder experience and honest limits

- **How much cash?** Answer from the snapshot or position tool, by observed currency
  and scope, carrying missing/stale/coverage qualifications.
- **What's our runway?** Explain its actual unavailable status and missing operating
  classification/history evidence. No founder-input denominator, inferred burn,
  fake infinite runway or zero-cash date is produced.
- **Has burn worsened?** Operating-burn trend remains unavailable. Deterministic
  recorded cash-consumption comparisons are available, explicitly distinguished.
- **Why did cash fall?** Explain recorded cash effects, proven transfers/repayments,
  unresolved amounts and traceable evidence. Do not claim full historical balance
  change, vendor identity or an operating/financing cause not established by data.

Source says what happened; Numerical Model states what follows; Semantic Model
contains beliefs/plans; Sam communicates and interprets. Prompt policy preserves
these distinctions but is not a mathematical verifier of free-form model prose.
Tests prove data/scoping/context/tool delivery using a fake model, not universal
compliance by a live LLM. There is no new recommendation, forecast, scenario,
provider, UI or semantic-memory capability.

## Verification and next capability

Tests cover the actual SourceStore -> local Postgres -> Phase 1 -> Phase 2 ->
Context Builder -> Sam tool loop (only the model is scripted), plus baseline
answers without founder numbers, conflicting conversation claims, session reuse,
company isolation, unavailable/stale data, semantic-vs-financial failure isolation,
strict schemas, trace pagination, normal output budgets, multi-currency omission,
load timeouts and sanitized failures. Existing streaming/harness tests were
migrated to the connected-data tools rather than preserving the old scalar path.

The next Numerical Model capability should be an **auditable authoritative
classification and history-coverage contract**: explicit externally established
operating/non-operating relationships with provenance, plus validated account
identity/coverage and history continuity. That is what can make defensible burn
and then simple runway available. Adding forecasts or more fluent LLM transaction
classification before those facts would only conceal the current uncertainty.
