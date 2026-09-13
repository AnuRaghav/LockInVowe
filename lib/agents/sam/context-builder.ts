import type { SamRuntimeContext } from "@/lib/agents/sam/context";
import { memoryScope } from "@/lib/agents/sam/context";
import { getPersistentMemory, getThreadMemory } from "@/lib/memory";
import type {
  MemoryRecord,
  PersistentMemory,
  ThreadMemory,
  ThreadState,
} from "@/lib/memory/types";
import { ensureCompanyBrief, type CompanyBrief } from "@/lib/semantic/brief";
import { hasServiceCredentials } from "@/lib/supabase/service";

/**
 * The Context Builder.
 *
 * Sam does not own company knowledge and does not decide what it starts a turn
 * knowing. This module does: it takes the trusted runtime context plus the
 * founder's request, asks each provider what it has, and returns the
 * intentionally selected subset Claude will see on this invocation.
 *
 * What a turn opens with, and why each part is there:
 *
 *     thread state    what this conversation has established so far
 *   + company brief   baseline operating context, the same every turn
 *   + semantic blocks the current understanding relevant to *this* request
 *   + (later)         numerical model state, source-derived facts
 *
 * The brief and the blocks are doing different jobs and the distinction is the
 * point. The brief is what a CFO would already know walking in - it is paid for
 * on every run, so it is capped and synthesized. The blocks are what *this*
 * question needs, selected by relevance. Everything else stays reachable
 * through just-in-time retrieval during the loop, and is deliberately not here.
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
  /** Baseline operating context. `null` before a company has any state. */
  brief: CompanyBrief | null;
  /** Current company understanding judged relevant to this request. */
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
   * How many pieces of company understanding to open a turn with. Small on
   * purpose: the rest is reachable through just-in-time retrieval, and a
   * context window stuffed with everything the company knows is the failure
   * mode this whole boundary exists to avoid.
   */
  maxMemories?: number;
  /**
   * Supplies the company brief. Defaults to the materialized one, regenerated
   * only when the semantic state behind it has materially moved.
   */
  loadBrief?: (runtime: SamRuntimeContext) => Promise<CompanyBrief | null>;
}

const DEFAULT_MAX_MEMORIES = 3;

/**
 * The brief, when there is a database to hold one.
 *
 * Failing to load it must never fail a run: Sam without a brief is Sam with
 * less context, which is a worse answer rather than no answer. The run is
 * marked degraded upstream and the retrieval tools are still there.
 */
const defaultLoadBrief = async (
  runtime: SamRuntimeContext
): Promise<CompanyBrief | null> => {
  if (!hasServiceCredentials()) return null;

  try {
    const { brief } = await ensureCompanyBrief({
      scope: { companyId: runtime.companyId },
    });
    return brief;
  } catch {
    return null;
  }
};

export const createSamContextBuilder = ({
  persistentMemory,
  threadMemory,
  maxMemories = DEFAULT_MAX_MEMORIES,
  loadBrief = defaultLoadBrief,
}: CreateSamContextBuilderOptions = {}): SamContextBuilder => ({
  async build({ runtime, request }) {
    const persistent = persistentMemory ?? runtime.persistentMemory ?? getPersistentMemory();
    const threads = threadMemory ?? getThreadMemory();

    const [thread, brief, memories] = await Promise.all([
      runtime.threadId
        ? threads.load({ companyId: runtime.companyId, threadId: runtime.threadId })
        : Promise.resolve(null),
      loadBrief(runtime),
      // Relevance-selected, not "every current block". The brief already covers
      // what every conversation needs; this covers what *this* one needs.
      persistent.search(memoryScope(runtime), { text: request, limit: maxMemories }),
    ]);

    return { companyId: runtime.companyId, thread, brief, memories };
  },
});
