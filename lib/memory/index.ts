import { InMemoryThreadMemory } from "@/lib/memory/in-memory";
import { createSeededPersistentMemory } from "@/lib/memory/seed";
import type { PersistentMemory, ThreadMemory } from "@/lib/memory/types";

/**
 * Memory module.
 *
 * The rest of the app depends on the interfaces in `types.ts`; only this file
 * decides which implementation is wired in. Swapping the stub for a real
 * backend is a change here and nowhere else.
 */
export {
  InMemoryPersistentMemory,
  InMemoryThreadMemory,
} from "@/lib/memory/in-memory";
export { SEEDED_MEMORIES, createSeededPersistentMemory } from "@/lib/memory/seed";
export {
  MEMORY_KINDS,
  type MemoryKind,
  type MemoryQuery,
  type MemoryRecord,
  type MemoryScope,
  type PersistentMemory,
  type ThreadMemory,
  type ThreadRef,
  type ThreadState,
} from "@/lib/memory/types";

let persistentMemory: PersistentMemory | null = null;
let threadMemory: ThreadMemory | null = null;

/**
 * The application's persistent memory.
 *
 * TEMPORARY: an in-process stub with seeded knowledge, so the harness runs
 * before any storage decision is made.
 */
export const getPersistentMemory = (): PersistentMemory =>
  (persistentMemory ??= createSeededPersistentMemory());

/** The application's working memory. Also process-local for now. */
export const getThreadMemory = (): ThreadMemory =>
  (threadMemory ??= new InMemoryThreadMemory());
