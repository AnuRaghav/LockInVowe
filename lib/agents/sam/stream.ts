import {
  buildSamAgent,
  completedSamResult,
  executeSamRun,
  failedSamResult,
  prepareSamRun,
  type SamRunInput,
  type SamRunResult,
} from "@/lib/agents/sam/agent";
import type { SamRunEvent, SamRunObserver } from "@/lib/agents/sam/harness/events";

/**
 * Watching a Sam run while it happens.
 *
 * This is not a second agent. `streamSamAgent` and `runSamAgent` prepare the
 * same way, run through the same `executeSamRun`, and finish through the same
 * result assembly; streaming only means somebody is listening to the events the
 * harness already emits. There is nothing here that can drift from the
 * non-streaming path, because there is nothing here that executes.
 */

/** A minimal single-consumer queue bridging the observer into an iterator. */
class SamEventQueue {
  private readonly buffer: SamRunEvent[] = [];
  private waiting?: (event: SamRunEvent | null) => void;
  private closed = false;

  push(event: SamRunEvent): void {
    if (this.closed) return;

    const waiting = this.waiting;
    if (waiting) {
      this.waiting = undefined;
      waiting(event);
      return;
    }
    this.buffer.push(event);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;

    const waiting = this.waiting;
    if (waiting) {
      this.waiting = undefined;
      waiting(null);
    }
  }

  async *drain(): AsyncGenerator<SamRunEvent> {
    for (;;) {
      const buffered = this.buffer.shift();
      if (buffered) {
        yield buffered;
        continue;
      }
      if (this.closed) return;

      const next = await new Promise<SamRunEvent | null>((resolve) => {
        this.waiting = resolve;
      });
      if (next === null) continue;
      yield next;
    }
  }
}

/**
 * The stream a caller iterates: Sam's events as they happen, and the same
 * {@link SamRunResult} `runSamAgent` would have returned as the generator's
 * return value. The terminal `run_completed` / `run_terminated` event carries
 * the outcome too, so a `for await` consumer never needs the return value.
 */
export type SamRunStream = AsyncGenerator<SamRunEvent, SamRunResult, void>;

/**
 * Ask Sam a question and watch the run unfold.
 *
 * Events are Sam's own contract (`harness/events.ts`), never LangChain's.
 * Abandoning the iterator - a founder closing the tab, a `break` in a loop -
 * cancels the underlying run through the harness's own cancellation path, so a
 * consumer that walks away stops the spend.
 *
 * Like {@link runSamAgent}, this never throws for an execution failure; it
 * throws only for a malformed call, before the run starts.
 */
export async function* streamSamAgent(input: SamRunInput): SamRunStream {
  const queue = new SamEventQueue();
  const consumerAbort = new AbortController();
  const downstream = input.observer;

  // Every event already flows through the observer seam. Streaming taps it -
  // it does not introduce a second source of truth about the run.
  const observer: SamRunObserver = {
    record(event) {
      queue.push(event);
      downstream?.record(event);
    },
  };

  const prepared = await prepareSamRun({ ...input, observer }, consumerAbort.signal);

  const finished: Promise<SamRunResult> = (async () => {
    try {
      const state = await executeSamRun(
        buildSamAgent(input, prepared),
        prepared,
        (text) => prepared.recorder.emit("message_delta", { text })
      );
      return completedSamResult(prepared, state);
    } catch (error) {
      return failedSamResult(prepared, error);
    } finally {
      queue.close();
    }
  })();

  let drained = false;
  try {
    for await (const event of queue.drain()) yield event;
    drained = true;
  } finally {
    if (!drained) {
      consumerAbort.abort();
      await finished.catch(() => undefined);
    }
  }

  return await finished;
}
