import { InMemoryPersistentMemory } from "@/lib/memory/in-memory";
import { MEMORY_KINDS, type MemoryRecord } from "@/lib/memory/types";

/**
 * Seeded company knowledge for development and tests.
 *
 * TEMPORARY, and only here to prove the architecture end to end: a founder can
 * ask a question, the context builder can surface the right standing
 * constraint, and Sam can go looking for the rest. Delete this module the
 * moment a real persistent memory exists behind the same interface.
 */
export const SEEDED_MEMORIES: MemoryRecord[] = [
  {
    id: "mem_runway_floor",
    kind: MEMORY_KINDS.constraint,
    content: "Management requires the company to hold at least 12 months of runway at all times.",
    labels: ["runway", "policy"],
    importance: 0.9,
    source: "onboarding",
    recordedAt: "2026-01-15",
  },
  {
    id: "mem_raise_march",
    kind: MEMORY_KINDS.plan,
    content: "The company plans to raise a Series A in March.",
    labels: ["fundraising"],
    importance: 0.8,
    source: "onboarding",
    recordedAt: "2026-01-15",
  },
  {
    id: "mem_senior_engineer",
    kind: MEMORY_KINDS.decision,
    content: "A senior engineer hire is being considered for the platform team.",
    labels: ["hiring", "headcount"],
    importance: 0.5,
    source: "founder",
    recordedAt: "2026-02-02",
  },
];

/** Fallback id when no company is specified - only used by the no-DB dev/test stub. */
const FALLBACK_SEED_COMPANY_ID = "00000000-0000-4000-8000-000000000001";

/** A persistent memory preloaded with {@link SEEDED_MEMORIES} for one company. */
export const createSeededPersistentMemory = (
  companyId: string = FALLBACK_SEED_COMPANY_ID
): InMemoryPersistentMemory =>
  new InMemoryPersistentMemory({ [companyId]: SEEDED_MEMORIES });
