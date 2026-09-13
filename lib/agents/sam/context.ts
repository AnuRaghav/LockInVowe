import { z } from "zod";

import type { MemoryScope, PersistentMemory } from "@/lib/memory/types";
import type { FinancialSession } from "@/lib/finance/session";
import { createFinancialSession, FinancialDataUnavailable } from "@/lib/finance/session";
import { isOnboardingCapability, type OnboardingCapability } from "@/lib/onboarding/capability";

const isPersistentMemory = (value: unknown): value is PersistentMemory =>
  typeof (value as PersistentMemory | undefined)?.search === "function" &&
  typeof (value as PersistentMemory | undefined)?.get === "function";

/**
 * Trusted, server-supplied execution context for a Sam run.
 *
 * Everything in here is resolved by the application *before* the agent starts
 * and is never exposed to the model. Claude picks *which tool* to call; the
 * application picks *which company that tool operates on*. Keeping the two
 * apart is what stops a prompt-injected or hallucinated `companyId` from
 * reaching the data layer.
 *
 * Two sorts of thing live here, and the distinction is worth keeping:
 *
 * - *Identity* (`companyId`, `founderId`, `threadId`): who this run is for.
 *   Grows with the product - role, locale. Add fields here, never to a tool's
 *   argument schema.
 * - *Capabilities* (`persistentMemory`): handles a tool needs at call time.
 *   Injected so a run can be pointed at a different backend without any tool
 *   knowing which one it got.
 */
export const samRuntimeContextSchema = z.object({
  companyId: z
    .string()
    .min(1, "companyId is required for every Sam run.")
    .describe("The company every tool in this run reads and writes."),
  founderId: z
    .string()
    .min(1)
    .optional()
    .describe(
      "The person this run serves. Scopes founder profile and communication preferences, which are never read through companyId."
    ),
  threadId: z
    .string()
    .min(1)
    .optional()
    .describe(
      "The conversation this run belongs to. Scopes working memory; absent for one-off runs."
    ),
  persistentMemory: z
    .custom<PersistentMemory>(isPersistentMemory)
    .optional()
    .describe(
      "Long-lived company knowledge the retrieval tools read. Defaults to the application's memory module."
    ),
  onboarding: z
    .custom<OnboardingCapability>(isOnboardingCapability)
    .optional()
    .describe("Trusted onboarding-session capability. Present only for onboarding runs; never supplied by the model."),
  financials: z.custom<FinancialSession>((value) =>
    typeof value?.companyId === "string" && typeof value?.read === "function"
  ).optional().describe("Trusted run-local Numerical Model capability; never supplied by the model."),
  runId: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Unique id for this execution. Set by the harness; a tool that mutates company state should derive its idempotency key from it so a retried attempt is not applied twice."
    ),
  requestId: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Id of the originating request. Equals runId unless the caller supplied one, so a retried *request* stays traceable to one intent."
    ),
});

export type SamRuntimeContext = z.infer<typeof samRuntimeContextSchema>;

/** @deprecated Use {@link samRuntimeContextSchema}. */
export const samContextSchema = samRuntimeContextSchema;
/** @deprecated Use {@link SamRuntimeContext}. */
export type SamContext = SamRuntimeContext;

/** Thrown when a tool runs without usable company context. */
export class MissingSamContextError extends Error {
  constructor(toolName: string) {
    super(
      `Tool "${toolName}" ran without a valid Sam context. Pass \`context\` to runSamAgent().`
    );
    this.name = "MissingSamContextError";
  }
}

/**
 * Reads the trusted context inside a tool.
 *
 * LangChain injects the context object given to `agent.invoke(..., { context })`
 * as `runtime.context`. This re-validates it at the point of use so a tool can
 * never silently operate on `undefined`.
 *
 * @throws {MissingSamContextError} when the context is absent or malformed.
 */
export const requireSamContext = (
  runtime: { context?: unknown },
  toolName: string
): SamRuntimeContext => {
  const parsed = samRuntimeContextSchema.safeParse(runtime?.context);
  if (!parsed.success) throw new MissingSamContextError(toolName);
  return parsed.data;
};

/** Enforce scope even for injected capabilities; defaults support direct agent/tool invocation. */
export const financialSession = (context: SamRuntimeContext): FinancialSession => {
  if (context.financials && context.financials.companyId !== context.companyId)
    throw new FinancialDataUnavailable("scope_mismatch");
  return context.financials ?? createFinancialSession(context.companyId);
};

/** The company scope every memory read is confined to. */
export const memoryScope = ({ companyId }: SamRuntimeContext): MemoryScope => ({
  companyId,
});
