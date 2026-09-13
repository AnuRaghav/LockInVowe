import { randomUUID } from "node:crypto";

import {
  OnboardingSessionNotFoundError,
  redactOnboardingMessage,
  type OnboardingSession,
  type OnboardingSessionScope,
  type OnboardingSessionStore,
  type RecordOnboardingProgress,
} from "@/lib/onboarding/sessions";

/** Process-local onboarding sessions. Same contract and redaction, no database. */
export class InMemoryOnboardingSessionStore implements OnboardingSessionStore {
  private readonly sessions: OnboardingSession[] = [];

  private inProgress(scope: OnboardingSessionScope, sessionId?: string) {
    return this.sessions.find(
      (session) =>
        session.founderId === scope.founderId &&
        session.companyId === scope.companyId &&
        session.status === "in_progress" &&
        (sessionId === undefined || session.id === sessionId)
    );
  }

  async start(scope: OnboardingSessionScope) {
    const existing = this.inProgress(scope);
    if (existing) return existing;

    const now = new Date().toISOString();
    const session: OnboardingSession = {
      id: randomUUID(),
      founderId: scope.founderId,
      companyId: scope.companyId,
      status: "in_progress",
      checklist: {},
      transcript: [],
      openItems: {},
      startedAt: now,
      updatedAt: now,
    };

    this.sessions.push(session);
    return session;
  }

  async getCurrent(scope: OnboardingSessionScope) {
    return this.inProgress(scope) ?? null;
  }

  async record(scope: OnboardingSessionScope, sessionId: string, progress: RecordOnboardingProgress) {
    const session = this.inProgress(scope, sessionId);
    if (!session) throw new OnboardingSessionNotFoundError(sessionId);

    session.transcript = [...session.transcript, ...(progress.messages ?? []).map(redactOnboardingMessage)];
    session.checklist = { ...session.checklist, ...progress.checklist };
    session.openItems = { ...session.openItems, ...progress.openItems };
    session.updatedAt = new Date().toISOString();
    return session;
  }

  async finish(
    scope: OnboardingSessionScope,
    sessionId: string,
    status: "completed" | "abandoned"
  ) {
    const session = this.inProgress(scope, sessionId);
    if (!session) throw new OnboardingSessionNotFoundError(sessionId);

    const now = new Date().toISOString();
    session.status = status;
    session.updatedAt = now;
    if (status === "completed") session.completedAt = now;
    return session;
  }
}
