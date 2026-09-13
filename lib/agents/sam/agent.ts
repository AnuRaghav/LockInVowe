import type { BaseMessage } from "@langchain/core/messages";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { createAgent } from "langchain";

import type { SamModelConfig } from "@/lib/agents/sam/config";
import { createSamModel } from "@/lib/agents/sam/model";
import { SAM_SYSTEM_PROMPT } from "@/lib/agents/sam/prompt";
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
    responseFormat: samAnswerSchema,
  });

export interface SamRunInput extends CreateSamAgentOptions {
  /** A single founder question, or a full conversation to continue. */
  messages: string | BaseMessage[];
}

export interface SamRunResult {
  /** Sam's final reply text. */
  text: string;
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

/**
 * Public entry point: ask Sam a question and get its reply plus the tool calls
 * it made along the way.
 */
export const runSamAgent = async ({
  messages,
  ...options
}: SamRunInput): Promise<SamRunResult> => {
  const agent = createSamAgent(options);
  const result = await agent.invoke({ messages: toMessages(messages) });

  return {
    text: finalText(result.messages),
    toolCalls: collectToolCalls(result.messages),
    messages: result.messages,
  };
};

/** Same as {@link runSamAgent}, but the reply is parsed into a typed answer. */
export const runSamAgentStructured = async ({
  messages,
  ...options
}: SamRunInput): Promise<SamStructuredRunResult> => {
  const agent = createStructuredSamAgent(options);
  const result = await agent.invoke({ messages: toMessages(messages) });

  return {
    text: result.structuredResponse.answer,
    toolCalls: collectToolCalls(result.messages),
    messages: result.messages,
    structured: result.structuredResponse,
  };
};
