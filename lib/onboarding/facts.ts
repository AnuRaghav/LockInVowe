import {
  deriveCashFromBankAccounts,
  deriveMonthlyPayrollCostFromGusto,
  deriveMrrFromStripeRevenue,
  getCurrentTeam,
} from "@/lib/company/assumptions";
import { readCompanyProfile } from "@/lib/company/profile";
import type { SourceProviderId } from "@/lib/source";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * What the connected accounts already say, for the onboarding interview to read
 * back and build on.
 *
 * Every figure here is an estimate derived from connector data, not a verified
 * actual: Sam presents them as "here is what I see - is that right?", never as
 * the company's numbers.
 */
export interface OnboardingFacts {
  bankConnected: boolean;
  /** Latest checking + savings balances in USD, as derived for onboarding. */
  cashOnHandUsd: number | null;
  stripeConnected: boolean;
  /** Stripe charges over the trailing 30 days. A cash proxy, not recurring revenue. */
  revenueLast30DaysUsd: number | null;
  payrollConnected: boolean;
  monthlyPayrollCostUsd: number | null;
  teamSize: number | null;
  company: { name: string | null; description: string | null };
}

/** Whether an active source connection exists for a provider - independent of whether it has produced any data yet. */
export const hasActiveConnection = async (
  companyId: string,
  provider: SourceProviderId
): Promise<boolean> => {
  const supabase = createServiceClient();
  const { count, error } = await supabase
    .from("source_connections")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("provider", provider)
    .eq("status", "active");

  if (error) throw error;
  return (count ?? 0) > 0;
};

/** Gusto lives outside the Source Layer, so its connection has its own table. */
export const hasActivePayrollConnection = async (companyId: string): Promise<boolean> => {
  const supabase = createServiceClient();
  const { count, error } = await supabase
    .from("payroll_connections")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("status", "active");

  if (error) throw error;
  return (count ?? 0) > 0;
};

export const loadOnboardingFacts = async (companyId: string): Promise<OnboardingFacts> => {
  const [
    plaidConnected,
    rhoConnected,
    cashOnHandUsd,
    stripeConnected,
    revenueLast30DaysUsd,
    payrollConnected,
    monthlyPayrollCostUsd,
    team,
    company,
  ] = await Promise.all([
    hasActiveConnection(companyId, "plaid"),
    hasActiveConnection(companyId, "rho"),
    deriveCashFromBankAccounts(companyId),
    hasActiveConnection(companyId, "stripe"),
    deriveMrrFromStripeRevenue(companyId),
    hasActivePayrollConnection(companyId),
    deriveMonthlyPayrollCostFromGusto(companyId),
    getCurrentTeam(companyId),
    readCompanyProfile(companyId),
  ]);

  return {
    bankConnected: plaidConnected || rhoConnected,
    cashOnHandUsd,
    stripeConnected,
    revenueLast30DaysUsd,
    payrollConnected,
    monthlyPayrollCostUsd,
    teamSize: team?.team.length ?? null,
    company,
  };
};
