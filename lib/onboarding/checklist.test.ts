import { describe, expect, it } from "vitest";

import {
  ONBOARDING_QUESTIONS,
  ONBOARDING_SECTIONS,
  activeInterviewSeconds,
  currentSection,
  questionEntryKey,
  questionsInSection,
  readChecklist,
  sectionById,
  sectionEntryKey,
  unresolvedCoreQuestions,
} from "@/lib/onboarding/checklist";

const at = "2026-09-14T09:00:00Z";

describe("onboarding checklist", () => {
  it("defines unique questions that all belong to a known section", () => {
    const ids = ONBOARDING_QUESTIONS.map((question) => question.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ONBOARDING_QUESTIONS.every((question) => sectionById(question.sectionId))).toBe(true);
  });

  it("keeps the personal section last and the only sensitive one", () => {
    expect(ONBOARDING_SECTIONS.filter((section) => section.sensitive).map((section) => section.id)).toEqual(["personal"]);
    expect(ONBOARDING_SECTIONS[ONBOARDING_SECTIONS.length - 1].id).toBe("personal");
  });

  it("asks about seventeen things outside the personal section, whatever is connected", () => {
    const core = (stripeConnected: boolean) =>
      ONBOARDING_SECTIONS.filter((section) => !section.sensitive).flatMap((section) =>
        unresolvedCoreQuestions(readChecklist({}), section.id, { stripeConnected })
      );
    expect(core(true)).toHaveLength(17);
    expect(core(false)).toHaveLength(17);
  });

  it("reads progress, ignoring entries it does not recognise", () => {
    const view = readChecklist({
      [questionEntryKey("what-you-sell")]: { state: "answered", at },
      [questionEntryKey("gross-margin")]: { state: "maybe", at },
      [sectionEntryKey("company-basics")]: { state: "complete", at },
      "section:not-a-section": { state: "complete", at },
      stray: 42,
    });

    expect(view.questions).toEqual({ "what-you-sell": "answered" });
    expect(view.completedSections).toEqual(["company-basics"]);
    expect(currentSection(view)?.id).toBe("company-position");
  });

  it("only asks revenue questions that fit what is connected", () => {
    const view = readChecklist({});
    const ids = (stripeConnected: boolean) =>
      unresolvedCoreQuestions(view, "company-basics", { stripeConnected }).map((question) => question.id);

    expect(ids(true)).toContain("revenue-representative");
    expect(ids(true)).not.toContain("current-revenue");
    expect(ids(false)).toContain("current-revenue");
    expect(ids(false)).not.toContain("revenue-representative");
  });

  it("never lists deferred questions as core", () => {
    expect(questionsInSection("company-basics").every((question) => question.tier === "core")).toBe(true);
    expect(questionsInSection("company-basics", "deferred").length).toBeGreaterThan(0);
  });

  it("counts active time, capping long gaps between turns", () => {
    expect(
      activeInterviewSeconds(["2026-09-14T09:00:00Z", "2026-09-14T09:00:40Z", "2026-09-14T11:00:00Z", "2026-09-14T11:00:30Z"])
    ).toBe(40 + 180 + 30);
    expect(activeInterviewSeconds([])).toBe(0);
  });
});
