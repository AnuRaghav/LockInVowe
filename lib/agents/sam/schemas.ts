import { z } from "zod";

/**
 * Typed answer shape for callers that need to branch on Sam's output rather
 * than render prose - e.g. deciding whether to prompt the founder for more
 * data, or surfacing assumptions in the UI.
 */
export const samAnswerSchema = z.object({
  answer: z
    .string()
    .describe("The answer for the founder, in plain language."),
  status: z
    .enum(["answered", "needs_more_info"])
    .describe(
      "'needs_more_info' when a tool could not be called because inputs were missing."
    ),
  assumptions: z
    .array(z.string())
    .describe(
      "Any assumption made about the company's numbers. Empty when every figure came from a tool result."
    ),
});

export type SamAnswer = z.infer<typeof samAnswerSchema>;

/** A tool the agent actually invoked during a run. */
export interface SamToolCall {
  name: string;
  args: Record<string, unknown>;
}
