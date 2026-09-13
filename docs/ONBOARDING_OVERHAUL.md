# Onboarding Overhaul

## Why

Onboarding today is a connectors step plus one form: MRR, other expenses,
growth target, minimum runway, current team, planned hires. It writes eight
`company_assumptions` keys and nothing else. As a result:

- Sam knows nothing about what the company does, how it makes money, who its
  customers are, or what it is trying to achieve. `companies.name` is written
  as `"Development company"`.
- Sam knows nothing about the founder. Every founder gets the same tone
  (`lib/agents/sam/prompt.ts`: "Be direct about bad news"), although founder
  goals and risk preferences are listed as part of the moat.
- The Semantic Company Model is empty for real companies. The updater exists
  but nothing calls it, so the company brief has nothing to synthesize.
- The planning engine reports inputs onboarding never collects (churn, cost of
  revenue, collection lag, one-time costs, raises, payroll burden, revenue-proxy
  acceptance) and ignores the one it does (growth target).

## Decisions

| Decision | Choice |
|---|---|
| Format | A conversation with Sam, with inline widgets where typing is clumsy |
| Time budget | 8-10 minutes for a required core; remaining depth is gathered in chat during the first week |
| Founder profile scope | Per person (auth user), not per company |
| Sensitive personal questions | Included: optional, opt-in, and handled under the rules in [Sensitive questions](#sensitive-questions) |

## What onboarding produces

| Output | Stored in | Read by |
|---|---|---|
| Forecast inputs | `company_assumptions` (expanded key set) | Planning engine, validated, never model-interpreted |
| The company's story: what it does, current situation, goals | Semantic blocks, `provenance.kind = "onboarding"` | Company brief, Sam retrieval |
| Who the founder is | Founder Model (new): founder blocks + communication contract | Sam, only in that founder's own runs |

### Founder Model

Keyed by the authenticated user id, independent of `company_id`. Today a
company *is* its founder's user id; the two are kept separate now so a second
co-founder later means a new founder row, not a migration.

Two parts:

1. **Founder blocks.** Prose with revision history, the same shape as semantic
   blocks: background, motivation, values, non-negotiables, decision style,
   personal constraints. Nuance lives here.
2. **Communication contract.** A small typed record, rendered deterministically
   into every Sam run for that founder:

   ```ts
   interface CommunicationContract {
     badNews: "lead_with_it" | "context_then_news" | "news_with_options";
     detail: "headline" | "show_work";
     recommendations: "tell_me_what_to_do" | "give_me_options";
     pushback: "challenge_hard" | "advisory";
     flagOptimisticAssumptions: boolean;
     financeFluency: "plain" | "fluent";
     alerts: Array<{
       metric: "runway_months" | "cash_usd" | "monthly_net_burn_usd";
       direction: "below" | "above";
       threshold: number;
     }>;
   }
   ```

   These are typed, unlike the prose semantic blocks, because Sam's behaviour
   depends on them directly. Relevance-ranked retrieval is fine for company
   topics. How to tell this founder their runway just dropped cannot depend on
   whether a search matched.

**Invariant:** preferences change *how* Sam delivers bad news, never *whether*
or *when*. The system prompt keeps a fixed rule that Sam never softens, delays,
or omits a material problem, whatever the contract says.

## The interview

### Flow

```
Connect (unchanged) -> Interview -> Playback & correct -> Forecasts -> Done
```

Sam opens by reading back what the connectors found, then asks only what the
data cannot answer. For example: "Stripe shows $42K over the last 30 days. Is
that typical, or does it include annual prepayments?"

### Required core (8-10 minutes)

About 16 questions at about 35 seconds each, with Sam combining or skipping
where the data or an earlier answer already covers one. Each is tied to what it
fills.

**Company (about 5 minutes)**

| # | Question | Fills |
|---|---|---|
| 1 | In a sentence, what do you sell, and to whom? | `company-overview` block, company name/description |
| 2 | How do you charge: subscription, usage, services? Monthly or annual prepay? | `business-model` block, collection lag |
| 3 | Is the connected revenue figure representative? *(only if Stripe is connected)* | `useStoredRevenueProxy`, `mrr_usd` |
| 4 | Roughly what gross margin, and what drives your cost of revenue? | `cost_of_revenue_bps`, `business-model` |
| 5 | How much revenue comes from your top 3 customers? Any churn or renewals coming up? | `churn_bps`, customer blocks for concentrated accounts |
| 6 | Last raise: amount, date, instrument. Any cash, debt, or credit the bank connection doesn't show? | `financial-posture` block, raises |
| 7 | Any large known costs coming: leases, annual contracts, taxes? | `one_time_costs` |
| 8 | Are you planning to raise next? Round, amount, timing, and what it needs to show? | `fundraising` block, planned raises |
| 9 | Where does your growth target come from? | `monthly_growth_target_pct` plus whether it is an aspiration or an operating assumption |
| 10 | Why each planned hire, and are any conditional on a milestone? *(confirms the team/hires widget)* | `hiring` block, `planned_hires` |
| 11 | Minimum runway, and why that number? What would make you cut? | `minimum_runway_months`, `financial-posture` policy |

**Founder (about 4 minutes)**

| # | Question | Fills |
|---|---|---|
| 12 | When something is wrong, do you want it first and blunt, with context first, or alongside options? | `badNews` |
| 13 | Should I tell you when I think a plan is optimistic, even if you didn't ask? Do you want a recommendation or the trade-offs? | `flagOptimisticAssumptions`, `pushback`, `recommendations` |
| 14 | What should I raise without being asked, and at what threshold? | `alerts` |
| 15 | Scenario: 9 months of runway and a great senior engineer is available now. Hire, wait, or hire only if a deal closes? | `risk-and-values` block |
| 16 | Lines you won't cross (layoffs, venture debt, a down round, missed payroll)? What outcome are you building toward? | `risk-and-values`, `motivation` blocks |

`financeFluency` and `detail` are inferred from how the founder answers and
confirmed during playback rather than asked outright.

**Sensitive (optional, about 1 minute, asked last)**. See the section below.

### Deferred depth (first week, in chat)

Sam asks these when they become relevant, not all at once:

- Company: why customers buy and what they'd use instead, sales motion and
  cycle length, pipeline being counted on, contractors outside Gusto, what's
  working and what isn't, 12-month milestones.
- Founder: prior founding and finance experience, who else handles money
  (co-founder, bookkeeper, board), decision style and who they consult, what
  helps under pressure, what advisors have done that was unhelpful, a second
  risk scenario (raise early at a lower valuation vs. cut burn 20%).

Unanswered and deferred items live in the onboarding session as open
questions. The context builder can tell Sam which ones are relevant to the
current request.

### Sensitive questions

Asked at the end, after one explicit opt-in: "A few personal questions help me
give better advice. Each is optional, and only you will ever see the answers."

- Founder salary, and whether it is below what you'd need long-term.
- Personal runway: how long you can keep going on your current salary.
- Personal money in the company: loans, guarantees, credit cards.
- Anything personal that constrains timing (left open, not probed).

Handling rules:

1. **Per founder only.** Stored as founder blocks flagged `sensitivity: "personal"`.
   Never written to semantic blocks, `company_assumptions`, or the company brief.
2. **Rendered only for that founder.** The context builder includes them only
   when the run's authenticated `founderId` matches. Never included in
   company-scoped context another member could reach.
3. **Not in company-scoped transcripts.** The sensitive part of the interview is
   not sent to `updateSemanticState` or stored in `semantic_interactions`.
   Founder extraction for this section runs on its own path, and the stored
   transcript records only that the section occurred.
4. **Not in observability.** Excerpts in provenance and run events are omitted
   for sensitive blocks.
5. **Deletable.** Unlike company semantic history, the founder can delete any
   founder block, sensitive or not, along with its full revision history.
   A personal block can also never be revised back to standard.
6. **Declining is remembered.** A skip is recorded as `declined`, and Sam does
   not ask again unless the founder brings it up.
7. **Used, not quoted.** Sam may weigh these in a recommendation (e.g. a plan
   that stops paying the founder) but does not repeat figures unprompted.

### Playback and correct

Before finishing, Sam shows two short summaries: "Here's how I understand your
company" and "Here's how I'll work with you" (the contract in plain language).
Edits are written as `corrected` revisions, not `revised`, because the
company didn't change; the model got it wrong.

Onboarding then runs base, conservative, and aggressive forecasts and shows the
headline result, delivered according to the contract just set.

## Architecture

### Interview engine

Sam in onboarding mode: a separate system prompt and tool set on the same
harness, not a separate agent framework.

- **Coverage checklist.** Sections and questions are defined in code, each with
  "known enough" criteria and a pointer to what it fills. The model chooses the
  next question from what is still missing, what the connectors show, and what
  was just said. It does not follow a fixed script.
- **Time budget.** The checklist marks required vs. deferrable items. Past about
  8 minutes, Sam wraps up remaining required items and defers the rest.
- **Sections.** Six, in order: company basics, company position, company
  plans, founder working style, founder values, personal. Smaller sections
  keep each consolidation step to a few topics.
- **Tools:**
  - `record_assumption`: validated writes to the assumption keys onboarding
    may set. Never cash, payroll, or the team, which come from connected data.
  - `record_company_profile`: the company's name and description.
  - `record_founder_preference`: validated writes to the contract. Only
    `detail` and `financeFluency` may be inferred.
  - `mark_question`: answered, deferred, unsure, declined, or not applicable.
    Personal questions cannot be marked answered before the opt-in.
  - `complete_section`: closes the current section once its core questions
    are resolved. Consolidation runs after the turn, not inside the tool.
- **Extraction.** On `complete_section`, the section transcript goes to
  `updateSemanticState` with `source: "onboarding"`, and founder sections go to
  a founder-block proposer. The updater needs an onboarding prompt variant: its
  "most interactions change nothing" restraint is wrong when every answer is
  meant as baseline.
- **Personal answers** are consolidated during the turn they are given, from
  the in-memory text, into personal founder blocks only. The transcript then
  stores a redacted placeholder for both the founder's answer and Sam's reply.
- **Resumable.** `onboarding_sessions` stores the transcript (minus the
  sensitive section), checklist state, deferrals and declines. Leaving and
  returning picks up where the founder left off.

### Identity

`SamRuntimeContext` gains `founderId`, resolved from Supabase Auth in
`lib/company/context.ts` alongside `companyId`. Both equal `user.id` today; they
are separate fields so they can diverge. Like `companyId`, it is never
model-supplied.

### Data (migrations)

- `founder_blocks` / `founder_block_revisions`: mirror the semantic tables,
  scoped by `founder_id`, with a `sensitivity` column and a revise function
  modelled on `semantic_block_revise`. Deleting a block cascades its history.
- `founder_communication_contracts`: one current row per founder plus an
  append-only history table.
- `onboarding_sessions`: `founder_id`, `company_id`, status, checklist state
  (jsonb), transcript, deferred/declined items, timestamps.
- `companies`: add `description`; stop writing the placeholder name.
- `company_assumptions`: add keys to `ASSUMPTION_KEYS` for cost of revenue,
  churn, collection terms, known one-time costs, planned raises, and
  revenue-proxy acceptance, using shapes that match `stored-schema.ts`.

All tables follow the existing pattern: RLS on, service role only.

### Sam integration

- The context builder loads the founder's contract (always) and founder blocks
  (relevance-selected, sensitive ones only for the matching founder).
- The `How you talk` section of the prompt is rendered from the contract. The
  fixed bad-news invariant stays in the static prompt.
- The brief can include founder goals and non-negotiables that affect financial
  answers (not sensitive blocks).
- `buildStoredCompanyPlan` reads the new keys, so onboarding answers become
  forecast inputs rather than qualifications.

## Phases

1. **Data layer.** *(Built.)* Migrations above, `founderId` in runtime context,
   founder stores (`lib/founder/`), onboarding session store
   (`lib/onboarding/sessions.ts`), new validated assumption keys. Integration
   tests for scope isolation and sensitive-block rules.
2. **Interview engine.** *(Built.)* Checklist definitions
   (`lib/onboarding/checklist.ts`), onboarding prompt, tools, section and
   personal-answer extraction, onboarding updater variant, and
   `runOnboardingTurn`. Tested against scripted founder transcripts, including
   one that declines every sensitive question.
3. **UI.** Replace the Model step in `app/onboarding/page.tsx` with the chat
   interview and inline widgets (currency input, team/hires table from Gusto,
   choice chips for preference and scenario questions), then playback and
   forecasts.
4. **Sam integration.** Context builder, contract-driven prompt, brief changes,
   planning reads new keys. Persona evals: the same below-floor runway result
   for a "lead with it" founder and a "news with options" founder. Delivery
   must differ; the facts and the timing of the warning must not.
5. **After onboarding.** Deferred questions surface in chat when relevant; the
   updater keeps founder blocks and the contract current from conversation.

## Out of scope for v1

- Voice onboarding (`lib/agents/sam/voice.ts` exists, but it is a separate slice).
- Multiple founders per company. The schema allows it; the UI and membership
  do not yet.
- Proactive alert delivery. Thresholds are captured now; notifications are not
  in Phase 1.
