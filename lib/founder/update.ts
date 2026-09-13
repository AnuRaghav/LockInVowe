import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { Runnable } from "@langchain/core/runnables";

import { createSemanticModel } from "@/lib/semantic/model";
import { normalizeSemanticKey, type SemanticProvenance } from "@/lib/semantic/types";
import {
  SEMANTIC_TEXT_LIMITS,
  clampText,
  clampUnit,
  normalizeLabels,
} from "@/lib/semantic/update/apply";
import {
  createSemanticProposalSchema,
  type RejectedSemanticOperation,
  type SemanticInteractionMessage,
  type SemanticOperation,
  type SemanticProposal,
} from "@/lib/semantic/update/types";
import type {
  FounderBlock,
  FounderBlockSensitivity,
  FounderBlockStore,
  FounderScope,
  ReviseFounderBlockInput,
} from "@/lib/founder/types";

/**
 * Consolidating what a founder said about themselves into founder blocks.
 *
 * The same shape as the semantic updater, deliberately: a model proposes
 * operations over topics, and application code decides what is written. It
 * reuses the semantic proposal schema and text limits so there is one notion of
 * a well-formed proposal.
 *
 * What is different is sensitivity. A proposal made from the personal section
 * is applied as `personal` and may only touch personal topics; it can never
 * rewrite a standard topic, because doing so would move something Sam
 * currently reads into a place it does not.
 */

export const FOUNDER_MAX_OPERATIONS = 4;

export const FOUNDER_UPDATER_PROMPT = `You maintain a CFO agent's durable understanding of one founder as a person.

You are given what is currently understood about them and part of their onboarding interview. Decide what, if anything, is now understood differently.

What belongs:
- Their background and experience, where it bears on how financial decisions should be discussed with them
- What they are building toward and why
- Their values and the lines they will not cross
- How they weigh risk, as shown by the calls they make on concrete scenarios
- How they make decisions, and who they rely on

What does not:
- Facts about the company (those are kept separately)
- Communication preferences such as how to deliver bad news (those are saved as settings)
- Anything the founder did not actually say

Consolidate into a few stable topics - revise one that exists rather than creating another beside it. Rewrite a revised body in full, as a plain third-person account of the founder today ("The founder..."). Use their own numbers and words. Never invent, infer a motive they did not state, or pass judgement.`;

const PERSONAL_MODE = `This is the personal section. The founder chose to share these things about their own circumstances. Record only what they shared, precisely, in a personal topic. If they declined or said nothing durable, propose nothing.`;

export interface FounderProposalRequest {
  messages: SemanticInteractionMessage[];
  /** Current topics the proposal may revise. Personal topics only in personal mode. */
  blocks: FounderBlock[];
  sensitive: boolean;
  /** What the section was asking, so an answer like "about eight months" has its question. */
  questions: Array<{ id: string; find: string }>;
  now: string;
}

export interface FounderProposer {
  propose(request: FounderProposalRequest): Promise<SemanticProposal>;
}

export const renderFounderProposalRequest = ({ messages, blocks, sensitive, questions, now }: FounderProposalRequest) =>
  [
    `Today is ${now.slice(0, 10)}.`,
    sensitive ? PERSONAL_MODE : null,
    blocks.length > 0
      ? [
          "What is currently understood about the founder:",
          ...blocks.map((block) => `[${block.key}] ${block.title}\n  ${block.body}`),
        ].join("\n\n")
      : "Nothing is understood about the founder yet.",
    ["What this part of the interview was asking:", ...questions.map((question) => `- ${question.find}`)].join("\n"),
    ["The interview:", ...messages.map((message) => `${message.role}: ${message.text}`)].join("\n\n"),
    "What, if anything, is now understood differently about the founder? Return no operations if nothing durable was said.",
  ]
    .filter((section): section is string => section !== null)
    .join("\n\n---\n\n");

export const createModelFounderProposer = (options: { model?: BaseChatModel } = {}): FounderProposer => {
  const schema = createSemanticProposalSchema(FOUNDER_MAX_OPERATIONS);
  let structured: Runnable<BaseLanguageModelInput, SemanticProposal> | null = null;

  const model = () => {
    if (structured) return structured;
    const chat: BaseChatModel = options.model ?? createSemanticModel();
    structured = chat.withStructuredOutput<SemanticProposal>(schema, { name: "propose_founder_changes" });
    return structured;
  };

  return {
    async propose(request) {
      const result = await model().invoke([
        new SystemMessage(FOUNDER_UPDATER_PROMPT),
        new HumanMessage(renderFounderProposalRequest(request)),
      ]);
      return schema.parse(result);
    },
  };
};

/** Proposes nothing: the honest behaviour without a model. */
export const createNoopFounderProposer = (): FounderProposer => ({
  async propose() {
    return { assessment: "No model is configured, so nothing about the founder was proposed.", operations: [] };
  },
});

/** Replays fixed proposals in order, for tests. */
export const createScriptedFounderProposer = (proposals: SemanticProposal[]): FounderProposer => {
  let index = 0;
  const schema = createSemanticProposalSchema(FOUNDER_MAX_OPERATIONS);

  return {
    async propose() {
      const proposal = proposals[index];
      index += 1;
      if (!proposal) {
        throw new Error(`Scripted founder proposer exhausted after ${proposals.length} proposals.`);
      }
      return schema.parse(proposal);
    },
  };
};

export interface AppliedFounderChange {
  op: "create" | "revise" | "archive";
  key: string;
  blockId: string;
  revisionId: string;
  revision: number;
  created: boolean;
}

export interface RejectedFounderOperation {
  op: SemanticOperation["op"];
  key?: string;
  reason: RejectedSemanticOperation["reason"] | "sensitivity_mismatch";
  detail: string;
}

export interface ApplyFounderProposalInput {
  scope: FounderScope;
  store: FounderBlockStore;
  proposal: SemanticProposal;
  /** `personal` for the personal section: every write is personal, and standard topics are off limits. */
  sensitivity: FounderBlockSensitivity;
  /** A reference, never an excerpt: founder blocks carry no quotes. */
  provenance: SemanticProvenance;
  /** When the words were said. Revisions are recorded at this time. */
  occurredAt: string;
}

const comparable = (text: string | undefined) => (text ?? "").replace(/\s+/g, " ").trim().toLowerCase();

const changes = (block: FounderBlock, next: ReviseFounderBlockInput) =>
  comparable(next.body) !== comparable(block.body) ||
  comparable(next.title) !== comparable(block.title) ||
  comparable(next.summary) !== comparable(block.summary) ||
  (next.status ?? block.status) !== block.status;

export const applyFounderProposal = async ({
  scope,
  store,
  proposal,
  sensitivity,
  provenance,
  occurredAt,
}: ApplyFounderProposalInput): Promise<{ applied: AppliedFounderChange[]; rejected: RejectedFounderOperation[] }> => {
  const applied: AppliedFounderChange[] = [];
  const rejected: RejectedFounderOperation[] = [];
  const reject = (operation: SemanticOperation, reason: RejectedFounderOperation["reason"], detail: string) =>
    rejected.push({ op: operation.op, key: operation.key, reason, detail });

  const operations = proposal.operations.filter(
    (operation): operation is SemanticOperation & { op: "create" | "revise" | "archive" } => operation.op !== "none"
  );

  if (operations.length > FOUNDER_MAX_OPERATIONS) {
    operations.forEach((operation) =>
      reject(operation, "too_many_operations", `At most ${FOUNDER_MAX_OPERATIONS} operations are allowed at once.`)
    );
    return { applied, rejected };
  }

  const seen = new Set<string>();

  for (const operation of operations) {
    const key = normalizeSemanticKey(operation.key ?? "");
    if (!key) {
      reject(operation, "unusable_key", `"${operation.key ?? ""}" is not a usable topic key.`);
      continue;
    }
    if (seen.has(key)) {
      reject(operation, "duplicate_key", `"${key}" was already changed; fold both changes into one operation.`);
      continue;
    }
    seen.add(key);

    const existing = await store.getBlock(scope, { key }, { includePersonal: true });

    if (existing?.status === "archived") {
      reject(operation, "topic_archived", `"${key}" is archived.`);
      continue;
    }
    if (operation.op !== "create" && !existing) {
      reject(operation, "unknown_topic", `No founder topic "${key}".`);
      continue;
    }
    if (existing && sensitivity === "personal" && existing.sensitivity !== "personal") {
      reject(operation, "sensitivity_mismatch", `"${key}" is a standard topic; a personal answer cannot rewrite it.`);
      continue;
    }

    const op = operation.op === "create" && existing ? "revise" : operation.op;
    const isArchive = op === "archive";
    const status = isArchive
      ? operation.status === "resolved"
        ? "resolved"
        : "archived"
      : operation.status && operation.status !== "archived"
        ? operation.status
        : (existing?.status ?? "active");

    const body = isArchive
      ? (existing?.body ?? "")
      : clampText(operation.body ?? existing?.body ?? "", SEMANTIC_TEXT_LIMITS.body);

    if (!body) {
      reject(operation, "invalid_operation", `"${key}" would be left with no content.`);
      continue;
    }

    const next: ReviseFounderBlockInput = {
      key,
      title: clampText(operation.title ?? existing?.title ?? key, SEMANTIC_TEXT_LIMITS.title),
      body,
      summary: operation.summary ? clampText(operation.summary, SEMANTIC_TEXT_LIMITS.summary) : existing?.summary,
      labels: normalizeLabels(operation.labels) ?? existing?.labels ?? [],
      status,
      // Omitted for standard writes, so an existing personal block stays personal.
      sensitivity: sensitivity === "personal" ? "personal" : undefined,
      salience: clampUnit(operation.salience) ?? existing?.salience ?? 0.5,
      confidence: existing?.confidence,
      asOf: occurredAt.slice(0, 10),
      provenance,
      changeNote: operation.changeNote ? clampText(operation.changeNote, SEMANTIC_TEXT_LIMITS.changeNote) : undefined,
      recordedAt: occurredAt,
    };

    if (existing && !changes(existing, next)) {
      reject(operation, "no_material_change", `"${key}" already says this.`);
      continue;
    }

    const result = await store.reviseBlock(scope, next);
    applied.push({ op, key, ...result });
  }

  return { applied, rejected };
};
