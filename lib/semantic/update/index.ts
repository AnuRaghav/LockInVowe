import { createSemanticBlockStore } from "@/lib/semantic/store";
import {
  CURRENT_STATUSES,
  type SemanticBlock,
  type SemanticBlockStore,
  type SemanticScope,
} from "@/lib/semantic/types";
import { applySemanticProposal } from "@/lib/semantic/update/apply";
import {
  createSemanticInteractionStore,
  type SemanticInteractionStore,
} from "@/lib/semantic/update/interactions";
import {
  createModelSemanticProposer,
  createNoopSemanticProposer,
} from "@/lib/semantic/update/proposer";
import { hasSemanticModel } from "@/lib/semantic/model";
import type {
  SemanticInteraction,
  SemanticProposer,
  SemanticUpdateLimits,
  SemanticUpdateResult,
} from "@/lib/semantic/update/types";

/**
 * The semantic updater, as one application-level call.
 *
 * `updateSemanticState({ scope, interaction })` is the whole public surface.
 * Everything about how it works - which blocks are shown to the model, how a
 * proposal is validated, how a revision is written, how provenance is kept - is
 * behind it, and every part is injectable so a test can be deterministic.
 *
 * It is deliberately *not* wired into Sam's run path yet. Semantic
 * consolidation after every turn is a policy decision with cost and latency
 * attached, and it belongs in the harness as an explicit post-run step rather
 * than hidden inside an agent invocation. What this slice owes that future hook
 * is a function it can call in one line, which is this one.
 *
 * The pipeline:
 *
 *   claim the interaction      (idempotent; a replay stops here)
 *        v
 *   select relevant blocks     (retrieval, not "load everything")
 *        v
 *   propose                    (the model; meaning)
 *        v
 *   validate and apply         (application code; state)
 *        v
 *   record proposal + outcome  (the audit trail)
 */

export interface UpdateSemanticStateInput {
  scope: SemanticScope;
  interaction: SemanticInteraction;
  /** Defaults to Claude, or to proposing nothing when no key is configured. */
  proposer?: SemanticProposer;
  store?: SemanticBlockStore;
  interactions?: SemanticInteractionStore;
  /**
   * How many current blocks to put in front of the model.
   *
   * Small on purpose. The model only needs the topics this interaction might
   * plausibly touch; showing it everything invites it to revise things the
   * conversation never mentioned.
   */
  maxBlocks?: number;
  /** Wall clock, injectable so a test's proposal is reproducible. */
  now?: string;
  /** Operation ceilings. Conversations keep the defaults; onboarding raises them. */
  limits?: SemanticUpdateLimits;
}

const DEFAULT_MAX_BLOCKS = 8;

/** The founder's own words are what the relevant topics are selected against. */
const retrievalTextFor = (interaction: SemanticInteraction): string =>
  interaction.messages
    .filter((message) => message.role !== "system")
    .map((message) => message.text)
    .join("\n")
    .slice(0, 4000);

/**
 * The blocks the model gets to see.
 *
 * A union of two things, and it needs both: whatever the interaction is *about*
 * (so the conversation can find its topic), plus everything marked `always`
 * (so a freeze decided in a hiring conversation can still be written knowing
 * the raise exists). Retrieval alone would miss the second; loading everything
 * would defeat the purpose of the first.
 */
const selectRelevantBlocks = async (
  store: SemanticBlockStore,
  scope: SemanticScope,
  interaction: SemanticInteraction,
  maxBlocks: number
): Promise<SemanticBlock[]> => {
  const [relevant, standing] = await Promise.all([
    store.searchCurrentBlocks(scope, {
      text: retrievalTextFor(interaction),
      limit: maxBlocks,
    }),
    store.listCurrentBlocks(scope, {
      contextPolicies: ["always"],
      statuses: [...CURRENT_STATUSES],
      limit: maxBlocks,
    }),
  ]);

  const byKey = new Map<string, SemanticBlock>();
  for (const block of [...relevant, ...standing]) byKey.set(block.key, block);

  return [...byKey.values()];
};

const defaultProposer = (): SemanticProposer =>
  hasSemanticModel() ? createModelSemanticProposer() : createNoopSemanticProposer();

/**
 * Consolidates one interaction into the company's durable understanding.
 *
 * Never throws for a proposer or store failure: a conversation that could not
 * be consolidated must not take down the thing that produced it. The failure
 * comes back as `status: "failed"` and is recorded against the interaction, so
 * it can be retried or inspected later.
 */
export const updateSemanticState = async ({
  scope,
  interaction,
  proposer,
  store,
  interactions,
  maxBlocks = DEFAULT_MAX_BLOCKS,
  now = new Date().toISOString(),
  limits,
}: UpdateSemanticStateInput): Promise<SemanticUpdateResult> => {
  const blocks = store ?? createSemanticBlockStore();
  const log = interactions ?? createSemanticInteractionStore();

  const { interaction: stored, existed } = await log.claim(scope, interaction);

  // A replay. The company's understanding was already decided for these words;
  // asking again would either waste a model call or, worse, reach a different
  // answer and write a second revision for one conversation.
  if (existed && stored.status !== "pending") {
    return {
      status: "skipped",
      interactionId: stored.id,
      consideredKeys: [],
      applied: [],
      rejected: [],
    };
  }

  try {
    const considered = await selectRelevantBlocks(blocks, scope, interaction, maxBlocks);
    const consideredKeys = considered.map((block) => block.key);

    const proposal = await (proposer ?? defaultProposer()).propose({
      interaction,
      blocks: considered,
      now,
    });

    const { applied, rejected } = await applySemanticProposal({
      scope,
      store: blocks,
      proposal,
      interaction: stored,
      limits,
    });

    const status = applied.length > 0 ? "applied" : "unchanged";

    await log.complete(scope, stored.id, {
      status: "processed",
      proposal,
      result: { applied, rejected, consideredKeys },
    });

    return {
      status,
      interactionId: stored.id,
      consideredKeys,
      applied,
      rejected,
      proposal,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await log
      .complete(scope, stored.id, { status: "failed", error: message })
      // The interaction row is the audit trail, not the operation. Failing to
      // write *why* something failed must not replace the original failure.
      .catch(() => undefined);

    return {
      status: "failed",
      interactionId: stored.id,
      consideredKeys: [],
      applied: [],
      rejected: [],
      error: message,
    };
  }
};

export { applySemanticProposal, isMaterialChange } from "@/lib/semantic/update/apply";
export {
  createSemanticInteractionStore,
  type SemanticInteractionStore,
} from "@/lib/semantic/update/interactions";
export {
  createModelSemanticProposer,
  createNoopSemanticProposer,
  createScriptedSemanticProposer,
} from "@/lib/semantic/update/proposer";
export {
  SEMANTIC_ONBOARDING_PROMPT,
  SEMANTIC_UPDATER_PROMPT,
  renderSemanticProposalRequest,
} from "@/lib/semantic/update/prompt";
export * from "@/lib/semantic/update/types";
