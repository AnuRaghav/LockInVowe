import type { BriefWriteRequest } from "@/lib/semantic/brief/types";

/**
 * What the brief generator asks the model.
 *
 * The instruction that does the work is "synthesize, do not summarize each
 * block in turn". The obvious failure is a brief with one paragraph per block,
 * in block order, which is a table of contents wearing a brief's clothes: it
 * costs the same tokens on every run and tells Sam nothing it could not have
 * retrieved when it was actually relevant.
 *
 * The second instruction that matters is the ceiling. This text is paid for on
 * every single Sam run, so the budget is stated in the prompt *and* enforced
 * after generation - a model asked to be brief is not a guarantee of brevity.
 */
export const COMPANY_BRIEF_PROMPT = `You write the standing brief a CFO keeps in their head about one company.

You are given the company's current understanding of its most load-bearing topics. Produce a short brief that would make almost any financial conversation with this founder go better - the context a good CFO would already have before the question is asked.

Rules:
- Synthesize. Do not write one section per topic in the order you were given them. Group what belongs together and lead with what matters most.
- Be specific. Use the company's actual numbers, dates, and commitments. A brief without figures is not worth its place in the context.
- State current understanding only. Not how it got here, not what it used to be.
- Say what is at stake where it is not obvious - a constraint that is close to binding, a risk with a date on it.
- Leave things out. This is a brief, not a record. If a topic would not change how a financial question is answered, it does not belong.
- Choose your own section headings from what the company's state actually contains. There is no standard set of sections, and a heading with nothing behind it is worse than one less section.
- No preamble, no hedging, no restating these instructions.`;

export const renderBriefRequest = ({ blocks, maxChars }: BriefWriteRequest): string =>
  [
    `Write the brief in at most ${Math.floor(maxChars / 5)} words across at most a handful of sections.`,
    "",
    "The company's current understanding of its most load-bearing topics, most important first:",
    "",
    blocks
      .map((block) =>
        [
          `[${block.key}] ${block.title}${block.status === "dormant" ? " (dormant)" : ""}`,
          block.body,
        ].join("\n")
      )
      .join("\n\n"),
  ].join("\n");
