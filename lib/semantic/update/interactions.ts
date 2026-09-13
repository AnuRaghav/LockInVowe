import { createServiceClient } from "@/lib/supabase/service";
import type { Database, Json } from "@/lib/supabase/types";
import type { SemanticScope } from "@/lib/semantic/types";
import type {
  SemanticInteraction,
  SemanticInteractionMessage,
  SemanticProposal,
  SemanticUpdateResult,
  StoredSemanticInteraction,
} from "@/lib/semantic/update/types";

/**
 * Persistence for the interactions that drive semantic change.
 *
 * This table is the answer to "why does the Hiring block say that?". Every
 * revision points at a row here, and the row holds the conversation that caused
 * it, the proposal the model made, and what application code did with that
 * proposal. Together those three make a bad revision diagnosable: you can see
 * what was said, what the model concluded, and whether the validator let it
 * through or the validator was the thing that got it wrong.
 *
 * It is also the idempotency boundary. `externalKey` is claimed on first
 * submission, so replaying a run - a retried request, a re-queued hook - finds
 * the existing row and its recorded outcome instead of asking the model to
 * judge the same conversation twice.
 */

type ServiceClient = ReturnType<typeof createServiceClient>;
type InteractionRow = Database["public"]["Tables"]["semantic_interactions"]["Row"];

const asJson = (value: unknown): Json => value as Json;

const toStored = (row: InteractionRow): StoredSemanticInteraction => ({
  id: row.id,
  externalKey: row.external_key,
  source: row.source,
  threadId: row.thread_id ?? undefined,
  runId: row.run_id ?? undefined,
  occurredAt: row.occurred_at,
  // Round-tripped through jsonb, so its static type is `Json`. It was written
  // by `claim()` from a typed transcript on the way in.
  messages: (row.transcript ?? []) as unknown as SemanticInteractionMessage[],
  status: row.status,
});

export interface SemanticInteractionStore {
  /**
   * Finds the interaction for this key, or records it as pending.
   *
   * Returns whether the row already existed, which is how the caller tells a
   * fresh interaction from a replay without a second round trip.
   */
  claim(
    scope: SemanticScope,
    interaction: SemanticInteraction
  ): Promise<{ interaction: StoredSemanticInteraction; existed: boolean }>;
  /** Records what the model proposed and what was done about it. */
  complete(
    scope: SemanticScope,
    id: string,
    outcome: {
      status: "processed" | "skipped" | "failed";
      proposal?: SemanticProposal;
      result?: Pick<SemanticUpdateResult, "applied" | "rejected" | "consideredKeys">;
      error?: string;
    }
  ): Promise<void>;
  get(scope: SemanticScope, id: string): Promise<StoredSemanticInteraction | null>;
}

const COLUMNS =
  "id, company_id, external_key, source, thread_id, run_id, occurred_at, transcript, status, proposal, outcome, error, processed_at, created_at";

export const createSemanticInteractionStore = (
  client?: ServiceClient
): SemanticInteractionStore => {
  const supabase = client ?? createServiceClient();

  return {
    async claim(scope, interaction) {
      const existing = await supabase
        .from("semantic_interactions")
        .select(COLUMNS)
        .eq("company_id", scope.companyId)
        .eq("external_key", interaction.externalKey)
        .maybeSingle();

      if (existing.error) throw existing.error;
      if (existing.data) {
        return { interaction: toStored(existing.data), existed: true };
      }

      const { data, error } = await supabase
        .from("semantic_interactions")
        .insert({
          company_id: scope.companyId,
          external_key: interaction.externalKey,
          source: interaction.source ?? "conversation",
          thread_id: interaction.threadId ?? null,
          run_id: interaction.runId ?? null,
          occurred_at: interaction.occurredAt ?? new Date().toISOString(),
          transcript: asJson(interaction.messages),
        })
        .select(COLUMNS)
        .single();

      if (error) {
        // Two callers racing on the same key: one insert wins, the other reads
        // back the winner. A replay must never become a second interaction.
        if (error.code === "23505") {
          const retry = await supabase
            .from("semantic_interactions")
            .select(COLUMNS)
            .eq("company_id", scope.companyId)
            .eq("external_key", interaction.externalKey)
            .single();

          if (retry.error) throw retry.error;
          return { interaction: toStored(retry.data), existed: true };
        }

        throw error;
      }

      return { interaction: toStored(data), existed: false };
    },

    async complete(scope, id, outcome) {
      const { error } = await supabase
        .from("semantic_interactions")
        .update({
          status: outcome.status,
          proposal: outcome.proposal ? asJson(outcome.proposal) : null,
          outcome: outcome.result ? asJson(outcome.result) : null,
          error: outcome.error ?? null,
          processed_at: new Date().toISOString(),
        })
        .eq("company_id", scope.companyId)
        .eq("id", id);

      if (error) throw error;
    },

    async get(scope, id) {
      const { data, error } = await supabase
        .from("semantic_interactions")
        .select(COLUMNS)
        .eq("company_id", scope.companyId)
        .eq("id", id)
        .maybeSingle();

      if (error) throw error;
      return data ? toStored(data) : null;
    },
  };
};
