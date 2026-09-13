import {
  ONBOARDING_SECTIONS,
  currentSection,
  readChecklist,
  type OnboardingSectionId,
} from "@/lib/onboarding/checklist";
import type { OnboardingSession } from "@/lib/onboarding/sessions";

/**
 * The interview as the onboarding UI shows it.
 *
 * Personal turns carry no text - there is none to show, because none was kept.
 * The UI renders them as a placeholder that says so.
 */

export interface InterviewTurnView {
  role: "founder" | "sam";
  /** `null` for a personal turn: its text was never stored. */
  text: string | null;
  personal: boolean;
  at: string;
}

export interface InterviewSectionView {
  id: OnboardingSectionId;
  title: string;
  state: "done" | "current" | "todo";
  personal: boolean;
}

export interface InterviewStateView {
  sessionId: string | null;
  sections: InterviewSectionView[];
  currentSection: OnboardingSectionId | null;
  onboardingComplete: boolean;
  transcript: InterviewTurnView[];
}

export const describeInterview = (session: OnboardingSession | null): InterviewStateView => {
  const view = readChecklist(session?.checklist ?? {});
  const current = currentSection(view);

  return {
    sessionId: session?.id ?? null,
    sections: ONBOARDING_SECTIONS.map((section) => ({
      id: section.id,
      title: section.title,
      state: view.completedSections.includes(section.id) ? "done" : section.id === current?.id ? "current" : "todo",
      personal: section.sensitive,
    })),
    currentSection: current?.id ?? null,
    onboardingComplete: session !== null && current === null,
    transcript: (session?.transcript ?? []).map((turn) => ({
      role: turn.role,
      text: "text" in turn ? turn.text : null,
      personal: !("text" in turn),
      at: turn.at,
    })),
  };
};
