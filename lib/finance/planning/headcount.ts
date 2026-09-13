import { date, daysBetween, integer, multiply, periods, sum, uniqueIds, type MonthlyWindow } from "./math";

interface EmploymentDates {
  id: string;
  startDate: string;
  endExclusive?: string;
}

export type PlannedEmployee = EmploymentDates & ({
  /** Already-loaded employer cost. Component amounts are unknown, not zero. */
  monthlyEmployerCostMinor: number;
} | {
  annualSalaryMinor: number;
  payrollTaxBps: number;
  monthlyBenefitsMinor: number;
  monthlyCommissionMinor: number;
});

/** Calendar-day proration, including the start date and excluding the end date. */
export function forecastHeadcountCost(window: MonthlyWindow, employees: PlannedEmployee[]) {
  const timeline = periods(window); uniqueIds(employees);
  for (const employee of employees) {
    date(employee.startDate);
    if (employee.endExclusive && date(employee.endExclusive) <= employee.startDate) throw new Error("Employment end must follow start");
    if ("monthlyEmployerCostMinor" in employee) integer(employee.monthlyEmployerCostMinor, "monthly employer cost");
    else {
      integer(employee.annualSalaryMinor, "annual salary"); integer(employee.payrollTaxBps, "payroll tax", 0, 10_000);
      integer(employee.monthlyBenefitsMinor, "monthly benefits"); integer(employee.monthlyCommissionMinor, "monthly commission");
    }
  }
  return timeline.map(period => {
    const calendarDays = daysBetween(period.start, period.endExclusive);
    const costs = employees.map(employee => {
      const start = employee.startDate > period.start ? employee.startDate : period.start;
      const end = employee.endExclusive && employee.endExclusive < period.endExclusive ? employee.endExclusive : period.endExclusive;
      const activeDays = Math.max(0, daysBetween(start, end));
      if ("monthlyEmployerCostMinor" in employee) return { id: employee.id, activeDays,
        salaryMinor: null, commissionMinor: null, benefitsMinor: null, payrollTaxMinor: null,
        totalMinor: multiply(employee.monthlyEmployerCostMinor, activeDays, calendarDays) };
      const salaryMinor = multiply(employee.annualSalaryMinor, activeDays, 12 * calendarDays);
      const commissionMinor = multiply(employee.monthlyCommissionMinor, activeDays, calendarDays);
      const benefitsMinor = multiply(employee.monthlyBenefitsMinor, activeDays, calendarDays);
      const payrollTaxMinor = multiply(sum(salaryMinor, commissionMinor), employee.payrollTaxBps);
      return { id: employee.id, activeDays, salaryMinor, commissionMinor, benefitsMinor, payrollTaxMinor,
        totalMinor: sum(salaryMinor, commissionMinor, benefitsMinor, payrollTaxMinor) };
    });
    return { ...period, costs, headcount: costs.filter(item => item.activeDays > 0).length,
      averageHeadcount: costs.reduce((total, item) => total + item.activeDays / calendarDays, 0),
      totalMinor: sum(...costs.map(item => item.totalMinor)) };
  });
}
