import { integer, multiply, periods, sum, type MonthlyWindow } from "./math";

export interface RevenueDrivers {
  newMrrMinor: number;
  /** Compounds new sales, not the entire MRR base; avoids double-counting expansion. */
  newSalesGrowthBps: number;
  churnBps: number;
  contractionBps: number;
  expansionBps: number;
}

export interface RevenuePlan extends RevenueDrivers {
  startingMrrMinor: number;
  /** Changes take effect at the start of a month and persist. */
  changes?: Array<{ month: number; drivers: Partial<RevenueDrivers> }>;
  /** Additional one-time MRR loss. The smaller base persists in future months. */
  customerLosses?: Array<{ month: number; mrrMinor: number }>;
  collectionRateBps: number;
  collectionLagMonths: number;
  /** Cash from pre-forecast invoices, by forecast month. Must be explicitly supplied. */
  openingReceivableCollectionsMinor: number[];
}

function validateDrivers(value: RevenueDrivers) {
  integer(value.newMrrMinor, "new MRR");
  integer(value.newSalesGrowthBps, "new sales growth", -10_000, 100_000);
  integer(value.churnBps, "churn rate", 0, 10_000);
  integer(value.contractionBps, "contraction rate", 0, 10_000);
  integer(value.expansionBps, "expansion rate", 0, 100_000);
  if (value.churnBps + value.contractionBps > 10_000) throw new Error("Churn plus contraction cannot exceed 100%");
}

export function forecastRevenue(window: MonthlyWindow, plan: RevenuePlan) {
  const timeline = periods(window);
  integer(plan.startingMrrMinor, "starting MRR"); validateDrivers(plan);
  integer(plan.collectionRateBps, "collection rate", 0, 10_000);
  integer(plan.collectionLagMonths, "collection lag", 0, 120);
  if (plan.openingReceivableCollectionsMinor.length !== window.months)
    throw new Error("Supply opening receivable collections for every forecast month (explicit zeros if none)");
  plan.openingReceivableCollectionsMinor.forEach(value => integer(value, "opening receivable collection"));
  const changed = new Set<number>();
  for (const change of plan.changes ?? []) {
    integer(change.month, "revenue change month", 0, window.months - 1);
    if (changed.has(change.month)) throw new Error("Only one revenue driver change per month");
    changed.add(change.month);
  }
  for (const loss of plan.customerLosses ?? []) {
    integer(loss.month, "customer loss month", 0, window.months - 1); integer(loss.mrrMinor, "customer MRR loss");
  }
  let openingMrrMinor = plan.startingMrrMinor;
  let drivers: RevenueDrivers = { ...plan };
  const scheduledCollections = Array<number>(window.months + plan.collectionLagMonths).fill(0);
  const rows = timeline.map(period => {
    const change = plan.changes?.find(item => item.month === period.index);
    drivers = { ...drivers, ...change?.drivers }; validateDrivers(drivers);
    const customerLossMinor = sum(...(plan.customerLosses ?? []).filter(item => item.month === period.index).map(item => item.mrrMinor));
    const rateChurnMinor = multiply(openingMrrMinor, drivers.churnBps);
    const churnedMrrMinor = sum(rateChurnMinor, customerLossMinor);
    // Allocate rounded total losses so valid rates never remove more than the base by a cent.
    const contractedMrrMinor = sum(multiply(openingMrrMinor, drivers.churnBps + drivers.contractionBps), -rateChurnMinor);
    if (sum(churnedMrrMinor, contractedMrrMinor) > openingMrrMinor)
      throw new Error("MRR losses exceed the opening customer base");
    const expansionMrrMinor = multiply(sum(openingMrrMinor, -churnedMrrMinor, -contractedMrrMinor), drivers.expansionBps);
    const mrrMinor = sum(openingMrrMinor, drivers.newMrrMinor, expansionMrrMinor, -churnedMrrMinor, -contractedMrrMinor);
    const collectibleMinor = multiply(mrrMinor, plan.collectionRateBps);
    scheduledCollections[period.index + plan.collectionLagMonths] = collectibleMinor;
    const row = {
      ...period, openingMrrMinor, newMrrMinor: drivers.newMrrMinor, expansionMrrMinor, churnedMrrMinor, contractedMrrMinor,
      mrrMinor, arrMinor: multiply(mrrMinor, 12, 1), revenueMinor: mrrMinor,
      collectionsMinor: sum(scheduledCollections[period.index], plan.openingReceivableCollectionsMinor[period.index]),
      uncollectibleMinor: sum(mrrMinor, -collectibleMinor),
      mrrGrowthRate: openingMrrMinor === 0 ? null : (mrrMinor - openingMrrMinor) / openingMrrMinor,
      netRevenueRetention: openingMrrMinor === 0 ? null : (mrrMinor - drivers.newMrrMinor) / openingMrrMinor,
      grossRevenueRetention: openingMrrMinor === 0 ? null : (openingMrrMinor - churnedMrrMinor - contractedMrrMinor) / openingMrrMinor,
    };
    openingMrrMinor = mrrMinor;
    if (period.index < window.months - 1)
      drivers = { ...drivers, newMrrMinor: multiply(drivers.newMrrMinor, 10_000 + drivers.newSalesGrowthBps) };
    return row;
  });
  return { rows, pendingCollectionsMinor: sum(...scheduledCollections.slice(window.months)),
    qualifications: ["conditional_subscription_revenue_not_observed_actuals", "start_of_month_mrr_changes_full_month_revenue",
      "expansion_applies_to_retained_mrr", "fixed_collection_lag_no_annual_prepayments", "null_ratios_have_zero_opening_mrr"] };
}
