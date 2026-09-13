import {
  normalizeSemanticKey,
  type ReviseSemanticBlockInput,
  type SemanticBlock,
  type SemanticBlockStore,
  type SemanticScope,
} from "@/lib/semantic/types";
import {
  ARCHIVE_STATUSES,
  DEFAULT_SEMANTIC_UPDATE_LIMITS,
  type AppliedSemanticChange,
  type RejectedSemanticOperation,
  type SemanticOperation,
  type SemanticProposal,
  type SemanticUpdateLimits,
  type StoredSemanticInteraction,
} from "@/lib/semantic/update/types";

/**
 * Deterministic application of a semantic proposal.
 *
 * Everything the model proposed is treated as a *request*, and every request is
 * checked against the database before anything is written. Specifically:
 *
 * - The company is never taken from the proposal. It comes from the scope the
 *   application resolved, and every lookup is confined to it, so a proposal
 *   cannot reach another company's state even if it names one.
 * - Existence is re-read here, not trusted. The model was shown some blocks,
 *   but "shown" is not "still true", and a `revise` against a topic that has
 *   since been archived must fail rather than resurrect it.
 * - Omitted fields keep their current values. A proposal that restates a body
 *   and says nothing about labels or salience must not silently erase them.
 * - An operation that does not change anything is not written. This is the
 *   single most important rule here: without it every conversation that
 *   mentions hiring appends a revision, the history fills with noise, and
 *   "how has this changed?" stops being answerable.
 *
 * Size caps are enforced before anything is written, so a proposal that blew
 * past them is refused wholesale rather than applied halfway.
 */

/**
 * Bounds, so a runaway generation cannot write a novel into a block. Exported
 * with the helpers below so founder blocks are held to the same limits.
 */
export const SEMANTIC_TEXT_LIMITS = {
  title: 120,
  summary: 280,
  body: 4000,
  changeNote: 240,
  labels: 8,
  labelLength: 40,
} as const;

const LIMITS = SEMANTIC_TEXT_LIMITS;

export const clampText = (value: string, max: number): string => {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
};

export const clampUnit = (value: number | undefined): number | undefined =>
  value === undefined ? undefined : Math.min(1, Math.max(0, value));

export const normalizeLabels = (labels: string[] | undefined): string[] | undefined => {
  if (!labels) return undefined;

  const cleaned = labels
    .map((label) => label.trim().toLowerCase().slice(0, LIMITS.labelLength))
    .filter((label) => label.length > 0);

  return [...new Set(cleaned)].slice(0, LIMITS.labels);
};

/**
 * Whether a proposed revision actually says something new.
 *
 * Compared on the fields that carry meaning or change behaviour - the prose,
 * the lifecycle, and how eagerly the block reaches the model. Whitespace and
 * case are normalized away, because a model re-emitting the same paragraph with
 * different line wrapping has not changed the company's understanding.
 *
 * Salience is deliberately *not* compared: a model nudging 0.75 to 0.8 is noise,
 * and treating it as a change would defeat the rule this function exists for.
 * A salience shift that matters will arrive alongside changed prose.
 */
const comparable = (text: string): string =>
  text.replace(/\s+/g, " ").trim().toLowerCase();

export const isMaterialChange = (
  block: SemanticBlock,
  next: Pick<ReviseSemanticBlockInput, "body" | "title" | "summary" | "status" | "contextPolicy">
): boolean =>
  comparable(next.body ?? "") !== comparable(block.body) ||
  comparable(next.title ?? "") !== comparable(block.title) ||
  comparable(next.summary ?? "") !== comparable(block.summary ?? "") ||
  (next.status ?? block.status) !== block.status ||
  (next.contextPolicy ?? block.contextPolicy) !== block.contextPolicy;

export interface ApplyProposalInput {
  scope: SemanticScope;
  store: SemanticBlockStore;
  proposal: SemanticProposal;
  /** The cause. Its id is what every written revision points back at. */
  interaction: StoredSemanticInteraction;
  /** Defaults to {@link DEFAULT_SEMANTIC_UPDATE_LIMITS}. */
  limits?: SemanticUpdateLimits;
}

export interface ApplyProposalResult {
  applied: AppliedSemanticChange[];
  rejected: RejectedSemanticOperation[];
}

const reject = (
  operation: SemanticOperation,
  reason: RejectedSemanticOperation["reason"],
  detail: string
): RejectedSemanticOperation => ({
  op: operation.op,
  key: operation.key,
  reason,
  detail,
});

/**
 * Provenance for a revision written from an interaction.
 *
 * A reference and one short quote - never the conversation. The transcript
 * lives once, on the interaction row; copying it into every block it touched
 * would turn a block's stored state into an archive of its own history.
 */
const provenanceFor = (interaction: StoredSemanticInteraction) => {
  const lastFounderTurn = [...interaction.messages]
    .reverse()
    .find((message) => message.role === "founder");

  return {
    kind: interaction.source ?? "conversation",
    interactionId: interaction.id,
    threadId: interaction.threadId,
    runId: interaction.runId,
    excerpt: lastFounderTurn ? clampText(lastFounderTurn.text, 200) : undefined,
  };
};

export const applySemanticProposal = async ({
  scope,
  store,
  proposal,
  interaction,
  limits = DEFAULT_SEMANTIC_UPDATE_LIMITS,
}: ApplyProposalInput): Promise<ApplyProposalResult> => {
  const applied: AppliedSemanticChange[] = [];
  const rejected: RejectedSemanticOperation[] = [];

  // Narrowed at the filter, so nothing downstream has to keep asking whether a
  // "none" might still be in the list. An explicit `none` alongside real
  // operations is a model contradicting itself; the real operations win.
  const operations = proposal.operations.filter(
    (operation): operation is SemanticOperation & { op: "create" | "revise" | "archive" } =>
      operation.op !== "none"
  );

  // Caps are checked against what the model actually asked for, before any
  // write, so an over-eager proposal is refused whole rather than truncated
  // into a state nobody proposed.
  if (operations.length > limits.maxOperations) {
    return {
      applied,
      rejected: operations.map((operation) =>
        reject(
          operation,
          "too_many_operations",
          `${operations.length} operations proposed; at most ${limits.maxOperations} are allowed for one interaction.`
        )
      ),
    };
  }

  const provenance = provenanceFor(interaction);
  const seen = new Set<string>();
  let creates = 0;

  for (const operation of operations) {
    const rawKey = operation.key ?? "";
    const key = normalizeSemanticKey(rawKey);

    if (!key) {
      rejected.push(
        reject(operation, "unusable_key", `"${rawKey}" is not a usable topic key.`)
      );
      continue;
    }

    // One interaction revises a topic once. Two operations on the same key
    // would write two revisions from a single conversation, which is a history
    // of the model's drafting rather than of the company.
    if (seen.has(key)) {
      rejected.push(
        reject(
          operation,
          "duplicate_key",
          `"${key}" was already changed by this interaction; fold both changes into one operation.`
        )
      );
      continue;
    }
    seen.add(key);

    // Read-through, always. The model was shown a snapshot; this is the state.
    const existing = await store.getBlock(scope, { key });

    if (existing?.status === "archived") {
      rejected.push(
        reject(
          operation,
          "topic_archived",
          `"${key}" is archived. Reviving an archived topic is an explicit application decision, not an automatic one.`
        )
      );
      continue;
    }

    if (operation.op === "revise" && !existing) {
      rejected.push(
        reject(
          operation,
          "unknown_topic",
          `No topic "${key}" for this company. A revision must name a topic that exists.`
        )
      );
      continue;
    }

    if (operation.op === "archive" && !existing) {
      rejected.push(
        reject(operation, "unknown_topic", `No topic "${key}" to archive.`)
      );
      continue;
    }

    // A `create` for a topic that already exists is the consolidation failure
    // this design is built to prevent - but it is also an easy mistake for a
    // model that was not shown the block. Treating it as a revision is the
    // behaviour the design wants; refusing it would just lose the information.
    const effectiveOp =
      operation.op === "create" && existing ? ("revise" as const) : operation.op;

    if (effectiveOp === "create") {
      creates += 1;
      if (creates > limits.maxCreates) {
        rejected.push(
          reject(
            operation,
            "too_many_creates",
            `At most ${limits.maxCreates} new topics may come from one interaction; consolidate into an existing one instead.`
          )
        );
        continue;
      }
    }

    const isArchive = effectiveOp === "archive";
    const status = isArchive
      ? ARCHIVE_STATUSES.includes(operation.status ?? "archived")
        ? operation.status ?? "archived"
        : "archived"
      : operation.status && operation.status !== "archived"
        ? operation.status
        : (existing?.status ?? "active");

    // Fields the proposal left out keep what the block already had. An archive
    // keeps the body verbatim: the topic is being closed, not rewritten.
    const body = isArchive
      ? (existing?.body ?? operation.body ?? "")
      : clampText(operation.body ?? existing?.body ?? "", LIMITS.body);

    const next: ReviseSemanticBlockInput = {
      key,
      title: clampText(operation.title ?? existing?.title ?? key, LIMITS.title),
      body,
      summary: operation.summary
        ? clampText(operation.summary, LIMITS.summary)
        : existing?.summary,
      labels: normalizeLabels(operation.labels) ?? existing?.labels ?? [],
      status,
      contextPolicy: operation.contextPolicy ?? existing?.contextPolicy ?? "when_relevant",
      salience: clampUnit(operation.salience) ?? existing?.salience ?? 0.5,
      confidence: existing?.confidence,
      asOf: interaction.occurredAt.slice(0, 10),
      provenance,
      changeNote: operation.changeNote
        ? clampText(operation.changeNote, LIMITS.changeNote)
        : undefined,
      // The understanding was reached when the interaction happened, not when
      // the updater got round to it. Using wall-clock time here would put a
      // queued or replayed conversation in the wrong place on the timeline and
      // make "what did we believe in October?" quietly wrong.
      //
      // The store refuses a revision recorded before the one it follows, so an
      // interaction processed badly out of order fails loudly rather than
      // rewriting history - which is the correct trade.
      recordedAt: interaction.occurredAt,
    };

    if (!next.body) {
      rejected.push(
        reject(operation, "invalid_operation", `"${key}" would be left with no content.`)
      );
      continue;
    }

    if (existing && !isMaterialChange(existing, next)) {
      rejected.push(
        reject(
          operation,
          "no_material_change",
          `"${key}" already says this. Restating an unchanged understanding is not a revision.`
        )
      );
      continue;
    }

    const result = await store.reviseBlock(scope, next);

    applied.push({
      op: effectiveOp,
      key,
      blockId: result.blockId,
      revisionId: result.revisionId,
      revision: result.revision,
      created: result.created,
      changeNote: next.changeNote,
    });
  }

  return { applied, rejected };
};
