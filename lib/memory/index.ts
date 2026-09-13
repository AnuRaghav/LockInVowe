import { InMemoryThreadMemory } from "@/lib/memory/in-memory";
import { createSeededPersistentMemory } from "@/lib/memory/seed";
import type { PersistentMemory, ThreadMemory } from "@/lib/memory/types";
import { createSemanticPersistentMemory } from "@/lib/semantic/memory-adapter";
import { hasServiceCredentials } from "@/lib/supabase/service";

/**
 * Memory module.
 *
 * The rest of the app depends on the interfaces in `types.ts`; only this file
 * decides which implementation is wired in. That promise is now being cashed:
 * persistent memory is the durable Semantic Company Model, reached through an
 * adapter, and nothing that reads memory had to change to get it.
 */
export {
  InMemoryPersistentMemory,
  InMemoryThreadMemory,
} from "@/lib/memory/in-memory";
export { SEEDED_MEMORIES, createSeededPersistentMemory } from "@/lib/memory/seed";
export {
  MEMORY_KINDS,
  supportsMemoryHistory,
  type MemoryHistory,
  type MemoryKind,
  type MemoryQuery,
  type MemoryRecord,
  type MemoryRevision,
  type MemoryScope,
  type PersistentMemory,
  type ThreadMemory,
  type ThreadRef,
  type ThreadState,
} from "@/lib/memory/types";

let persistentMemory: PersistentMemory | null = null;
let threadMemory: ThreadMemory | null = null;

/**
 * The application's persistent memory: durable semantic state.
 *
 * Falls back to the in-process seeded stub when Supabase credentials are
 * absent, which keeps unit tests and `next build` working without a database.
 * The fallback is a development convenience and nothing more - it has no
 * revision history, so `supportsMemoryHistory()` is false against it and
 * anything asking "how has this changed?" correctly gets nothing rather than a
 * fabricated answer.
 */
export const getPersistentMemory = (): PersistentMemory =>
  (persistentMemory ??= hasServiceCredentials()
    ? createSemanticPersistentMemory()
    : createSeededPersistentMemory());

/** The application's working memory. Still process-local, by design. */
export const getThreadMemory = (): ThreadMemory =>
  (threadMemory ??= new InMemoryThreadMemory());
