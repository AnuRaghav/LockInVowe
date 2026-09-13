import { beforeEach, describe, expect, it } from "vitest";

import {
  BRIEF_SALIENCE_FLOOR,
  briefFingerprint,
  briefIsStale,
  createDeterministicBriefWriter,
  ensureCompanyBrief,
  fitBrief,
  selectBriefBlocks,
} from "@/lib/semantic/brief";
import type {
  BriefSection,
  CompanyBrief,
  CompanyBriefStore,
  CompanyBriefWriter,
  SaveCompanyBriefInput,
} from "@/lib/semantic/brief";
import { InMemorySemanticBlockStore } from "@/lib/semantic/in-memory";
import type { SemanticBlockStore } from "@/lib/semantic/types";

/**
 * The company brief.
 *
 * Two properties carry the design: only load-bearing state reaches the
 * baseline, and the brief is rebuilt when - and only when - that state moves.
 * Both are tested with a deterministic writer, because neither is a claim about
 * how well a model writes prose.
 */

const SCOPE = { companyId: "company_brief_test" };

class InMemoryBriefStore implements CompanyBriefStore {
  private briefs: CompanyBrief[] = [];
  /** How many times a brief was actually written. */
  writes = 0;

  async getCurrent(): Promise<CompanyBrief | null> {
    return this.briefs[this.briefs.length - 1] ?? null;
  }

  async save(_scope: unknown, input: SaveCompanyBriefInput): Promise<CompanyBrief> {
    this.writes += 1;
    const brief: CompanyBrief = {
      ...input,
      id: `brief_${this.briefs.length + 1}`,
      version: this.briefs.length + 1,
      generatedAt: new Date().toISOString(),
    };
    this.briefs.push(brief);
    return brief;
  }
}

let store: SemanticBlockStore;
let briefs: InMemoryBriefStore;
const writer: CompanyBriefWriter = createDeterministicBriefWriter();

const ensure = (overrides: Partial<Parameters<typeof ensureCompanyBrief>[0]> = {}) =>
  ensureCompanyBrief({ scope: SCOPE, reader: store, briefs, writer, ...overrides });

beforeEach(async () => {
  store = new InMemorySemanticBlockStore();
  briefs = new InMemoryBriefStore();

  await store.reviseBlock(SCOPE, {
    key: "financial-posture",
    title: "Financial posture",
    summary: "~$1.8M in the bank, ~$170K MRR, burning ~$210K/month.",
    body: "The company holds roughly $1.8M in cash. MRR is about $170K and net burn is around $210K/month.",
    salience: 0.95,
    contextPolicy: "always",
  });

  await store.reviseBlock(SCOPE, {
    key: "hiring",
    title: "Hiring",
    summary: "Engineering hiring is frozen until the Series A closes.",
    body: "Engineering hiring is frozen until the Series A closes.",
    salience: 0.9,
    contextPolicy: "always",
  });

  await store.reviseBlock(SCOPE, {
    key: "infrastructure-migration",
    title: "Infrastructure migration",
    summary: "Duplicate infrastructure spend of ~$18K/month until cutover.",
    body: "The move off the legacy cluster is mid-flight, costing ~$18K/month in duplicate spend.",
    salience: 0.55,
  });

  await store.reviseBlock(SCOPE, {
    key: "office-move",
    title: "Office move",
    body: "The team is considering a smaller office when the lease ends.",
    salience: 0.2,
    contextPolicy: "background",
  });
});

describe("selectBriefBlocks", () => {
  it("takes what is standing or load-bearing, and leaves the rest retrievable", async () => {
    const selected = await selectBriefBlocks(store, SCOPE);

    expect(selected.map((block) => block.key)).toEqual(["financial-posture", "hiring"]);
    // Not in the baseline - but still findable when a question is about it.
    expect(
      (await store.searchCurrentBlocks(SCOPE, { text: "infrastructure migration" }))[0].key
    ).toBe("infrastructure-migration");
  });

  it("admits a salient block that was never marked 'always'", async () => {
    await store.reviseBlock(SCOPE, {
      key: "customer-acme",
      title: "Customer concentration: Acme",
      body: "Acme is ~18% of MRR and renews in January.",
      salience: BRIEF_SALIENCE_FLOOR,
    });

    const selected = await selectBriefBlocks(store, SCOPE);
    expect(selected.map((block) => block.key)).toContain("customer-acme");
  });

  it("excludes background blocks however salient they claim to be", async () => {
    await store.reviseBlock(SCOPE, {
      key: "office-move",
      title: "Office move",
      body: "The team is considering a smaller office when the lease ends.",
      salience: 0.99,
      contextPolicy: "background",
    });

    const selected = await selectBriefBlocks(store, SCOPE);
    expect(selected.map((block) => block.key)).not.toContain("office-move");
  });
});

describe("ensureCompanyBrief", () => {
  it("generates a brief from the qualifying state", async () => {
    const { brief, regenerated } = await ensure();

    expect(regenerated).toBe(true);
    expect(brief?.version).toBe(1);
    expect(brief?.body).toContain("$1.8M");
    expect(brief?.body).toContain("frozen until the Series A closes");
    // Not a dump of everything the company knows.
    expect(brief?.body).not.toContain("smaller office");
  });

  it("does not regenerate when nothing material has moved", async () => {
    await ensure();
    const second = await ensure();

    expect(second.regenerated).toBe(false);
    expect(briefs.writes).toBe(1);
  });

  it("does not regenerate for a change to a block outside the baseline", async () => {
    await ensure();

    await store.reviseBlock(SCOPE, {
      key: "office-move",
      title: "Office move",
      body: "The team has picked a smaller office for when the lease ends.",
      salience: 0.2,
      contextPolicy: "background",
    });

    expect((await ensure()).regenerated).toBe(false);
    expect(briefs.writes).toBe(1);
  });

  it("regenerates when a baseline topic changes", async () => {
    await ensure();

    await store.reviseBlock(SCOPE, {
      key: "hiring",
      title: "Hiring",
      summary: "Hiring has reopened; two platform roles are live.",
      body: "The freeze is lifted and two platform roles are open.",
      salience: 0.9,
      contextPolicy: "always",
    });

    const { brief, regenerated } = await ensure();

    expect(regenerated).toBe(true);
    expect(brief?.version).toBe(2);
    expect(brief?.body).toContain("reopened");
    expect(brief?.body).not.toContain("frozen");
  });

  it("regenerates when a block is promoted into the baseline", async () => {
    await ensure();

    await store.reviseBlock(SCOPE, {
      key: "infrastructure-migration",
      title: "Infrastructure migration",
      summary: "Duplicate infrastructure spend of ~$18K/month until cutover.",
      body: "The move off the legacy cluster is mid-flight, costing ~$18K/month in duplicate spend.",
      salience: 0.8,
    });

    const { brief, regenerated } = await ensure();

    expect(regenerated).toBe(true);
    expect(brief?.body).toContain("$18K/month");
  });

  it("regenerates when a baseline topic is archived away", async () => {
    await ensure();

    await store.reviseBlock(SCOPE, {
      key: "hiring",
      title: "Hiring",
      body: "Engineering hiring is frozen until the Series A closes.",
      status: "resolved",
      salience: 0.9,
      contextPolicy: "always",
    });

    const { brief, regenerated } = await ensure();

    expect(regenerated).toBe(true);
    expect(brief?.body).not.toContain("frozen");
  });

  it("returns nothing rather than inventing a brief from an empty company", async () => {
    const empty = await ensureCompanyBrief({
      scope: { companyId: "company_with_no_state" },
      reader: store,
      briefs,
      writer,
    });

    expect(empty.brief).toBeNull();
    expect(briefs.writes).toBe(0);
  });

  it("regenerates on demand even when nothing moved", async () => {
    await ensure();
    expect((await ensure({ force: true })).regenerated).toBe(true);
    expect(briefs.writes).toBe(2);
  });
});

describe("briefIsStale", () => {
  it("ignores a change that would not alter what the brief says", async () => {
    const blocks = await selectBriefBlocks(store, SCOPE);
    const fingerprint = briefFingerprint(blocks);

    expect(briefFingerprint([...blocks].reverse())).toBe(fingerprint);
    expect(briefIsStale(null, blocks)).toBe(true);
  });
});

describe("fitBrief", () => {
  const section = (heading: string, length: number): BriefSection => ({
    heading,
    body: "x".repeat(length),
  });

  it("keeps the brief inside its budget by dropping the least important sections", () => {
    const { sections, body } = fitBrief(
      [section("First", 300), section("Second", 300), section("Third", 300)],
      700
    );

    expect(sections.map((entry) => entry.heading)).toEqual(["First", "Second"]);
    expect(body.length).toBeLessThanOrEqual(700);
  });

  it("never emits a half-sentence when a single section is too long", () => {
    const { sections, body } = fitBrief(
      [{ heading: "Only", body: "One sentence. Another sentence. A third one." }],
      30
    );

    expect(sections).toHaveLength(1);
    expect(body.length).toBeLessThanOrEqual(30);
    expect(body.trimEnd().endsWith(".")).toBe(true);
  });
});
