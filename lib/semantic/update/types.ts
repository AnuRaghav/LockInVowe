import { z } from "zod";

import type { SemanticBlock, SemanticBlockStatus } from "@/lib/semantic/types";

/**
 * The semantic updater - contracts.
 *
 * The split this file exists to enforce:
 *
 *     the model decides what an interaction *means*
 *     application code decides what the database *does*
 *
 * So the model never writes state. It returns a {@link SemanticProposal}: a
 * small, closed set of operations over topics, in the company's own words.
 * Everything after that - does this topic exist, is this key well-formed, is
 * this actually a change, is this transition allowed, which company are we in -
 * is decided in `apply.ts` against the database, not against the model's belief
 * about the database.
 *
 * That boundary is not ceremony. A model that can emit arbitrary writes can
 * emit a second Hiring block, revive an archived topic, or attribute a change
 * to another company, and no prompt reliably prevents any of those. A model
 * that can only emit "revise the topic called hiring" cannot.
 */

/** One turn of an interaction. */
export interface SemanticInteractionMessage {
  role: "founder" | "sam" | "system" | string;
  text: string;
}

/**
 * Something that might have changed what the company understands.
 *
 * Usually a conversation. Deliberately not typed as one: an onboarding form, a
 * pasted board update, or a founder's note are all the same shape to this
 * layer, and pretending otherwise would put a taxonomy in the one place we most
 * want to keep open.
 */
export interface SemanticInteraction {
  /**
   * Idempotency key, supplied by the caller: a Sam run id, a message id, a
   * digest. Submitting the same interaction twice must not revise anything
   * twice, and this is what makes that enforceable without re-asking the model.
   */
  externalKey: string;
  /** 'conversation', 'note', 'onboarding'. Free-form. */
  source?: string;
  threadId?: string;
  runId?: string;
  /** When it happened. Defaults to now. */
  occurredAt?: string;
  messages: SemanticInteractionMessage[];
}

/** The interaction as stored, once it has an id of its own. */
export interface StoredSemanticInteraction extends SemanticInteraction {
  id: string;
  status: "pending" | "processed" | "skipped" | "failed";
  occurredAt: string;
}

/**
 * The operations a model may propose.
 *
 * Four, and there is no fifth. `delete` is absent by design - semantic state is
 * never destroyed, only archived - and so is anything that names a revision,
 * because a proposal that could target revision 2 of a block could rewrite
 * history.
 */
export const SEMANTIC_OPERATIONS = ["create", "revise", "archive", "none"] as const;
export type SemanticOperationKind = (typeof SEMANTIC_OPERATIONS)[number];

/**
 * A proposed operation.
 *
 * Flat, with an `op` discriminator and optional fields, rather than a
 * discriminated union. A union compiles to nested `anyOf` in the tool schema,
 * which models fill out markedly less reliably than one object with a mode
 * field; the per-operation requirements are enforced below in
 * {@link semanticOperationSchema}'s refinement instead, where a violation is a
 * clean validation error rather than a malformed tool call.
 */
export const semanticOperationSchema = z
  .object({
    op: z
      .enum(SEMANTIC_OPERATIONS)
      .describe(
        "create: this is a genuinely new topic for the company. revise: this changes a topic that already exists - prefer this. archive: this topic is over or was mistaken. none: nothing durable was said."
      ),
    key: z
      .string()
      .optional()
      .describe(
        "The topic's stable name in lowercase-with-hyphens, e.g. 'hiring', 'customer-acme'. For revise/archive it must be the key of a topic you were shown. Omit for 'none'."
      ),
    title: z
      .string()
      .optional()
      .describe("Short human title for the topic, e.g. 'Hiring'. Required when creating."),
    summary: z
      .string()
      .optional()
      .describe("One line capturing the topic's current state."),
    body: z
      .string()
      .optional()
      .describe(
        "The company's complete current understanding of this topic, in prose, rewritten in full to incorporate what was just said. Not a delta, not an append, and never a note about the conversation itself. Required for create and revise."
      ),
    labels: z
      .array(z.string())
      .optional()
      .describe("A few retrieval tags, e.g. ['hiring','runway']."),
    status: z
      .enum(["active", "dormant", "resolved", "archived"])
      .optional()
      .describe(
        "For archive: 'resolved' when the topic ran its course, 'archived' when it should never have been one. Otherwise leave unset."
      ),
    salience: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("How load-bearing this topic is for the company, 0-1."),
    contextPolicy: z
      .enum(["always", "when_relevant", "background"])
      .optional()
      .describe(
        "'always' only for things most financial conversations would be wrong without."
      ),
    changeNote: z
      .string()
      .optional()
      .describe(
        "One line on what changed and why, e.g. 'Hiring frozen until the raise closes.' This is what a founder reads in the history."
      ),
    reason: z
      .string()
      .optional()
      .describe("For 'none': why this interaction changed nothing durable."),
  })
  .superRefine((operation, ctx) => {
    const needsKey = operation.op !== "none";
    if (needsKey && !operation.key?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["key"],
        message: `"${operation.op}" requires the topic's key.`,
      });
    }

    if ((operation.op === "create" || operation.op === "revise") && !operation.body?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["body"],
        message: `"${operation.op}" requires the topic's full current understanding in \`body\`.`,
      });
    }

    if (operation.op === "create" && !operation.title?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["title"],
        message: '"create" requires a title.',
      });
    }
  });

export type SemanticOperation = z.infer<typeof semanticOperationSchema>;

/** Hard ceilings. See {@link semanticProposalSchema}. */
export const MAX_OPERATIONS_PER_INTERACTION = 4;
export const MAX_CREATES_PER_INTERACTION = 2;

/**
 * What the model returns for one interaction.
 *
 * The caps are the consolidation policy made structural. One conversation that
 * touches hiring, the raise, and a customer should revise three topics; one
 * that produces six new blocks has stopped consolidating and started
 * transcribing, and no amount of prompt language prevents that as reliably as
 * a schema that cannot express it.
 */
export const semanticProposalSchema = z.object({
  assessment: z
    .string()
    .describe(
      "One or two sentences: what, if anything, this interaction changed about the company's durable understanding. Say plainly when the answer is nothing."
    ),
  operations: z
    .array(semanticOperationSchema)
    .max(MAX_OPERATIONS_PER_INTERACTION)
    .describe(
      "The changes to make. Empty, or a single 'none', when the interaction was transient."
    ),
});

export type SemanticProposal = z.infer<typeof semanticProposalSchema>;

export interface SemanticProposalRequest {
  interaction: SemanticInteraction;
  /** The current blocks judged relevant. The model may only revise these. */
  blocks: SemanticBlock[];
  /** Wall clock for the run, so a proposal is reproducible in a test. */
  now: string;
}

/**
 * Whatever turns an interaction into a proposal.
 *
 * An interface, not a function on a model, so tests can supply a deterministic
 * proposer and CI never depends on a live Claude call to assert that hiring
 * consolidates into one block.
 */
export interface SemanticProposer {
  propose(request: SemanticProposalRequest): Promise<SemanticProposal>;
}

/** One operation that survived validation and was written. */
export interface AppliedSemanticChange {
  op: Exclude<SemanticOperationKind, "none">;
  key: string;
  blockId: string;
  revisionId: string;
  revision: number;
  created: boolean;
  changeNote?: string;
}

/** Why an operation the model proposed was not carried out. */
export interface RejectedSemanticOperation {
  op: SemanticOperationKind;
  key?: string;
  /** Machine-readable, so a caller can tell a model mistake from a no-op. */
  reason:
    | "unusable_key"
    | "unknown_topic"
    | "topic_archived"
    | "duplicate_key"
    | "no_material_change"
    | "too_many_operations"
    | "too_many_creates"
    | "invalid_operation";
  detail: string;
}

/** What the updater did, for a caller and for the audit trail. */
export interface SemanticUpdateResult {
  /**
   * `applied` - state changed. `unchanged` - nothing durable was said, or
   * nothing survived validation. `skipped` - this interaction was already
   * processed. `failed` - the proposer or the store errored.
   */
  status: "applied" | "unchanged" | "skipped" | "failed";
  interactionId: string;
  /** The blocks that were shown to the model, for reproducing a decision. */
  consideredKeys: string[];
  applied: AppliedSemanticChange[];
  rejected: RejectedSemanticOperation[];
  /** Exactly what the model proposed, before validation. */
  proposal?: SemanticProposal;
  error?: string;
}

/** Statuses an `archive` operation may land on. Never 'active'. */
export const ARCHIVE_STATUSES: readonly SemanticBlockStatus[] = ["resolved", "archived"];
