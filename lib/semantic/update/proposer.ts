import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { Runnable } from "@langchain/core/runnables";

import { createSemanticModel } from "@/lib/semantic/model";
import {
  SEMANTIC_UPDATER_PROMPT,
  renderSemanticProposalRequest,
} from "@/lib/semantic/update/prompt";
import {
  createSemanticProposalSchema,
  semanticProposalSchema,
  type SemanticProposal,
  type SemanticProposalRequest,
  type SemanticProposer,
} from "@/lib/semantic/update/types";

/**
 * Turning an interaction into a proposal.
 *
 * This is the *only* place a model is involved in semantic change. It produces
 * a {@link SemanticProposal} and nothing else - no writes, no ids, no company.
 * Everything downstream treats that proposal as a request to be checked.
 *
 * Two implementations ship:
 *
 * - {@link createModelSemanticProposer}, which asks Claude, and
 * - {@link createNoopSemanticProposer}, which proposes nothing.
 *
 * The second is not a stub for tests. It is the honest behaviour for a process
 * with no API key: a semantic updater that cannot reach a model should decline
 * to change the company's understanding, not guess with keyword matching.
 */

export interface ModelSemanticProposerOptions {
  /** Defaults to {@link createSemanticModel}. Injected in tests. */
  model?: BaseChatModel;
  /** Defaults to {@link SEMANTIC_UPDATER_PROMPT}; onboarding supplies its own. */
  prompt?: string;
  /** Must match the `limits` the proposal will be applied under. */
  maxOperations?: number;
}

export const createModelSemanticProposer = (
  options: ModelSemanticProposerOptions = {}
): SemanticProposer => {
  const schema = createSemanticProposalSchema(options.maxOperations);
  const prompt = options.prompt ?? SEMANTIC_UPDATER_PROMPT;

  // Resolved lazily, so constructing a proposer never demands an API key that
  // a caller may be about to override.
  let structured: Runnable<BaseLanguageModelInput, SemanticProposal> | null = null;

  const model = (): Runnable<BaseLanguageModelInput, SemanticProposal> => {
    if (structured) return structured;

    // Annotated, not inferred: `options.model ?? createSemanticModel()` is a
    // union of two chat models, and TypeScript will not resolve an overloaded
    // method against a union.
    const chat: BaseChatModel = options.model ?? createSemanticModel();

    structured = chat.withStructuredOutput<SemanticProposal>(schema, {
      name: "propose_semantic_changes",
    });

    return structured;
  };

  return {
    async propose(request: SemanticProposalRequest): Promise<SemanticProposal> {
      const result = await model().invoke([
        new SystemMessage(prompt),
        new HumanMessage(renderSemanticProposalRequest(request)),
      ]);

      // Re-parsed rather than trusted: `withStructuredOutput` validates what the
      // provider returned, but this is the boundary where an unvalidated object
      // would become a database write, and it costs nothing to be sure.
      return schema.parse(result);
    },
  };
};

/** Proposes nothing, always. See the note above on why this is a real option. */
export const createNoopSemanticProposer = (
  assessment = "No semantic model is configured, so no change to the company's understanding was proposed."
): SemanticProposer => ({
  async propose() {
    return { assessment, operations: [] };
  },
});

/**
 * A proposer that replays a fixed sequence of proposals.
 *
 * For tests and demos that need to assert on how state evolves over several
 * interactions without a live model in the loop. Exported from the library
 * rather than kept in a test file because the end-to-end demo uses it too.
 */
export const createScriptedSemanticProposer = (
  proposals: SemanticProposal[]
): SemanticProposer => {
  let index = 0;

  return {
    async propose() {
      const proposal = proposals[index];
      index += 1;

      if (!proposal) {
        throw new Error(
          `Scripted proposer exhausted: ${proposals.length} proposals were provided and a ${index}th was requested.`
        );
      }

      return semanticProposalSchema.parse(proposal);
    },
  };
};
