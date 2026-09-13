import type { AssumptionKey } from "@/lib/company/assumptions";
import type { CompanyProfile } from "@/lib/company/profile";
import {
  applyContractPatch,
  contractPatchSchema,
  type CommunicationContract,
  type CommunicationContractStore,
  type CommunicationPreferences,
  type ReviseContractInput,
} from "@/lib/founder/contract";
import type { FounderScope } from "@/lib/founder/types";
import type { OnboardingCapability } from "@/lib/onboarding/capability";
import {
  OnboardingSessionNotFoundError,
  type OnboardingOpenItem,
  type OnboardingSession,
  type OnboardingSessionStore,
} from "@/lib/onboarding/sessions";

/**
 * Holds everything an interview turn's tools write until the turn completes.
 *
 * Without this, a turn that ran out of budget or timed out had already saved
 * its tool calls - questions marked answered, a section closed - while the
 * founder saw an error and none of the conversation was stored. The next turn
 * then treated those questions as done, which read as Sam skipping them.
 *
 * Tools see their own staged writes (a question marked answered earlier in the
 * turn counts when closing the section), and nothing reaches the real stores
 * until `commit`. The checklist is written last, so a commit that fails partway
 * leaves questions open to be asked again rather than marked done.
 */

type BufferedStores = Pick<OnboardingCapability, "sessions" | "contracts" | "assumptions" | "companies">;

export interface TurnBuffer {
  /** Drop-in stores for the turn's capability. */
  stores: BufferedStores;
  hasChanges(): boolean;
  /** Writes everything staged, in order, to the real stores. */
  commit(scope: { founderId: string; companyId: string }, sessionId: string): Promise<void>;
}

const preferencesOf = (contract: CommunicationPreferences | null): CommunicationPreferences | null =>
  contract && {
    badNews: contract.badNews,
    detail: contract.detail,
    recommendations: contract.recommendations,
    pushback: contract.pushback,
    flagOptimisticAssumptions: contract.flagOptimisticAssumptions,
    financeFluency: contract.financeFluency,
    alerts: contract.alerts,
  };

const definedOnly = (profile: CompanyProfile): CompanyProfile =>
  Object.fromEntries(Object.entries(profile).filter(([, value]) => value !== undefined));

export const createTurnBuffer = (target: BufferedStores): TurnBuffer => {
  const checklist: Record<string, unknown> = {};
  const openItems: Record<string, OnboardingOpenItem> = {};
  const assumptions = new Map<string, { companyId: string; key: AssumptionKey; value: unknown }>();
  let profile: { companyId: string; profile: CompanyProfile } | null = null;
  const contractChanges: Array<{ scope: FounderScope; input: ReviseContractInput }> = [];

  const withStaged = (session: OnboardingSession | null): OnboardingSession | null =>
    session && {
      ...session,
      checklist: { ...session.checklist, ...checklist },
      openItems: { ...session.openItems, ...openItems },
    };

  const sessions: OnboardingSessionStore = {
    async start(scope) {
      return withStaged(await target.sessions.start(scope))!;
    },
    async getCurrent(scope) {
      return withStaged(await target.sessions.getCurrent(scope));
    },
    async record(scope, sessionId, progress) {
      if (progress.messages?.length) {
        throw new Error("Transcript messages are stored by the interview after a turn, not by its tools.");
      }
      const current = await target.sessions.getCurrent(scope);
      if (!current || current.id !== sessionId) throw new OnboardingSessionNotFoundError(sessionId);

      Object.assign(checklist, progress.checklist);
      Object.assign(openItems, progress.openItems);
      return withStaged(current)!;
    },
    async finish() {
      throw new Error("An onboarding session cannot be finished during an interview turn.");
    },
  };

  const contracts: CommunicationContractStore = {
    async getCurrent(scope) {
      const current = await target.contracts.getCurrent(scope);
      const staged = contractChanges.filter((change) => change.scope.founderId === scope.founderId);
      if (staged.length === 0) return current;

      const preferences = staged.reduce<CommunicationPreferences | null>(
        (previous, change) => applyContractPatch(previous, change.input.patch),
        preferencesOf(current)
      )!;
      const last = staged[staged.length - 1].input;

      return {
        id: current?.id ?? "staged",
        revision: current?.revision ?? 0,
        provenance: last.provenance ?? {},
        changeKind: last.changeKind ?? (current ? "revised" : "created"),
        changeNote: last.changeNote,
        recordedAt: new Date().toISOString(),
        ...preferences,
      } satisfies CommunicationContract;
    },
    getHistory: (scope, query) => target.contracts.getHistory(scope, query),
    async revise(scope, input) {
      contractPatchSchema.parse(input.patch);
      contractChanges.push({ scope, input });
      return (await contracts.getCurrent(scope))!;
    },
  };

  return {
    stores: {
      sessions,
      contracts,
      assumptions: {
        async set(companyId, key, value) {
          assumptions.set(`${companyId}:${key}`, { companyId, key, value });
        },
      },
      companies: {
        async saveProfile(companyId, next) {
          profile = { companyId, profile: { ...profile?.profile, ...definedOnly(next) } };
        },
      },
    },

    hasChanges: () =>
      assumptions.size > 0 ||
      profile !== null ||
      contractChanges.length > 0 ||
      Object.keys(checklist).length > 0 ||
      Object.keys(openItems).length > 0,

    async commit(scope, sessionId) {
      for (const { companyId, key, value } of assumptions.values()) {
        await target.assumptions.set(companyId, key, value);
      }
      if (profile) await target.companies.saveProfile(profile.companyId, profile.profile);
      for (const change of contractChanges) await target.contracts.revise(change.scope, change.input);
      if (Object.keys(checklist).length > 0 || Object.keys(openItems).length > 0) {
        await target.sessions.record(scope, sessionId, { checklist, openItems });
      }
    },
  };
};
