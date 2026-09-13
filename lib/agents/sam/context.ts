import { z } from "zod";

/**
 * Trusted, server-supplied execution context for a Sam run.
 *
 * Everything in here is resolved by the application *before* the agent starts
 * and is never exposed to the model. Claude picks *which tool* to call; the
 * application picks *which company that tool operates on*. Keeping the two
 * apart is what stops a prompt-injected or hallucinated `companyId` from
 * reaching the data layer.
 *
 * Grows with the product (userId, role, locale, ...). Add fields here, never
 * to a tool's argument schema.
 */
export const samContextSchema = z.object({
  companyId: z
    .string()
    .min(1, "companyId is required for every Sam run.")
    .describe("The company every tool in this run reads and writes."),
});

export type SamContext = z.infer<typeof samContextSchema>;

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
): SamContext => {
  const parsed = samContextSchema.safeParse(runtime?.context);
  if (!parsed.success) throw new MissingSamContextError(toolName);
  return parsed.data;
};
