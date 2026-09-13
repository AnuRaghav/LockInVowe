import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";

import { runSamAgent, visibleAssistantText } from "@/lib/agents/sam/agent";
import type { SamModelConfig } from "@/lib/agents/sam/config";
import type { SamRunObserver } from "@/lib/agents/sam/harness/events";
import type { SamRunOutcome } from "@/lib/agents/sam/harness/outcome";
import type { SamExecutionPolicy } from "@/lib/agents/sam/harness/policy";
import { setCompanyAssumption } from "@/lib/company/assumptions";
import { saveCompanyProfile } from "@/lib/company/profile";
import { createFinancialSession, type FinancialSession } from "@/lib/finance/session";
import { loadFinancialSnapshot } from "@/lib/finance/sam-surface";
import type { CommunicationContractStore } from "@/lib/founder/contract";
import { createCommunicationContractStore } from "@/lib/founder/store";
import type { OnboardingCapability } from "@/lib/onboarding/capability";
import { ONBOARDING_CHOICES, isChoiceQuestionId, type ChoiceQuestionId } from "@/lib/onboarding/choices";
import {
  ONBOARDING_SECTIONS,
  activeInterviewSeconds,
  currentSection,
  extractionEntryKey,
  readChecklist,
  type OnboardingSectionId,
} from "@/lib/onboarding/checklist";
import {
  extractPersonalAnswer,
  extractSection,
  type ExtractionDeps,
  type ExtractionResult,
} from "@/lib/onboarding/extract";
import { loadOnboardingFacts, type OnboardingFacts } from "@/lib/onboarding/facts";
import { buildOnboardingSystemPrompt } from "@/lib/onboarding/prompt";
import {
  createOnboardingSessionStore,
  type OnboardingMessage,
  type OnboardingSessionStore,
  type StoredOnboardingMessage,
} from "@/lib/onboarding/sessions";
import { ONBOARDING_TOOLS, ONBOARDING_TOOL_POLICIES } from "@/lib/onboarding/tools";
import { createTurnBuffer } from "@/lib/onboarding/turn-buffer";

/**
 * One turn of the onboarding interview.
 *
 * The founder says something (or opens onboarding), Sam replies, and between
 * the two this module does everything that must not be left to the model:
 *
 *   resume the session         one in-progress interview per founder + company
 *   build Sam's view           checklist, time spent, connected data, snapshot
 *   run Sam                    same harness as every Sam run, onboarding tools
 *   commit the turn's writes   only if the run completed; a failed turn leaves none
 *   consolidate personal text  before it is discarded, into personal blocks only
 *   store the turn             redacted if either end of it was personal
 *   consolidate closed sections from the stored (non-personal) transcript
 *
 * Which section a turn belongs to is decided here, not by the model: the
 * founder's message belongs to the section that was current when it arrived,
 * and Sam's reply to the section current once it is done. A reply that crosses
 * into or out of the personal section is treated as personal.
 */

/**
 * More room than a normal Sam run. A founder who answers several questions at
 * once needs one tool call per value, plus marking and closing the section.
 */
export const ONBOARDING_EXECUTION_POLICY: Partial<SamExecutionPolicy> = {
  maxModelCalls: 12,
  maxToolCalls: 24,
  runDeadlineMs: 75_000,
};

export interface OnboardingIdentity {
  founderId: string;
  companyId: string;
}

export interface OnboardingTurnDeps extends ExtractionDeps {
  sessions?: OnboardingSessionStore;
  contracts?: CommunicationContractStore;
  assumptions?: OnboardingCapability["assumptions"];
  companies?: OnboardingCapability["companies"];
  loadFacts?: (companyId: string) => Promise<OnboardingFacts>;
  financials?: FinancialSession;
}

export interface OnboardingTurnInput {
  /** Trusted: resolved from Auth by the caller. */
  identity: OnboardingIdentity;
  /** What the founder said. Omit to open (or resume) the interview. */
  message?: string;
  deps?: OnboardingTurnDeps;
  model?: Partial<SamModelConfig>;
  /** Overrides {@link ONBOARDING_EXECUTION_POLICY}. */
  policy?: Partial<SamExecutionPolicy>;
  signal?: AbortSignal;
  runId?: string;
  observer?: SamRunObserver;
}

export interface OnboardingTurnResult {
  sessionId: string;
  outcome: SamRunOutcome;
  ok: boolean;
  /** Sam's reply. Empty when the run did not complete. */
  reply: string;
  currentSection: OnboardingSectionId | null;
  completedSections: OnboardingSectionId[];
  onboardingComplete: boolean;
  /** Sections consolidated during this turn. */
  extractions: ExtractionResult[];
  /** Present when this turn carried a personal answer. */
  personalExtraction?: ExtractionResult;
  /** Quick replies Sam offered for the question it just asked. */
  choices: { questionId: ChoiceQuestionId; options: readonly string[] } | null;
}

export const ONBOARDING_OPENING_MARKER =
  "(The founder has opened onboarding. Introduce yourself and begin.)";
export const ONBOARDING_RESUME_MARKER =
  "(The founder has come back to onboarding. Pick up where you left off.)";

const REDACTED_FOUNDER_TURN = "[The founder answered a personal question here. The answer is not kept in the transcript.]";
const REDACTED_SAM_TURN = "[Sam's turn in the personal section. Not kept in the transcript.]";

/**
 * The conversation as Sam sees it: always opening on a founder turn, as the
 * model API requires, with personal turns reduced to placeholders.
 */
const toHistory = (transcript: StoredOnboardingMessage[], message?: string): BaseMessage[] => {
  const history: BaseMessage[] = [new HumanMessage(ONBOARDING_OPENING_MARKER)];

  for (const turn of transcript) {
    const text = "text" in turn ? turn.text : turn.role === "founder" ? REDACTED_FOUNDER_TURN : REDACTED_SAM_TURN;
    history.push(turn.role === "founder" ? new HumanMessage(text) : new AIMessage(text));
  }

  if (message) history.push(new HumanMessage(message));
  else if (transcript.length > 0) history.push(new HumanMessage(ONBOARDING_RESUME_MARKER));

  return history;
};

/**
 * Everything Sam said to the founder this turn.
 *
 * Not just the final message: Claude often writes its question in the same
 * message as a tool call and ends the turn with an empty message once the tool
 * has run. Taking only the last message threw that question away.
 */
const turnReply = (messages: BaseMessage[]): string => {
  let start = 0;
  messages.forEach((message, index) => {
    if (message instanceof HumanMessage) start = index + 1;
  });

  return messages
    .slice(start)
    .map(visibleAssistantText)
    .map((text) => text.trim())
    .filter(Boolean)
    .join("\n\n");
};

export const runOnboardingTurn = async (input: OnboardingTurnInput): Promise<OnboardingTurnResult> => {
  const { identity, deps = {} } = input;
  const clock = deps.now ?? (() => new Date());
  const sessions = deps.sessions ?? createOnboardingSessionStore();
  const message = input.message?.trim() || undefined;

  const session = await sessions.start(identity);
  const before = readChecklist(session.checklist);
  const startSection = currentSection(before);
  const receivedAt = clock().toISOString();

  const facts = await (deps.loadFacts ?? loadOnboardingFacts)(identity.companyId);
  const financials = deps.financials ?? createFinancialSession(identity.companyId);
  const numerical = await loadFinancialSnapshot(financials);

  const turn = createTurnBuffer({
    sessions,
    contracts: deps.contracts ?? createCommunicationContractStore(),
    assumptions: deps.assumptions ?? {
      set: (companyId, key, value) => setCompanyAssumption(companyId, key, value, "onboarding"),
    },
    companies: deps.companies ?? { saveProfile: saveCompanyProfile },
  });

  const capability: OnboardingCapability = {
    sessionId: session.id,
    ...turn.stores,
    facts,
    // Fixed at the start of the turn: a section Sam opens during this turn has
    // not been asked about yet, so none of its questions can be answered.
    answerableSections: [...before.completedSections, ...(startSection ? [startSection.id] : [])],
  };

  const run = await runSamAgent({
    messages: toHistory(session.transcript, message),
    context: { ...identity, financials, onboarding: capability },
    systemPrompt: buildOnboardingSystemPrompt({
      facts,
      numerical,
      checklist: before,
      openItems: session.openItems,
      activeSeconds: activeInterviewSeconds([...session.transcript.map((entry) => entry.at), receivedAt]),
    }),
    tools: ONBOARDING_TOOLS,
    toolPolicies: ONBOARDING_TOOL_POLICIES,
    policy: { ...ONBOARDING_EXECUTION_POLICY, ...input.policy },
    // The prompt above is the whole context; this only hands over the snapshot
    // already loaded, so the harness does not read financial data twice.
    contextBuilder: {
      build: async () => ({ companyId: identity.companyId, thread: null, brief: null, directory: null, memories: [], numerical }),
    },
    model: input.model,
    signal: input.signal,
    runId: input.runId,
    observer: input.observer,
  });

  // A failed turn stores nothing - not its tool writes, not the conversation -
  // so the founder can simply say it again.
  if (!run.ok) {
    return {
      sessionId: session.id,
      outcome: run.outcome,
      ok: false,
      reply: "",
      currentSection: startSection?.id ?? null,
      completedSections: before.completedSections,
      onboardingComplete: startSection === null,
      extractions: [],
      choices: null,
    };
  }

  await turn.commit(identity, session.id);

  const latest = (await sessions.getCurrent(identity)) ?? session;
  const after = readChecklist(latest.checklist);
  const endSection = currentSection(after);
  const reply = turnReply(run.messages);

  let personalExtraction: ExtractionResult | undefined;
  if (message && startSection?.sensitive) {
    personalExtraction = await extractPersonalAnswer({
      founderId: identity.founderId,
      sessionId: session.id,
      text: message,
      at: receivedAt,
      deps,
    });
  }

  const personalTurn = Boolean(startSection?.sensitive || endSection?.sensitive);
  const turnMessages: OnboardingMessage[] = [];
  if (message) {
    turnMessages.push({
      role: "founder",
      text: message,
      sectionId: startSection?.id,
      sensitive: Boolean(startSection?.sensitive),
      at: receivedAt,
    });
  }
  if (reply) {
    turnMessages.push({
      role: "sam",
      text: reply,
      sectionId: (endSection ?? startSection)?.id,
      sensitive: personalTurn,
      at: clock().toISOString(),
    });
  }

  const stored =
    turnMessages.length > 0 ? await sessions.record(identity, session.id, { messages: turnMessages }) : latest;

  // Every closed section not yet consolidated - including one closed by an
  // earlier turn whose consolidation did not run.
  const extractions: ExtractionResult[] = [];
  for (const section of ONBOARDING_SECTIONS) {
    if (section.sensitive || !after.completedSections.includes(section.id)) continue;
    if (after.extractedSections.includes(section.id)) continue;

    const extraction = await extractSection({
      identity,
      sessionId: session.id,
      section,
      transcript: stored.transcript,
      deps,
    });
    extractions.push(extraction);

    await sessions.record(identity, session.id, {
      checklist: { [extractionEntryKey(section.id)]: { state: extraction.status, at: clock().toISOString() } },
    });
  }

  const offered = [...run.toolCalls].reverse().find((call) => call.name === "present_choices");
  const offeredId = (offered?.args as { questionId?: unknown } | undefined)?.questionId;
  const choices =
    typeof offeredId === "string" && isChoiceQuestionId(offeredId)
      ? { questionId: offeredId, options: ONBOARDING_CHOICES[offeredId] }
      : null;

  return {
    sessionId: session.id,
    outcome: run.outcome,
    ok: true,
    reply,
    currentSection: endSection?.id ?? null,
    completedSections: after.completedSections,
    onboardingComplete: endSection === null,
    extractions,
    personalExtraction,
    choices,
  };
};
