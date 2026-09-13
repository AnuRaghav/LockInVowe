import type { SamRuntimeContext } from "@/lib/agents/sam/context";
import { memoryScope } from "@/lib/agents/sam/context";
import { getPersistentMemory, getThreadMemory } from "@/lib/memory";
import type {
  MemoryRecord,
  PersistentMemory,
  ThreadMemory,
  ThreadState,
} from "@/lib/memory/types";

/**
 * The Context Builder.
 *
 * Sam does not own company knowledge and does not decide what it starts a turn
 * knowing. This module does: it takes the trusted runtime context plus the
 * founder's request, asks each memory module what it has, and returns the
 * intentionally selected subset Claude will see on this invocation.
 *
 * Two properties matter more than anything it currently does:
 *
 * - It returns *structured* context. Formatting for the model happens once, at
 *   the boundary where Claude is invoked (`prompt.ts`), so the pieces stay
 *   inspectable and testable as data.
 * - It is a dependency of the agent, not logic inside it. `agent.ts` never
 *   learns how any of this was retrieved, which is what lets numerical state
 *   and source-derived facts join later as extra fields here and nothing else.
 */

/** The model context assembled for a single Sam invocation. */
export interface SamInitialContext {
  companyId: string;
  /** Working state for this conversation, or `null` for a new one. */
  thread: ThreadState | null;
  /** Long-lived company knowledge judged relevant to this request. */
  memories: MemoryRecord[];
  // Future providers land here as sibling fields - `numerical`, `sourceFacts` -
  // behind the same interface, with no change to Sam.
}

export interface SamContextRequest {
  /** Trusted runtime context. Resolved before the run; never model-supplied. */
  runtime: SamRuntimeContext;
  /** What the founder just asked, used to decide what is worth including. */
  request: string;
}

export interface SamContextBuilder {
  build(request: SamContextRequest): Promise<SamInitialContext>;
}

export interface CreateSamContextBuilderOptions {
  persistentMemory?: PersistentMemory;
  threadMemory?: ThreadMemory;
  /**
   * How many persistent memories to open a turn with. Small on purpose: the
   * rest is reachable through just-in-time retrieval, and a context window
   * stuffed with everything the company knows is the failure mode this whole
   * boundary exists to avoid.
   */
  maxMemories?: number;
}

const DEFAULT_MAX_MEMORIES = 3;

export const createSamContextBuilder = ({
  persistentMemory,
  threadMemory,
  maxMemories = DEFAULT_MAX_MEMORIES,
}: CreateSamContextBuilderOptions = {}): SamContextBuilder => ({
  async build({ runtime, request }) {
    const persistent = persistentMemory ?? runtime.persistentMemory ?? getPersistentMemory();
    const threads = threadMemory ?? getThreadMemory();

    const [thread, memories] = await Promise.all([
      runtime.threadId
        ? threads.load({ companyId: runtime.companyId, threadId: runtime.threadId })
        : Promise.resolve(null),
      persistent.search(memoryScope(runtime), { text: request, limit: maxMemories }),
    ]);

    return { companyId: runtime.companyId, thread, memories };
  },
});
