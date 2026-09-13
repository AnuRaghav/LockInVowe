import type { AssumptionKey } from "@/lib/company/assumptions";
import type { CompanyProfile } from "@/lib/company/profile";
import type { CommunicationContractStore } from "@/lib/founder/contract";
import type { OnboardingFacts } from "@/lib/onboarding/facts";
import type { OnboardingSessionStore } from "@/lib/onboarding/sessions";

/**
 * What an onboarding run is allowed to write, handed to its tools through the
 * trusted runtime context.
 *
 * A capability in the same sense as `persistentMemory` or `financials`: the
 * application resolves it before the run, the model never sees or chooses it,
 * and a test can point it at in-memory stores. Its presence is also what makes
 * the onboarding tools usable at all - outside onboarding they refuse to run.
 */
export interface OnboardingCapability {
  /** The in-progress session every tool call advances. */
  sessionId: string;
  sessions: OnboardingSessionStore;
  contracts: CommunicationContractStore;
  assumptions: {
    /** Receives an already-validated value. */
    set(companyId: string, key: AssumptionKey, value: unknown): Promise<void>;
  };
  companies: {
    saveProfile(companyId: string, profile: CompanyProfile): Promise<void>;
  };
  /** What the connected accounts show, for deciding which questions apply. */
  facts: OnboardingFacts;
}

export const isOnboardingCapability = (value: unknown): value is OnboardingCapability => {
  const candidate = value as Partial<OnboardingCapability> | undefined;
  return (
    typeof candidate?.sessionId === "string" &&
    typeof candidate.sessions?.record === "function" &&
    typeof candidate.contracts?.revise === "function" &&
    typeof candidate.assumptions?.set === "function" &&
    typeof candidate.companies?.saveProfile === "function" &&
    typeof candidate.facts === "object" &&
    candidate.facts !== null
  );
};
