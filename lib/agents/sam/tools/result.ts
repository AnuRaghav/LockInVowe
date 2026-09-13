/**
 * One serialization + error shape for every Sam tool.
 *
 * Tools return a JSON string, so the model sees a stable envelope whether the
 * call succeeded or not. Failures are returned rather than thrown: an
 * exception aborts the agent run, while an `ok: false` payload lets Sam
 * explain the problem or ask the founder for the missing input.
 */
export type SamToolPayload =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

export const toolSuccess = (data: unknown): string =>
  JSON.stringify({ ok: true, data } satisfies SamToolPayload);

export const toolFailure = (error: string): string =>
  JSON.stringify({ ok: false, error } satisfies SamToolPayload);

/**
 * Wraps a tool body so domain errors come back as `ok: false` instead of
 * killing the run. Use this in every tool adapter.
 */
export const runTool = async (
  execute: () => unknown | Promise<unknown>
): Promise<string> => {
  try {
    return toolSuccess(await execute());
  } catch (error) {
    return toolFailure(
      error instanceof Error ? error.message : "Unknown tool error."
    );
  }
};
