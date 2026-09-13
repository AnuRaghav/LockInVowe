import { createServiceClient } from "@/lib/supabase/service";
import type { Database, Json } from "@/lib/supabase/types";

/**
 * Onboarding sessions: the resumable state of one founder's onboarding interview.
 *
 * A session belongs to a founder *and* a company - one person telling us about
 * one company - and at most one is in progress for that pair. Starting
 * onboarding again resumes it.
 *
 * The rule this module exists to enforce: the text of a sensitive answer is
 * never persisted here. Messages marked `sensitive` are reduced to their role,
 * section, and timestamp by {@link redactOnboardingMessage} before any write,
 * and the database function refuses a sensitive message that still has text.
 * What the founder shared in that section lives only in personal founder blocks.
 */

export type OnboardingSessionStatus = "in_progress" | "completed" | "abandoned";

export interface OnboardingSessionScope {
  founderId: string;
  companyId: string;
}

/** One turn of the interview, as the interview engine produces it. */
export interface OnboardingMessage {
  role: "founder" | "sam";
  text: string;
  /** The interview section this turn belongs to. */
  sectionId?: string;
  /** Part of the personal section. Its text will not be stored. */
  sensitive?: boolean;
  at: string;
}

/** A turn as it is stored. A sensitive turn has no text, only that it happened. */
export type StoredOnboardingMessage =
  | { role: OnboardingMessage["role"]; text: string; sectionId?: string; at: string }
  | { role: OnboardingMessage["role"]; sectionId?: string; at: string; sensitive: true; redacted: true };

/**
 * A question left open. No free-text note on purpose: an open item for a
 * declined personal question must not become a place its answer leaks into.
 */
export interface OnboardingOpenItem {
  state: "deferred" | "unsure" | "declined";
  at: string;
}

export interface OnboardingSession {
  id: string;
  founderId: string;
  companyId: string;
  status: OnboardingSessionStatus;
  /** Per-question progress, keyed by question id. Shape owned by the interview engine. */
  checklist: Record<string, unknown>;
  transcript: StoredOnboardingMessage[];
  /** Keyed by question id. */
  openItems: Record<string, OnboardingOpenItem>;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface RecordOnboardingProgress {
  /** Appended to the transcript, redacted first. */
  messages?: OnboardingMessage[];
  /** Merged into the checklist, one level deep: a key replaces that question's entry. */
  checklist?: Record<string, unknown>;
  /** Merged into open items the same way. */
  openItems?: Record<string, OnboardingOpenItem>;
}

export interface OnboardingSessionStore {
  /** The in-progress session for this founder and company, created if there is none. */
  start(scope: OnboardingSessionScope): Promise<OnboardingSession>;
  getCurrent(scope: OnboardingSessionScope): Promise<OnboardingSession | null>;
  /** @throws {OnboardingSessionNotFoundError} unless the session is this scope's and in progress. */
  record(
    scope: OnboardingSessionScope,
    sessionId: string,
    progress: RecordOnboardingProgress
  ): Promise<OnboardingSession>;
  /** @throws {OnboardingSessionNotFoundError} unless the session is this scope's and in progress. */
  finish(
    scope: OnboardingSessionScope,
    sessionId: string,
    status: Exclude<OnboardingSessionStatus, "in_progress">
  ): Promise<OnboardingSession>;
}

export class OnboardingSessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Onboarding session ${sessionId} not found or not in progress.`);
    this.name = "OnboardingSessionNotFoundError";
  }
}

export const redactOnboardingMessage = (message: OnboardingMessage): StoredOnboardingMessage =>
  message.sensitive
    ? {
        role: message.role,
        ...(message.sectionId !== undefined && { sectionId: message.sectionId }),
        at: message.at,
        sensitive: true,
        redacted: true,
      }
    : {
        role: message.role,
        text: message.text,
        ...(message.sectionId !== undefined && { sectionId: message.sectionId }),
        at: message.at,
      };

type ServiceClient = ReturnType<typeof createServiceClient>;
type SessionRow = Database["public"]["Tables"]["onboarding_sessions"]["Row"];

const toSession = (row: SessionRow): OnboardingSession => ({
  id: row.id,
  founderId: row.founder_id,
  companyId: row.company_id,
  status: row.status as OnboardingSessionStatus,
  checklist: (row.checklist ?? {}) as Record<string, unknown>,
  transcript: (row.transcript ?? []) as unknown as StoredOnboardingMessage[],
  openItems: (row.open_items ?? {}) as unknown as Record<string, OnboardingOpenItem>,
  startedAt: row.started_at,
  updatedAt: row.updated_at,
  completedAt: row.completed_at ?? undefined,
});

const SESSION_COLUMNS =
  "id, founder_id, company_id, status, checklist, transcript, open_items, started_at, updated_at, completed_at";

export const createOnboardingSessionStore = (client?: ServiceClient): OnboardingSessionStore => {
  const supabase = client ?? createServiceClient();

  return {
    async start(scope) {
      const { data, error } = await supabase.rpc("onboarding_session_start", {
        p_founder_id: scope.founderId,
        p_company_id: scope.companyId,
      });

      if (error) throw error;
      if (!data) throw new Error("onboarding_session_start returned no session.");
      return toSession(data as SessionRow);
    },

    async getCurrent(scope) {
      const { data, error } = await supabase
        .from("onboarding_sessions")
        .select(SESSION_COLUMNS)
        .eq("founder_id", scope.founderId)
        .eq("company_id", scope.companyId)
        .eq("status", "in_progress")
        .maybeSingle();

      if (error) throw error;
      return data ? toSession(data) : null;
    },

    async record(scope, sessionId, progress) {
      const { data, error } = await supabase.rpc("onboarding_session_record", {
        p_session_id: sessionId,
        p_founder_id: scope.founderId,
        p_messages: (progress.messages ?? []).map(redactOnboardingMessage) as unknown as Json,
        p_checklist: (progress.checklist ?? {}) as Json,
        p_open_items: (progress.openItems ?? {}) as unknown as Json,
      });

      if (error) {
        if (error.code === "PT404") throw new OnboardingSessionNotFoundError(sessionId);
        throw error;
      }

      const session = data ? toSession(data as SessionRow) : null;
      // The function is founder-scoped; the company check keeps a session from
      // being advanced under a different company than it was started for.
      if (!session || session.companyId !== scope.companyId) {
        throw new OnboardingSessionNotFoundError(sessionId);
      }
      return session;
    },

    async finish(scope, sessionId, status) {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("onboarding_sessions")
        .update({
          status,
          updated_at: now,
          completed_at: status === "completed" ? now : null,
        })
        .eq("id", sessionId)
        .eq("founder_id", scope.founderId)
        .eq("company_id", scope.companyId)
        .eq("status", "in_progress")
        .select(SESSION_COLUMNS)
        .maybeSingle();

      if (error) throw error;
      if (!data) throw new OnboardingSessionNotFoundError(sessionId);
      return toSession(data);
    },
  };
};
