# Deterministic operating plans

Import the public API from `@/lib/finance/planning`. These functions run locally,
without an LLM, network calls, database writes, or tool registration. Existing
agent tools continue to use the existing financial engine. This module is the
calculation layer to validate before a separate agent integration.

## What existed and what was added

The existing `../forecast.ts` already provides observed-cash forecasts, cash
reserve crossings, runway thresholds, additive cash scenarios, and comparisons.
The planning module compiles revenue, collections, staffing, expenses, and
financing into that engine; it does not replace connected cash with user inputs.
The old `../runway.ts` remains an onboarding estimate, not authoritative cash.

| Requested capability | Planning API |
| --- | --- |
| `forecast_cash` | `forecastCash(actuals, plan)` |
| `calculate_runway` | `calculateRunway(forecast.cash, minimumCashMinor?)` |
| `forecast_burn` | `forecastBurn(forecast)` |
| `forecast_revenue` | `forecastRevenue(window, revenuePlan)` |
| `forecast_headcount_cost` | `forecastHeadcountCost(window, employees)` |
| `simulate_hire` | `simulateHire(actuals, plan, options)` |
| `simulate_spend_change` | `simulateSpendChange(actuals, plan, options)` |
| `compare_scenarios` | `compareScenarios(actuals, base, namedPlans)` |
| `forecast_runway_threshold` | `forecastRunwayThreshold(forecast.cash, months, minimumCashMinor?)` |
| `estimate_fundraising_start_date` | `estimateFundraisingStartDate(forecast.cash, options)` |
| MRR, ARR, MRR growth, new/expansion/churned MRR, NRR, GRR | `calculateSaasMetrics(monthlyInputs)`; also in revenue rows |
| Gross margin, CAC, LTV, CAC payback, burn multiple, revenue per employee | `calculateSaasMetrics(monthlyInputs)` |
| Cash conversion / collections | `calculateSaasMetrics(monthlyInputs)` and the revenue collection schedule |
| `can_afford_hire`, `can_afford_spend` | `canAffordHire`, `canAffordSpend` with an explicit reserve/runway policy |
| `delay_hiring`, `increase_marketing` | `delayHiring`, `increaseMarketing` |
| `revenue_miss`, `churn_increase`, `customer_loss` | `revenueMiss`, `churnIncrease`, `customerLoss` |
| `raise_round`, `change_raise_timing` | `raiseRound`, `changeRaiseTiming` |
| `reduce_burn`, `reach_profitability` | `reduceBurn`, `reachProfitability` |

## Input and output contract

- Monetary amounts are safe integer minor units in a single explicit currency.
  Multiplication uses exact integer intermediates and rounds half away from zero.
  Overflow throws. Rates are integer basis points: `1000` means 10%.
- Plans begin on a calendar month's first day and span 1–120 months. Month indices
  in driver changes are zero-based. Dates are validated UTC `YYYY-MM-DD` strings.
- An `OperatingPlan` contains a labeled `ForecastBasis`. Connected starting cash
  is supplied by `FinancialActuals` from the existing financial session, never a
  scalar in the plan. No foreign exchange conversion is performed.
- All future operating inputs are explicit assumptions, including empty arrays
  and zero values. Supply existing employees and all non-payroll expenses;
  omit nothing implicitly. COGS, employee costs, other operating expenses, and
  one-time costs are separate, non-overlapping buckets.
- Missing observed cash withholds the cash trajectory and affordability answer.
  Conditional revenue/cost projections can still be computed. Their availability
  does not establish that observed starting cash is available or complete.
- Cash results retain the existing engine's source quality, qualifications, and
  account coverage. Activity between the observation date and a later plan start
  is not modeled; this is explicitly qualified in the result.
- Monthly metrics take separately supplied inputs. Missing data and non-positive
  denominators return `unavailable` with a reason, not fabricated zeros or Infinity.
  Ratios use fractions (`0.8` means 80%); unit-economics money is rounded to minor
  units for output. Customer churn is separate from revenue churn.

## Modeling choices

Revenue: opening MRR loses churn and contraction, retained MRR expands, then new
sales are added. `newSalesGrowthBps` compounds the **new-sales** assumption rather
than adding another growth factor to total MRR. Driver changes persist until
overridden. Changes are assumed effective at the beginning of the month, so
ending MRR is also the month's modeled subscription revenue; ARR is its annual
run rate, not recognized annual revenue. New customer MRR is excluded from NRR.

Collections: a supplied fraction of revenue is collected after a fixed number of
calendar months. Pre-plan receivable collections require a complete monthly
array (explicit zeros if none). Uncollectible revenue and collectible amounts
still pending beyond the horizon are reported separately. This MVP does not
model annual prepayments, usage billing, inventory, or a full cash conversion
cycle. The cash-conversion metric is customer collections divided by revenue.

Headcount: annual salary is divided by twelve; salary, fixed monthly commissions,
and benefits are prorated by calendar days employed. Employer payroll tax applies
to salary plus commissions; benefits are modeled untaxed. This is a supplied
planning rate, not jurisdiction-specific payroll tax calculation. Start dates
are inclusive and end dates exclusive. Operating expenses use the same day
proration and are assumed paid in the month incurred.

Burn: gross burn includes payroll, COGS, operating expenses and operating one-time
costs. Net burn subtracts **collections**, not MRR. Capital spending, fundraising
proceeds, and fundraising fees affect cash but are excluded from operating burn.

Runway: the first boundary at or below the selected cash floor determines runway.
Elapsed months use the existing engine's average Gregorian month convention.
No crossing gives `beyond_horizon`, not infinite runway. Future 12/9/6-month
threshold dates are unavailable unless the eventual cash-floor crossing is in
the modeled horizon. Estimates use period boundaries and can miss intra-month
cash shortages, even when a dated raise and a cost occur in the same month.

Fundraising: use a forecast **before adding the proposed round**. The target
close is the cash-floor date minus desired pre-raise runway at close; the latest
start subtracts the fundraising duration. Past deadlines are flagged and the
recommended start is clamped to the forecast start. This does not predict a
financing outcome or select fundraising duration for the founder.

Scenarios: base/bear/bull plans share observed cash, currency, dates and horizon.
Helpers return the base, the scenario, monthly changes and runway consequences;
they do not mutate the original plan. Hires and marketing have no assumed revenue
benefit unless a replacement revenue plan is explicitly supplied. Spend changes
target a known expense; new categories and one-time spending can be supplied in
a named comparison plan. Revenue misses reduce new sales, customer loss removes
MRR once, and burn reduction changes only selected non-payroll expense lines.

Affordability: the entire modeled trajectory must stay strictly above the cash
floor. The horizon must extend at least the requested runway after the spend
effective date or latest proposed hire start. A short horizon produces
`unavailable`; a positive ending balance cannot hide an earlier cash breach.
An `affordable_within_horizon` result is conditional on the full supplied plan,
including any assumed financing.

Profitability: `reachProfitability` finds the first specified run of non-negative
monthly **operating profit**, defaulting to three months. It does not solve for a
required growth/cost-cutting target. Profit excludes financing, capital purchases,
depreciation, interest, and income tax. It is neither GAAP net income nor a promise
of sustained profitability beyond the modeled window.

Metrics: LTV is the constant-churn, gross-profit-adjusted estimate; CAC uses
fully loaded acquisition spend and new customers for a matching cohort/period.
Payback uses monthly gross profit per customer. Burn multiple divides monthly
net operating burn by the net new ARR generated in that same month; cash-positive
operations are shown as zero burn, and zero/negative ARR growth is unavailable.

Definition references: [Stripe MRR and subscription analytics](https://docs.stripe.com/billing/subscriptions/analytics),
[ChartMogul gross-margin-adjusted LTV](https://chartmogul.com/saas-metrics/ltv/), and
[Craft Ventures burn multiple](https://www.craftventures.com/articles/the-burn-multiple).

## Example

```ts
import {
  forecastCash, forecastBurn, calculateRunway, estimateFundraisingStartDate,
  canAffordHire, calculateSaasMetrics, type OperatingPlan,
} from "@/lib/finance/planning";

// actuals comes from (await financialSession.read()).actuals.
// plan is an explicit OperatingPlan validated from management assumptions.
function evaluate(actuals: Parameters<typeof forecastCash>[0], plan: OperatingPlan) {
  const forecast = forecastCash(actuals, plan);
  const month = forecast.rows[0];
  return {
    forecast,
    burn: forecastBurn(forecast),
    runway: calculateRunway(forecast.cash),
    fundraising: estimateFundraisingStartDate(forecast.cash, {
      desiredRunwayAtCloseMonths: 6, fundraisingDurationMonths: 6,
    }),
    metrics: calculateSaasMetrics({
      currency: plan.currency, month: month.start, basis: plan.basis,
      ...month.revenue, costOfRevenueMinor: month.costOfRevenueMinor,
      netOperatingBurnMinor: month.netBurnMinor,
      averageEmployees: month.payroll.averageHeadcount,
      // CAC and LTV remain unavailable until their additional inputs are supplied.
    }),
    hire: canAffordHire(actuals, plan, {
      basis: { kind: "scenario_override", label: "Proposed engineer" },
      hires: [{ id: "new-engineer", startDate: plan.startDate,
        annualSalaryMinor: 12_000_000, payrollTaxBps: 1000,
        monthlyBenefitsMinor: 100_000, monthlyCommissionMinor: 0 }],
      policy: { minimumCashMinor: 10_000_000, minimumRunwayMonths: 12 },
    }),
  };
}
```

Validation: `npx vitest run lib/finance/planning`, plus existing finance and
agent financial-tool regression tests. No external accounts are needed.
