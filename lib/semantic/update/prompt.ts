import type { SemanticBlock } from "@/lib/semantic/types";
import type { SemanticProposalRequest } from "@/lib/semantic/update/types";

/**
 * What the updater asks the model.
 *
 * The hard part of this prompt is not extraction - a model will happily pull
 * facts out of a conversation all day. It is *restraint*. The failure mode we
 * are designing against is a system that treats every interesting sentence as
 * durable knowledge, and three months later has four hundred memories, nine of
 * which are about hiring and two of which contradict each other.
 *
 * So the prompt spends most of its length on two instructions: consolidate into
 * the topic that already exists, and say nothing when nothing was decided. The
 * schema enforces the ceilings; this explains why they are there.
 *
 * Note what is *not* here: any list of allowed topics, any taxonomy of fact
 * types, any instruction about categories. The company's blocks are whatever
 * the company turns out to have, and a prompt that enumerated them in advance
 * would quietly become the ontology we chose not to build.
 */

export const SEMANTIC_UPDATER_PROMPT = `You maintain a company's durable understanding of itself for a CFO agent.

You are given the company's current understanding of the topics that might be relevant, and one new interaction. Decide what - if anything - the company now understands differently.

What belongs in durable state:
- Plans, intentions, and commitments ("we're freezing hiring until the raise")
- Assumptions the company is operating on ("we expect 7% monthly growth")
- Constraints and policies ("never below 12 months of runway")
- Decisions, and the reasoning that makes them make sense
- Priorities, and shifts in them
- Risks and exposures the company is carrying
- Operating context that would change how a financial question should be answered

What does not:
- Questions the founder asked, and answers they were given
- Figures that can be read from the company's financial data
- Thinking out loud, options weighed and dropped, hypotheticals
- Anything true only for the duration of this conversation

Consolidate. Do not accumulate.
- A topic the company already has is revised, never duplicated. If an interaction changes the hiring plan, revise the hiring topic - do not create "q4-hiring" or "hiring-freeze" beside it.
- When you revise, rewrite the topic's body IN FULL, as the company's complete current understanding. Not a diff, not an append, and never a running log of what was said when. The history is kept for you automatically; your job is to state what is true now.
- A revised body should read like a founder explaining the topic to a new CFO today. Someone reading it should not be able to tell it was ever different.
- Only create a topic when the company genuinely has a new area of concern that no existing topic covers.

Be conservative.
- Most interactions change nothing. Returning no operations is the common, correct answer.
- If you are unsure whether something is durable, it is not. It will be said again if it matters.
- A founder exploring an idea has not decided anything. Wait for the decision.

Archive a topic when it has run its course ('resolved' - the launch shipped, the raise closed) or when it should never have been a topic ('archived'). Archiving keeps it; nothing is ever deleted.

Write bodies in plain, specific prose, with the numbers and dates the founder actually gave. Never invent a figure, a date, or a commitment that was not stated.`;

/** One block, as the model sees it before deciding what changed. */
const renderBlock = (block: SemanticBlock): string =>
  [
    `[${block.key}] ${block.title}`,
    `  status: ${block.status}; last updated: ${block.updatedAt.slice(0, 10)}; revisions so far: ${block.revision}`,
    block.labels.length ? `  labels: ${block.labels.join(", ")}` : null,
    `  current understanding: ${block.body}`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

/**
 * Renders the request.
 *
 * The blocks come first and the interaction last, so the model reads what the
 * company already believes before it reads the new thing - which is the order
 * that produces revisions instead of inventions.
 */
export const renderSemanticProposalRequest = ({
  interaction,
  blocks,
  now,
}: SemanticProposalRequest): string => {
  const sections: string[] = [`Today is ${now.slice(0, 10)}.`];

  sections.push(
    blocks.length > 0
      ? [
          "The company's current understanding of the potentially relevant topics:",
          "",
          blocks.map(renderBlock).join("\n\n"),
        ].join("\n")
      : "This company has no semantic state yet. Anything durable in this interaction would be a new topic."
  );

  sections.push(
    [
      `New interaction (${interaction.source ?? "conversation"}):`,
      "",
      interaction.messages
        .map((message) => `${message.role}: ${message.text}`)
        .join("\n\n"),
    ].join("\n")
  );

  sections.push(
    "What, if anything, does the company now understand differently? Revise an existing topic wherever one covers this. Return no operations if nothing durable changed."
  );

  return sections.join("\n\n---\n\n");
};
