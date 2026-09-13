import type { BaseMessage } from "@langchain/core/messages";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { createAgent } from "langchain";

import type { SamModelConfig } from "@/lib/agents/sam/config";
import {
  samRuntimeContextSchema,
  type SamRuntimeContext,
} from "@/lib/agents/sam/context";
import {
  createSamContextBuilder,
  type SamContextBuilder,
  type SamInitialContext,
} from "@/lib/agents/sam/context-builder";
import { createSamModel } from "@/lib/agents/sam/model";
import { SAM_SYSTEM_PROMPT, buildSamSystemPrompt } from "@/lib/agents/sam/prompt";
import { samAnswerSchema, type SamAnswer, type SamToolCall } from "@/lib/agents/sam/schemas";
import { SAM_TOOLS } from "@/lib/agents/sam/tools";

export interface CreateSamAgentOptions {
  /** Override model, key, token cap, or effort. Defaults come from the env. */
  model?: Partial<SamModelConfig>;
  /** Replace the tool registry. Mainly useful for tests. */
  tools?: typeof SAM_TOOLS;
  /** Replace the system prompt. Company context should be appended, not inlined. */
  systemPrompt?: string;
}

/**
 * Builds a Sam agent: a Claude model, the tool registry, and the system prompt.
 *
 * The model chooses which tools to call; the tools own every calculation.
 */
export const createSamAgent = ({
  model,
  tools = SAM_TOOLS,
  systemPrompt = SAM_SYSTEM_PROMPT,
}: CreateSamAgentOptions = {}) =>
  createAgent({
    model: createSamModel(model),
    tools,
    systemPrompt,
    contextSchema: samRuntimeContextSchema,
  });

/** Same agent, but constrained to return a typed {@link SamAnswer}. */
export const createStructuredSamAgent = ({
  model,
  tools = SAM_TOOLS,
  systemPrompt = SAM_SYSTEM_PROMPT,
}: CreateSamAgentOptions = {}) =>
  createAgent({
    model: createSamModel(model),
    tools,
    systemPrompt,
    contextSchema: samRuntimeContextSchema,
    responseFormat: samAnswerSchema,
  });

export interface SamRunInput extends CreateSamAgentOptions {
  /** A single founder question, or a full conversation to continue. */
  messages: string | BaseMessage[];
  /**
   * Trusted execution context, resolved by the caller before the run starts.
   *
   * This is the only way a company reaches a tool. It is never part of the
   * model's tool arguments, so Claude can choose *what* to call but never
   * *whose data* it touches.
   */
  context: SamRuntimeContext;
  /**
   * Decides what Sam starts the turn knowing.
   *
   * A first-class dependency, not logic inside the agent: swap it and Sam
   * opens with different memory, different numerical state, or different
   * source-derived facts, with nothing in this file changing.
   */
  contextBuilder?: SamContextBuilder;
}

export interface SamRunResult {
  /** Sam's final reply text. */
  text: string;
  /** The context the builder selected for this run, before formatting. */
  initialContext: SamInitialContext;
  /** Tools the agent invoked, in call order. */
  toolCalls: SamToolCall[];
  /** Full message history, for persisting or continuing the conversation. */
  messages: BaseMessage[];
}

export interface SamStructuredRunResult extends SamRunResult {
  structured: SamAnswer;
}

const toMessages = (messages: SamRunInput["messages"]): BaseMessage[] =>
  typeof messages === "string" ? [new HumanMessage(messages)] : messages;

const collectToolCalls = (messages: BaseMessage[]): SamToolCall[] =>
  messages
    .filter((message): message is AIMessage => message instanceof AIMessage)
    .flatMap((message) => message.tool_calls ?? [])
    .map(({ name, args }) => ({ name, args }));

const finalText = (messages: BaseMessage[]): string =>
  messages[messages.length - 1]?.text ?? "";

/** The founder's latest request - what the context builder selects against. */
const latestRequest = (messages: BaseMessage[]): string =>
  [...messages].reverse().find((message) => message instanceof HumanMessage)?.text ?? "";

/**
 * Resolves the trusted context, then hands it to the context builder.
 *
 * Structured context is turned into prompt text exactly here, at the boundary
 * where Claude is invoked, and nowhere earlier.
 */
const prepareRun = async ({
  messages,
  context,
  contextBuilder = createSamContextBuilder(),
  systemPrompt,
}: SamRunInput) => {
  const runtime = samRuntimeContextSchema.parse(context);
  const history = toMessages(messages);
  const initialContext = await contextBuilder.build({
    runtime,
    request: latestRequest(history),
  });

  return {
    runtime,
    history,
    initialContext,
    systemPrompt: systemPrompt ?? buildSamSystemPrompt(initialContext),
  };
};

/**
 * Public entry point: ask Sam a question and get its reply plus the tool calls
 * it made along the way.
 */
export const runSamAgent = async (input: SamRunInput): Promise<SamRunResult> => {
  const { runtime, history, initialContext, systemPrompt } = await prepareRun(input);
  const agent = createSamAgent({ model: input.model, tools: input.tools, systemPrompt });
  const result = await agent.invoke({ messages: history }, { context: runtime });

  return {
    text: finalText(result.messages),
    initialContext,
    toolCalls: collectToolCalls(result.messages),
    messages: result.messages,
  };
};

/** Same as {@link runSamAgent}, but the reply is parsed into a typed answer. */
export const runSamAgentStructured = async (
  input: SamRunInput
): Promise<SamStructuredRunResult> => {
  const { runtime, history, initialContext, systemPrompt } = await prepareRun(input);
  const agent = createStructuredSamAgent({
    model: input.model,
    tools: input.tools,
    systemPrompt,
  });
  const result = await agent.invoke({ messages: history }, { context: runtime });

  return {
    text: result.structuredResponse.answer,
    initialContext,
    toolCalls: collectToolCalls(result.messages),
    messages: result.messages,
    structured: result.structuredResponse,
  };
};
