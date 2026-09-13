/** Deterministic planning API. Not registered as agent tools until its integration is reviewed. */
export { forecastRevenue, type RevenuePlan, type RevenueDrivers } from "./revenue";
export { forecastHeadcountCost, type PlannedEmployee } from "./headcount";
export { calculateSaasMetrics, type MonthlyMetricInputs, type PlanningMetric } from "./metrics";
export { forecastCash, forecastBurn, calculateForecastRunway as calculateRunway, forecastRunwayThreshold,
  estimateFundraisingStartDate, reachProfitability, type OperatingPlan, type OperatingForecast, type PlannedExpense,
  type PlannedOneTimeCost, type PlannedRaise } from "./forecast";
export { compareScenarios, simulateHire, simulateSpendChange, canAffordHire, canAffordSpend, delayHiring,
  increaseMarketing, revenueMiss, churnIncrease, customerLoss, raiseRound, changeRaiseTiming, reduceBurn,
  type AffordabilityPolicy, type SpendChange } from "./scenarios";
