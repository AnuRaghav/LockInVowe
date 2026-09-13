import type {
  ReviseSemanticBlockInput,
  SemanticBlockWriter,
  SemanticScope,
} from "@/lib/semantic/types";

/**
 * A realistic company's semantic state, for development, demos, and tests.
 *
 * This exists so the read path, the brief, and Sam's context can be exercised
 * before the updater has ever run - and so the shape of a *good* block is
 * written down somewhere. A block should read like something a founder would
 * actually say about their company, not like a row: prose with numbers in it,
 * one coherent topic, no bullet lists of attributes.
 *
 * Hiring is seeded as three revisions on purpose. It is the worked example from
 * the design - "two engineers in Q4" becoming "maybe one" becoming "frozen
 * until the raise" - and having it in the seed means the difference between
 * current state and history is demonstrable the moment the schema is up.
 */

/** One step in a seeded company's story. */
export interface SeedRevision extends ReviseSemanticBlockInput {
  /** Required in seeds: a timeline nobody dated is not a timeline. */
  recordedAt: string;
}

const provenance = (kind: string, actor = "founder") => ({ kind, actor });

/**
 * The seeded story, in the order it happened.
 *
 * Ordering matters: `semantic_block_revise()` refuses to record a revision
 * before the one it follows, so this array is also an assertion that the story
 * is coherent.
 */
export const SEED_SEMANTIC_REVISIONS: SeedRevision[] = [
  {
    key: "financial-posture",
    title: "Financial posture",
    summary: "~$1.8M in the bank, ~$170K MRR, burning ~$210K/month.",
    body:
      "We hold roughly $1.8M in cash across operating and reserve accounts. MRR is about $170K and has grown 6-8% month over month for the last two quarters. Net burn is around $210K/month, most of it payroll. Gross margin sits near 76% and is stable. Management treats 12 months of runway as a floor, not a target - dropping below it triggers a plan, not a discussion.",
    labels: ["cash", "burn", "runway", "revenue", "policy"],
    salience: 0.95,
    contextPolicy: "always",
    confidence: 0.8,
    asOf: "2026-09-01",
    provenance: provenance("onboarding"),
    recordedAt: "2026-09-01T09:00:00Z",
    changeNote: "Established during onboarding.",
  },
  {
    key: "hiring",
    title: "Hiring",
    summary: "Two engineering hires planned for Q4.",
    body:
      "We plan to hire two engineers in Q4, both for the platform team, at roughly $205K fully loaded each. The intent is to unblock the enterprise roadmap rather than to add general capacity.",
    labels: ["hiring", "headcount", "engineering"],
    salience: 0.75,
    asOf: "2026-09-03",
    provenance: provenance("conversation"),
    recordedAt: "2026-09-03T14:30:00Z",
    changeNote: "Founder set out the Q4 hiring plan.",
  },
  {
    key: "fundraising",
    title: "Fundraising",
    summary: "Targeting a $8M Series A, first conversations in Q1.",
    body:
      "We intend to raise a Series A of about $8M, opening conversations in Q1 and aiming to close by mid-year. The story is enterprise traction, so the raise timeline is coupled to the enterprise launch landing well. We have not engaged a banker and do not intend to.",
    labels: ["fundraising", "series-a", "runway"],
    salience: 0.9,
    contextPolicy: "always",
    confidence: 0.6,
    asOf: "2026-09-10",
    provenance: provenance("conversation"),
    recordedAt: "2026-09-10T11:00:00Z",
  },
  {
    key: "enterprise-launch",
    title: "Enterprise launch",
    summary: "SSO, audit logs, and a security review, targeted at Q4.",
    body:
      "The enterprise tier ships in Q4: SSO, audit logging, and a completed SOC 2 Type I. Two deals in the pipeline are explicitly waiting on it. Slipping past Q4 would push the associated revenue into the next fiscal year and weaken the Series A story.",
    labels: ["product", "enterprise", "revenue", "roadmap"],
    salience: 0.8,
    asOf: "2026-09-10",
    provenance: provenance("conversation"),
    recordedAt: "2026-09-10T11:20:00Z",
  },
  {
    key: "infrastructure-migration",
    title: "Infrastructure migration",
    summary: "Moving off the legacy cluster; ~$18K/month of duplicate spend until done.",
    body:
      "We are midway through moving from the legacy Kubernetes cluster to managed infrastructure. Until the cutover completes we are paying for both, roughly $18K/month of duplicate spend. The team expects to finish in Q4, which would take monthly infrastructure cost from about $46K to about $28K.",
    labels: ["infrastructure", "costs", "engineering"],
    salience: 0.55,
    asOf: "2026-09-18",
    provenance: provenance("conversation", "cto"),
    recordedAt: "2026-09-18T16:00:00Z",
  },
  {
    key: "customer-acme",
    title: "Customer concentration: Acme",
    summary: "Acme is ~18% of MRR and renews in January.",
    body:
      "Acme accounts for roughly 18% of MRR, renewing in January. Their champion left in August and the new owner has not re-engaged. Losing them would cut MRR by about $31K/month and take roughly a month off runway. Nobody has yet been assigned to the relationship.",
    labels: ["customers", "revenue", "risk", "concentration"],
    salience: 0.85,
    asOf: "2026-09-22",
    provenance: provenance("conversation"),
    recordedAt: "2026-09-22T10:15:00Z",
  },
  // The worked example: one topic, three understandings, in sequence.
  {
    key: "hiring",
    title: "Hiring",
    summary: "Possibly one engineering hire in Q4, not two.",
    body:
      "We are reconsidering the two Q4 engineering hires and may only make one. The second is being weighed against how much runway we want to carry into the Series A conversations.",
    labels: ["hiring", "headcount", "engineering", "runway"],
    salience: 0.8,
    asOf: "2026-10-11",
    provenance: provenance("conversation"),
    changeNote: "Narrowed from two hires to possibly one, pending runway.",
    recordedAt: "2026-10-11T15:45:00Z",
  },
  {
    key: "hiring",
    title: "Hiring",
    summary: "Engineering hiring is frozen until the Series A closes.",
    body:
      "Engineering hiring is frozen until the Series A closes. Neither of the two Q4 platform hires will be made before then. The freeze is a deliberate runway decision, not a signal about the roadmap - the enterprise work is expected to ship with the current team. Backfills for departures are handled case by case and are not covered by the freeze.",
    labels: ["hiring", "headcount", "engineering", "runway", "fundraising"],
    salience: 0.9,
    contextPolicy: "always",
    asOf: "2026-11-04",
    provenance: provenance("conversation"),
    changeNote: "Hiring frozen until after the raise.",
    recordedAt: "2026-11-04T09:30:00Z",
  },
];

/**
 * Writes the seeded story through the real write path.
 *
 * Deliberately not raw inserts: seeding exercises `reviseBlock` exactly as the
 * updater will, so a seed that succeeds is evidence the write path works, and
 * the resulting history is a real history rather than a fabricated one.
 */
const FALLBACK_SEED_COMPANY_ID = "00000000-0000-4000-8000-000000000001";

export const seedSemanticBlocks = async (
  writer: SemanticBlockWriter,
  scope: SemanticScope = { companyId: FALLBACK_SEED_COMPANY_ID },
  revisions: SeedRevision[] = SEED_SEMANTIC_REVISIONS
): Promise<void> => {
  // Sequential, not `Promise.all`: these are revisions of shared topics, and
  // their order is the thing being seeded.
  for (const revision of revisions) {
    await writer.reviseBlock(scope, revision);
  }
};

/** Distinct topics in the seed, for tests that assert on the whole set. */
export const SEED_SEMANTIC_KEYS = [
  ...new Set(SEED_SEMANTIC_REVISIONS.map((revision) => revision.key)),
];
