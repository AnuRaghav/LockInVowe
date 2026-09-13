import type { SamRuntimeContext } from "@/lib/agents/sam/context";
import { financialSession, memoryScope } from "@/lib/agents/sam/context";
import {
  loadOperatingState,
  operatingHeadline,
  type OperatingHeadline,
} from "@/lib/company/operating";
import { loadFinancialSnapshot, type FinancialSnapshot } from "@/lib/finance/sam-surface";
import { getPersistentMemory, getThreadMemory, supportsMemoryDirectory } from "@/lib/memory";
import type {
  MemoryDirectory,
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
 *     numerical       qualified Source-derived actuals, separate from beliefs
 *   + company brief   baseline operating context, the same every turn
 *   + directory       every topic the company has an understanding of, by name
 *   + operating       the stated plan's headline: floors, hires, headcount
 *   + thread state    what this conversation has established so far
 *
 * The distinction between the brief and the directory is the point, and it is
 * the orientation/detail split:
 *
 * - The **brief** is what a CFO would already know walking in. Synthesized,
 *   capped, paid for on every run.
 * - The **directory** is what a CFO would know *exists*. One line per topic:
 *   the id, what it covers, and how current it is - never the body.
 *
 * Until 2026-09 the second slot held the top three semantic blocks a lexical
 * search matched against the founder's wording. That created the failure this
 * layer exists to prevent: a block neither salient enough for the brief nor
 * matched by the question's words was invisible, so Sam could not choose to
 * retrieve it and answered without the company's own plan. A complete index of
 * titles costs less than three bodies and removes the guess entirely - Sam sees
 * that `hiring` exists and calls `get_memory` because it decided to, not
 * because a prefix matched.
 *
 * Two properties matter more than anything it currently does:
 *
 * - It returns *structured* context. Formatting for the model happens once, at
 *   the boundary where Claude is invoked (`prompt.ts`), so the pieces stay
 *   inspectable and testable as data.
 * - It is a dependency of the agent, not logic inside it. `agent.ts` never
 *   learns how any of this was retrieved.
 */

/** The model context assembled for a single Sam invocation. */
export interface SamInitialContext {
  companyId: string;
  /** Working state for this conversation, or `null` for a new one. */
  thread: ThreadState | null;
  /** Baseline operating context. `null` before a company has any state. */
  brief: CompanyBrief | null;
  /**
   * Every topic the company currently understands, by id and one-liner.
   *
   * `null` when the memory backend cannot enumerate; the retrieval tools still
   * work, so Sam falls back to `search_memory` rather than losing the layer.
   */
  directory: MemoryDirectory | null;
  /** Source-derived facts, never semantic beliefs. Optional for custom builders. */
  numerical?: FinancialSnapshot;
  /** The stated operating plan's headline. `null` when it cannot be reached. */
  operating?: OperatingHeadline | null;
}

export interface SamContextRequest {
  /** Trusted runtime context. Resolved before the run; never model-supplied. */
  runtime: SamRuntimeContext;
  /**
   * What the founder just asked.
   *
   * No longer used to select which company knowledge is injected - the
   * directory is complete and unconditioned on wording. Kept because a builder
   * may still want it, and because removing it from the interface would break
   * every custom builder for no gain.
   */
  request: string;
}

export interface SamContextBuilder {
  build(request: SamContextRequest): Promise<SamInitialContext>;
}

export interface CreateSamContextBuilderOptions {
  persistentMemory?: PersistentMemory;
  threadMemory?: ThreadMemory;
  /**
   * How many topics the directory may list.
   *
   * Generous on purpose: the whole value is that Sam can see everything the
   * company has an opinion about, and a line per topic is cheap. Past this the
   * directory reports itself truncated and `search_memory` becomes the way to
   * reach the rest, rather than entries vanishing silently.
   */
  maxDirectoryEntries?: number;
  /**
   * Supplies the company brief. Defaults to the materialized one, regenerated
   * only when the semantic state behind it has materially moved.
   */
  loadBrief?: (runtime: SamRuntimeContext) => Promise<CompanyBrief | null>;
  /** Supplies the stated operating plan. Defaults to the stored company plan. */
  loadOperating?: (runtime: SamRuntimeContext) => Promise<OperatingHeadline | null>;
}

const DEFAULT_MAX_DIRECTORY_ENTRIES = 40;

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

/**
 * The stated operating plan's headline.
 *
 * Same contract as the brief: absent rather than fatal. A founder is far better
 * served by an answer that says the hiring plan could not be read than by an
 * error, and `get_company_plan` can still be called mid-loop.
 */
const defaultLoadOperating = async (
  runtime: SamRuntimeContext
): Promise<OperatingHeadline | null> => {
  if (!hasServiceCredentials()) return null;

  try {
    return operatingHeadline(await loadOperatingState(runtime.companyId));
  } catch {
    return null;
  }
};

/**
 * The directory, when the backend can enumerate.
 *
 * A backend without `list` is not an error - the seeded development stub and
 * any future document store may not have it - so the section is simply absent
 * and Sam is told to search instead.
 */
const loadDirectory = async (
  memory: PersistentMemory,
  runtime: SamRuntimeContext,
  limit: number
): Promise<MemoryDirectory | null> => {
  if (!supportsMemoryDirectory(memory)) return null;

  try {
    return await memory.list(memoryScope(runtime), { limit });
  } catch {
    return null;
  }
};

export const createSamContextBuilder = ({
  persistentMemory,
  threadMemory,
  maxDirectoryEntries = DEFAULT_MAX_DIRECTORY_ENTRIES,
  loadBrief = defaultLoadBrief,
  loadOperating = defaultLoadOperating,
}: CreateSamContextBuilderOptions = {}): SamContextBuilder => ({
  async build({ runtime }) {
    const persistent = persistentMemory ?? runtime.persistentMemory ?? getPersistentMemory();
    const threads = threadMemory ?? getThreadMemory();

    const [thread, brief, directory, operating, numerical] = await Promise.all([
      runtime.threadId
        ? threads.load({ companyId: runtime.companyId, threadId: runtime.threadId })
        : Promise.resolve(null),
      loadBrief(runtime),
      loadDirectory(persistent, runtime, maxDirectoryEntries),
      loadOperating(runtime),
      loadFinancialSnapshot(financialSession(runtime)),
    ]);

    return { companyId: runtime.companyId, thread, brief, directory, operating, numerical };
  },
});
