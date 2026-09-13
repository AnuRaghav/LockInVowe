import type { DigestInsight } from "@/lib/insights/types";

/**
 * PLACEHOLDER, deliberately hardcoded. This is the demo stand-in for a real
 * recommendation engine (what's worth surfacing, how it's ranked, whether
 * it's rule-based or model-based) - that design is separate follow-up work.
 * See lib/insights/types.ts for the seam it plugs into.
 *
 * The numbers aren't invented from nothing, though: MRR, payroll, and
 * marketing series are the exact monthly figures from the mock Source Layer
 * data seeded for this account, and the quarter-over-quarter cash
 * consumption figures ($282,576 -> $298,835) are copied from a real call to
 * financial_burn_runway against that data - Sam's actual tool, not a guess.
 * Only the cash-position trend line is a smoothed reconstruction (real net
 * cash flow per month, walked forward from the same starting balance) rather
 * than literal daily ledger points.
 */

const MONTHS = ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"];

const series = (name: string, values: number[]) => ({
  name,
  points: values.map((y, i) => ({ x: MONTHS[i], y })),
});

export const getDailyDigest = (): DigestInsight[] => [
  {
    id: "cash-runway",
    tone: "warning",
    category: "Cash and runway",
    title: "Cash is trending down. Plan your next raise.",
    note: "You've burned through $544k over the past year. At the current pace, that leaves roughly 7 months of runway before you need to raise or cut costs.",
    stat: { value: 356381, label: "Cash on hand today", prefix: "$" },
    chart: {
      title: "Checking balance",
      type: "line",
      yLabel: "USD",
      series: [
        series("Cash on hand", [
          848152, 785714, 743301, 683983, 643145, 574027, 512849, 463371, 409749, 374157, 341965, 356381,
        ]),
      ],
    },
    followUpPrompt: "What's my runway right now?",
  },
  {
    id: "revenue-rebound",
    tone: "positive",
    category: "Revenue growth",
    title: "Revenue rebounded hard after a rough Q2",
    note: "A key customer churned in March, cutting monthly revenue 30%. Since then, new logo wins have driven revenue up 148%, the fastest growth streak in the company's history.",
    stat: { value: 148, label: "Revenue growth since the March low", suffix: "%" },
    chart: {
      title: "Monthly revenue",
      type: "line",
      yLabel: "USD",
      series: [series("Revenue", [34000, 37000, 39500, 43000, 47000, 33000, 35000, 41000, 52000, 61000, 71000, 82000])],
    },
    followUpPrompt: "What drove the revenue recovery after March?",
  },
  {
    id: "burn-trend",
    tone: "warning",
    category: "Burn trend",
    title: "Burn is creeping up faster than revenue can outrun it",
    note: "Cash consumption rose 5.8% quarter over quarter (from $282.6k to $298.8k), even as revenue grew. Marketing is the biggest swing factor and worth reviewing before it becomes a trend.",
    stat: { value: 5.8, label: "Quarter-over-quarter increase in cash consumption", suffix: "%" },
    chart: {
      title: "Cash consumption by quarter",
      type: "bar",
      yLabel: "USD",
      series: [
        {
          name: "Cash consumption",
          points: [
            { x: "Mar-May", y: 282576 },
            { x: "Jun-Aug", y: 298835 },
          ],
        },
      ],
    },
    followUpPrompt: "Why did cash consumption increase last quarter?",
  },
  {
    id: "marketing-volatility",
    tone: "neutral",
    category: "Marketing spend",
    title: "Marketing spend swings wildly month to month",
    note: "The biggest and smallest marketing months differ by 5.7x. Ads spend nearly tripled in November and March with no consistent cadence. That makes it a good place to tighten a budget.",
    stat: { value: 5.7, label: "Swing between the biggest and smallest month", suffix: "x" },
    chart: {
      title: "Marketing spend",
      type: "bar",
      yLabel: "USD",
      series: [series("Marketing", [8500, 22000, 4200, 6800, 9500, 24000, 18000, 7200, 11000, 15500, 9800, 13200])],
    },
    followUpPrompt: "Is our marketing spend efficient?",
  },
  {
    id: "payroll-discipline",
    tone: "positive",
    category: "Payroll and headcount",
    title: "Payroll has stayed disciplined with no runaway hiring",
    note: "The team held at 5 people all year, with one retention raise in May. Payroll grew just 2.4% while revenue grew 141% over the same window. That is the kind of leverage investors want to see.",
    stat: { value: 2.4, label: "Payroll growth for the year", suffix: "%" },
    chart: {
      title: "Monthly payroll (gross)",
      type: "bar",
      yLabel: "USD",
      series: [series("Payroll", [54600, 54600, 54600, 54600, 54600, 54600, 54600, 58600, 55900, 55900, 55900, 55900])],
    },
    followUpPrompt: "How does our payroll compare to similar-stage companies?",
  },
];
