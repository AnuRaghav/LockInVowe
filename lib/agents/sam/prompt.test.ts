import { describe, expect, it } from "vitest";

import { SAM_SYSTEM_PROMPT, buildSamSystemPrompt } from "@/lib/agents/sam/prompt";
import type { SamInitialContext } from "@/lib/agents/sam/context-builder";

describe("Sam system prompt", () => {
  it("states the authority model for actuals, projections, management context, and conversation claims", () => {
    expect(SAM_SYSTEM_PROMPT).toContain("source_evidence is what a connected provider reported");
    expect(SAM_SYSTEM_PROMPT).toContain("financial_actual is the Numerical Model's deterministic interpretation");
    expect(SAM_SYSTEM_PROMPT).toContain("Use financial_actual as the authoritative financial interpretation");
    expect(SAM_SYSTEM_PROMPT).toContain("financial_projection is a conditional consequence");
    expect(SAM_SYSTEM_PROMPT).toContain("management_context is the company's current understanding");
    expect(SAM_SYSTEM_PROMPT).toContain("conversation_claim is what the founder is saying");
    expect(SAM_SYSTEM_PROMPT).toContain("cannot override source_evidence or financial_actual");
    expect(SAM_SYSTEM_PROMPT).toContain("an explicit founder correction or decision in the current conversation supersedes older stored memory");
  });

  it("explains post-turn semantic memory updates without promising persistence", () => {
    expect(SAM_SYSTEM_PROMPT).toContain("Normal conversations can update persistent company memory after the turn completes");
    expect(SAM_SYSTEM_PROMPT).toContain("do not say they have already been saved or guarantee they will be persisted");
  });

  it("tells Sam not to expose implementation details", () => {
    expect(SAM_SYSTEM_PROMPT).toContain("Do not expose implementation details");
    expect(SAM_SYSTEM_PROMPT).toContain("Explain evidence, sources, assumptions, and reasoning in natural product language instead");
  });

  it("keeps dynamic context separated from durable instructions", () => {
    const context: SamInitialContext = {
      companyId: "company-1",
      thread: null,
      brief: {
        id: "brief-1",
        version: 1,
        body: "Hiring is paused until the raise closes.",
        sections: [{ heading: "Hiring", body: "Hiring is paused until the raise closes." }],
        fingerprint: "fingerprint-1",
        generatedAt: "2026-09-13T00:00:00Z",
        sourceBlockIds: ["block-1"],
        generator: { kind: "deterministic" },
      },
      directory: null,
      operating: null,
      numerical: { status: "unavailable", reason: "context_not_loaded" },
    };

    const prompt = buildSamSystemPrompt(context);

    expect(prompt).toContain(`${SAM_SYSTEM_PROMPT}\n\n---\n\nNUMERICAL MODEL`);
    expect(prompt).toContain("COMPANY BRIEF [management_context]");
    expect(prompt).toContain("Hiring is paused until the raise closes.");
  });
});
