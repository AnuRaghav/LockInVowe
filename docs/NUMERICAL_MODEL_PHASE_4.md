# Numerical Model — Phase 4: conditional cash forecasting and scenarios

## Boundary

`lib/finance/forecast.ts` is a pure deterministic layer over Phase 2 financial
actuals. It does not read Source rows, semantic memory, provider APIs, or an LLM.
It receives `FinancialActuals` plus explicit future assumptions and always takes
starting cash from the selected currency's observed eligible-cash position.
There is no starting-cash argument on Sam's tools.

The actuals and reconciliation pipeline is unchanged:

```
Source -> reconciliation -> financial actuals -> forecast/scenario engine
                                      ^                    ^
                               observed position     explicit assumptions
```

Semantic state remains separate. Sam retrieves a plan or constraint, translates
its financial consequence into an explicit basis-labelled event or recurring
delta, and passes that to the engine. The engine never reads semantic state.

## Representation

A forecast request selects one currency, a future start date, a horizon, and
weekly or monthly buckets. It contains:

- a baseline: `explicit_periodic`, `none`, or a requested but currently
  unavailable `historical_recorded_average`;
- one-time events on exact dates;
- recurring deltas with start, optional end-exclusive date, and weekly/monthly
  cadence;
- narrative assumptions;
- optional cash-reserve and runway-month thresholds.

Every future monetary input has a basis kind, label, and optional reference.
Basis kinds distinguish management assumptions, scenario overrides, historical
analysis, provider-scheduled activity, and future authoritative connectors.
Business concepts are not encoded in the engine. A hiring plan becomes an
outflow increase; a cloud-cost reduction becomes an outflow decrease.

Each trajectory row retains opening cash, baseline inflows/outflows, signed
inflow/outflow deltas, reductions, incremental cash impact, net change, ending
cash, and references to the assumptions applied in that bucket. Money remains
safe integer minor units. Currencies are never combined and there is no FX.
Calendar months are real calendar intervals; weeks are seven-day intervals.

## Baselines and qualifications

An `explicit_periodic` baseline is a conditional management/scenario input, not
an actual. Phase 2 currently cannot establish complete history or operating
classification, so `historical_recorded_average` is deliberately returned as
unavailable rather than promoting recorded bank movement into a future run rate.
`none` permits a known-deltas-only trajectory, loudly qualified as omitting
unmodeled baseline activity.

A missing observed cash position withholds the trajectory. Stale, incomplete,
duplicate-risk, and account-scope qualifications from starting cash propagate to
the result. A successful forecast remains `conditional`, never `observed`.

Derived consequences all use the same trajectory: ending and minimum cash,
period-end zero/reserve crossings, modeled runway to zero, runway-threshold
crossing, and cumulative incremental cash impact. Crossing dates have bucket-end
resolution. A crossing beyond the configured horizon remains unavailable or
`not_crossed_within_horizon`; it is not extrapolated.

## Sam tools

- `forecast_cash`: returns one conditional trajectory, paged without changing
  complete-horizon derived totals.
- `simulate_financial_scenario`: applies one named set of deltas to a shared
  baseline and returns baseline/scenario consequences and exact differences.
- `compare_financial_scenarios`: compares 1–8 arbitrary named scenarios without
  returning large trajectories; Sam can call `forecast_cash` to inspect one.

They are deterministic `calculation` tools under the existing run/tool budgets,
timeouts, retries, repeat protection, sanitized observability, trusted company
scope, and streaming harness. Existing actuals tools remain unchanged.

No bespoke `simulate_hire`, `simulate_spend_change`, `forecast_headcount_cost`,
`forecast_runway_threshold`, `estimate_fundraising_start_date`, `forecast_burn`,
or `forecast_revenue` tools were added. They would either duplicate the generic
cash-delta primitive or imply an authoritative driver the current connectors do
not provide.

## Limits

The model does not establish revenue, MRR/ARR, churn, expansion, payroll,
contracts, AP/AR, gross margin, CAC/LTV, or headcount cost. Those can only be
modeled as explicit conditional cash assumptions until an authoritative
connector supplies them. Forecast runway is modeled time to zero under the
stated trajectory; it is distinct from Phase 2's unavailable historical
operating-burn runway.
