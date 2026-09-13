# Sam Information Access — Design

How Sam acquires information during a single agent run. Design only; nothing here is
implemented. It assumes `docs/SOURCE_LAYER_RESEARCH_PACKET.md` and
`docs/NUMERICAL_MODEL_PHASE_1..4.md`, and it is written against the code on `main`
(`lib/agents/sam/`, `lib/finance/`, `lib/semantic/`, `lib/source/`, `lib/company/`).

The headline conclusion: **the ReAct harness needs no change at all.** Progressive
acquisition already works, and works properly. What is broken is *orientation* — Sam
cannot see what information exists, so it cannot decide to ask for it. Five of the six
recommendations below are about the opening context and the tool descriptions. One adds
a tool, because one whole category of company state is currently unreachable.

---

## 0. What the inspection found

### Already correct, do not touch

| Thing | Where | Why it stays |
| --- | --- | --- |
| ReAct loop with accumulating tool results | `agent.ts` + LangChain `createAgent` | Already gives the exact execution model that was asked for. See §5. |
| One financial read per run, scope-checked | `lib/finance/session.ts` | Baseline and every tool share one consistent snapshot. Replacing this would reintroduce evaluation-time drift. |
| Deterministic finance in code, never in prompt | `lib/finance/*` | The moat. No proposal here touches a calculation. |
| Five actuals tools + three forecast tools | `tools/financial.ts` | Genuinely distinct questions, strict schemas, no company/monetary identity accepted from the model. |
| Bounded, refusing tool results | `harness/middleware.ts` | Oversized results are refused *with instructions*, not truncated into malformed JSON. Correct. |
| No-progress guard on byte-identical repeats | `harness/middleware.ts` | Correct and already returns a usable explanation to the model. |
| Brief as a capped synthesis, fingerprint-gated | `lib/semantic/brief/` | ~2000 chars, regenerated only on material change. This is the right shape for standing context. |
| `explain_financial_number` | `finance/sam-surface.ts` | Already the constrained evidence interface. Basis totals always complete, evidence paged, reconciliation legs retained, "never sum pages or classify entries yourself" in the description. |

### Actually broken

1. **Sam cannot see what company knowledge exists.** The opening context carries the
   brief plus the *top three lexical search hits* for the current question
   (`context-builder.ts:DEFAULT_MAX_MEMORIES = 3`). A block that is neither in the brief
   (requires `contextPolicy: "always"` or `salience >= 0.6`) nor matched by
   `semantic_block_search`'s OR-of-prefixes is invisible — Sam does not know it exists and
   so never calls `get_memory` for it. This is precisely the failure named in the brief:
   *"without first hoping a lexical memory search finds the company's own hiring plan."*

2. **`company_assumptions` and the Gusto payroll tables reach Sam through nothing.**
   `getCompanyAssumptions` has exactly one caller: `app/api/onboarding/route.ts`.
   `payroll_employees` / `payroll_runs` have none outside the Gusto sync. The runway
   floor, planned hires, growth target, headcount and monthly payroll cost are all
   written and then unreadable. `buildStoredCompanyPlan` on the unmerged
   `feat/company-planning-loader` already adapts both into an `OperatingPlan` with
   provenance and a `missing[]` list — it just has no path to the agent.

3. **Epistemic class is prose only.** Roughly half of `SAM_SYSTEM_PROMPT` is the same
   distinction restated per tool ("forecasts are conditional", "memory is belief",
   "recorded movement is not operating burn", "missing is not zero"). Every tool returns
   the same untyped `{ok, data}`. The distinction the architecture is built on is
   enforced nowhere except by asking the model to remember nine paragraphs.

4. **Provider availability is a count.** `financialSnapshot` reports
   `sourceConnections: 3` and `unhealthyConnections: 1` but never *which* providers, and
   says nothing about Gusto or about whether onboarding assumptions exist.
   `actuals.health.connections[]` already carries provider, status, `last_synced_at`,
   `stale` and per-provider caveats — the data is loaded and then dropped on the floor.

5. **Thread memory is dead weight.** `getThreadMemory()` returns a fresh
   `InMemoryThreadMemory` per process and nothing anywhere calls `appendNote`. On Vercel
   `thread.summary` and `thread.notes` are always empty. Conversation state comes
   entirely from the DB transcript in `app/api/chat/route.ts`. The contract should say so.

6. **Two small defects with real effects.**
   - `get_memory_history` has no entry in `SAM_TOOL_POLICIES`, so it falls through to
     `DEFAULT_SAM_TOOL_POLICY` — `kind: "action"`, `retryable: false`. A transient
     failure on a read-only history lookup is treated as critical and is never retried,
     and it would be approval-gated the moment an approver exists.
   - `search_memory`'s `summarize` reads `data.memories`, but the tool returns
     `{ topics: [...] }`. The activity-trail summary never fires.
   - `searchMemoryInputSchema.kinds` is documented as **deliberately ignored** by
     `SemanticPersistentMemory.search`. It is a parameter the model can spend a turn
     choosing that changes nothing.

7. **The context budget does not measure the largest growing component.**
   `measureSamContext` counts `systemPrompt` + `initialContext` and ignores the message
   history, which `conversations/store.ts` loads in full with no window.

---

## 1. Target single-turn execution model

```
                          ORIENTATION  (assembled once, before model call 1)
                          ┌──────────────────────────────────────────────┐
 founder question ──────▶ │ system prompt + capability index             │
                          │ financial position snapshot        [derived] │
                          │ data availability inventory       [observed] │
                          │ company brief                      [stated]  │
                          │ semantic directory  (keys + summaries only)  │
                          │ operating headline                 [stated]  │
                          │ conversation transcript            [claimed] │
                          └──────────────────┬───────────────────────────┘
                                             ▼
                                      ┌─────────────┐
                    ┌─────────────────▶│ model call  │────▶ answer, when orientation
                    │                  └──────┬──────┘      already supports it (case A)
                    │                         │
                    │                  decides what it needs
                    │                         ▼
                    │    ┌────────────────────────────────────────────┐
                    │    │  DETAIL  — one tool, one epistemic class   │
                    │    │                                            │
                    │    │  semantic     get_memory / _history / search│
                    │    │  operating    get_operating_inputs          │
                    │    │  financial    position / cash_flow /         │
                    │    │               burn_runway / compare_periods  │
                    │    │  evidence     explain_financial_number       │
                    │    │  conditional  forecast_cash / simulate_* /   │
                    │    │               compare_financial_scenarios    │
                    │    └──────────────────┬─────────────────────────┘
                    │                       ▼
                    │        ToolMessage appended to run state
                    │        (typed envelope: class, origin, asOf)
                    │                       │
                    └───────────────────────┘
                       every later model call sees every earlier result,
                       verbatim, in order — LangChain state, not our code
```

The loop is what exists today. The change is entirely in the top box and in what the
tool descriptions say about the middle one.

---

## 2. Initial context contract

Exactly what Sam receives before model call 1, and the reason each part is paid for on
every single run.

| # | Section | Class | Size | Status | Why preloaded rather than tool-accessed |
| --- | --- | --- | --- | --- | --- |
| 1 | System prompt + capability index | — | ~3.5 KB | **shrink** | Identity, behaviour, one epistemic precedence rule, one line per capability family. The per-tool epistemic prose moves into the typed envelope (§6). |
| 2 | Financial position snapshot | `derived` | ~2 KB | keep as-is | Case A must need zero tools. Already bounded to 2 currencies with freshness, coverage, qualifications and `runway.status` + reasons. |
| 3 | **Data availability inventory** | `observed` | ~0.4 KB | **new** | "What world am I in?" One line per connection: provider, status, last successful sync, stale flag; plus payroll-connected yes/no and assumptions-present yes/no. Entirely a projection of `actuals.health.connections[]` — no new read. Without it Sam cannot tell a company with no Stripe from a company whose Stripe broke, and answers "how fresh is this?" only by spending a tool call. |
| 4 | Company brief | `stated` | ≤2 KB | keep as-is | What a CFO already knows walking in. Capped, synthesized, fingerprint-gated. Correct as built. |
| 5 | **Semantic directory** | `stated` | ~1.5 KB | **new — replaces top-3 injection** | One line per *current* block: `key — summary (status, as of, salience)`. No bodies. This is the orientation/detail split made real: Sam learns the topic exists and fetches the prose only when the question turns on it. At today's scale (seed has 5 blocks; a real company 10–30) the whole directory costs less than the three injected bodies it replaces. |
| 6 | **Operating headline** | `stated` (`observed` where provider-derived) | ~0.8 KB | **new** | Runway floor, headcount, monthly payroll cost, planned hires (count / total monthly cost / earliest start), growth target, fundraising target and date — each with `source` (`onboarding` \| `derived` \| `founder` \| `gusto`) and `updatedAt`. This is what makes "can we afford our planned hires?" answerable without a lucky search. Values only; the detail is behind a tool. |
| 7 | Conversation transcript | `claimed` | variable | keep | DB rows only; browser history is never trusted. |
| — | ~~Top-3 lexical memory bodies~~ | | | **remove** | Superseded by 5 + `get_memory`. Three bodies chosen by prefix-match is a worse bet than a complete index plus a deliberate fetch. |
| — | ~~Thread summary / notes~~ | | | **stop paying for** | Always empty in production (§0.5). Keep the `SamInitialContext` field; drop the load and the prompt section until a durable thread memory exists. |

Rough standing cost: **~10.2 KB ≈ 2.6K tokens**, against ~9.5 KB today. `maxContextChars`
should move 12000 → 16000 and `measureSamContext` should count transcript characters, so
the number that gates compaction stops ignoring the component that actually grows.

### The directory pattern — yes, and the machinery already exists

The pattern in the brief is the right one here, and it needs almost nothing built:

```
Available company knowledge (current understanding; use get_memory for the full text):
- financial-posture  ~$1.8M cash, ~$170K MRR, ~$210K/mo burn, 12-month runway floor   (as of 2026-09-01)
- hiring             Hiring frozen until the raise closes                              (as of 2026-09-20)
- fundraising        Targeting $8M Series A, first conversations in Q1                 (as of 2026-09-10)
- enterprise-launch  ...                                                     (dormant, as of 2026-08-02)
```

`SemanticBlock` already carries `key`, `summary`, `status`, `asOf`, `salience` and
`contextPolicy`; `listCurrentBlocks` already orders by exactly policy → salience →
recency. The only missing piece is an optional `list()` on the `PersistentMemory`
boundary, following the established optional-capability idiom of `MemoryHistory` /
`supportsMemoryHistory`.

Two properties are load-bearing:

- **`asOf` is shown.** A hiring plan dated three weeks ago next to a financial snapshot
  evaluated an hour ago is information, and Sam should be able to notice the gap.
- **Truncation is explicit.** If the directory is capped (say 40 entries), the section
  must say `N more topics not listed — use search_memory`. Silent truncation would
  recreate the invisibility problem with a nicer face.

---

## 3. Runtime information interfaces

### Source evidence

| | |
| --- | --- |
| **Preloaded** | Connection inventory: provider, status, last successful sync, stale flag, per-provider caveats. Account and coverage *counts* via the snapshot's qualifications. |
| **Discoverable** | Every financial result carries a `trace` hint naming the exact next call (`{tool: "explain_financial_number", metric: "cash", currency: "USD"}`). This already exists in `summarizePosition` / `summarizeCashPeriod` and is the cleanest discovery mechanism in the codebase. |
| **Tool-accessed** | `explain_financial_number` only — complete basis totals plus paged evidence: account id, kind, provider, balance ids, `valueObservedAt`, `rawRecordId`, `syncId`, missing flags, and the reconciliation legs proving a transfer. |
| **Intentionally inaccessible** | Arbitrary entry queries, date-range ledger dumps, entry-by-id lookup, counterparty aggregation, raw provider payload *contents* (ids are references, not fetchable content), any classification verb. |

**Recommendation: add no Source tool.** Walk the five questions the brief lists:
*"where did that number come from?"*, *"which entries explain this movement?"*, *"what
accounts are included?"*, *"how fresh is this?"*, *"show me the evidence."* The first,
second and fifth are `explain_financial_number` as it stands. The third is its
`metric: "cash"` evidence page (account id, kind, provider, per-account missing flag).
The fourth is orientation section 3 — no tool needed. A general source-exploration
primitive would buy nothing these do not already cover, and would hand the model a bag
of rows to classify, which is the one thing this architecture exists to prevent.

### Financial

| | |
| --- | --- |
| **Preloaded** | Current cash and signed credit per currency (≤2, with the omitted count), last full month's recorded movement, unresolved gross, external-flow status, operating-burn and runway availability *with reasons*, freshness, coverage, duplicate risk. |
| **Discoverable** | `trace` hints; the snapshot's `more` field already points at the tool families; `financial_position` with no currency pages the observed currencies. |
| **Tool-accessed** | Position, cash flow for a completed-day period, burn/runway basis, two-period comparison, evidence, and three conditional engines. |
| **Intentionally inaccessible** | Cash/revenue/expense scalars as inputs, starting-cash override, combining currencies, FX, unqualified runway, `historical_recorded_average` baselines (correctly returns unavailable). |

**Recommendation: no new financial primitive, no consolidation.** Phase 3 and 4 chose a
generic cash-delta surface over bespoke `simulate_hire` / `forecast_burn` verbs on
purpose, and the argument holds — a hiring plan *is* a recurring outflow increase with a
basis label. The compositional surface is already right: position → movement →
comparison → evidence → forecast → scenario, each a distinct question with a strict
schema. A flexible "explore financial state" primitive would have to accept a query
language, which is on the constraint list and would also reopen the classification hole.

### Semantic

| | |
| --- | --- |
| **Preloaded** | The brief (synthesized prose) and the directory (keys + summaries, all current blocks). |
| **Discoverable** | The directory *is* the discovery surface. Keys are stable and model-quotable by design. |
| **Tool-accessed** | `get_memory` (exact current wording, primary verb), `get_memory_history` (change only), `search_memory` (residual: label/word matching, and the case where the directory was truncated). |
| **Intentionally inaccessible** | Superseded revisions except through `get_memory_history`; any write path (the updater in `lib/semantic/update/` runs out-of-band and is not wired to a production caller today); cross-company anything. |

**Recommended MVP interface: preloaded index + explicit retrieval, keeping search as a
fallback.** Ruling the alternatives out explicitly, since the brief asked:

- *Automatic relevant-memory injection* — what exists today. It is the bug. Relevance is
  decided by prefix-matched `ts_rank_cd` against the raw question, and a founder asking
  "can we afford another engineer?" reaches the hiring block only if the words overlap.
- *Entire small company state* — tempting at 5 blocks, wrong at 30, and the cost is paid
  on every run forever. The directory gets ~90% of the benefit at ~15% of the tokens, and
  it does not degrade as the company accumulates knowledge.
- *Search + get with no index* — leaves Sam unable to know what it does not know.
- *Hybrid, as recommended* — brief (what matters always) + directory (what exists) + get
  (what this question needs) + history (how it changed). Each answers a different
  question and none duplicates another.

### Payroll / operating

| | |
| --- | --- |
| **Preloaded** | The operating headline (§2.6): floor, headcount, monthly payroll cost, planned-hire aggregate, growth target, fundraising target — values with `source` and `updatedAt`. |
| **Discoverable** | The headline states which fields are present and which are missing, so Sam can see that a floor exists before deciding whether to fetch the detail. |
| **Tool-accessed** | **`get_operating_inputs`** — the full stored planning inputs with per-field provenance (`company_assumptions:<id>`, `payroll_employees`, `gusto`), `updatedAt`, and the `missing[]` / invalid-value list. Built on `readStoredPlanningRecords` + `buildStoredCompanyPlan`, which already exist. |
| **Intentionally inaccessible** | **Employee names and any per-person identifiers.** `payroll_employees` holds `first_name` / `last_name`; the roster reaches the model only aggregated — headcount, total monthly employer cost, and per-role cost where a role is stated. Sam does not need to know who, and a payroll roster in a model context is a liability with no matching benefit. |

Note the epistemic split inside this one layer: `company_assumptions` rows are **stated**
(founder-entered, or `derived` from data at onboarding time and possibly since stale),
while `payroll_employees` rows are **observed** provider records — from Gusto, outside the
Source Layer, and therefore not cash evidence. The envelope must carry both distinctly.

### Conversation

| | |
| --- | --- |
| **Preloaded** | The full DB transcript, user and assistant text only. |
| **Discoverable** | — |
| **Tool-accessed** | Nothing. |
| **Intentionally inaccessible** | Browser-supplied history (already refused), private reasoning (`visibleAssistantText` filters thinking blocks out of the stream and nothing persists them), and tool calls/results from *earlier turns* — those are not persisted and are deliberately not replayed. |

That last point matters for trace E: when a founder asks "why did you say that?" about a
previous turn, the honest answer comes from re-deriving the figures, not from quoting a
transcript claim. The current design forces the honest path. Do not change it.

---

## 4. Tool recommendations

Twelve tools after these changes. That is above the ~11 where selection reliability is
said to soften, but the cited effect is about *similar* tools; these sit in five clearly
separated namespaces (`financial_*`, `forecast`/`simulate`/`compare_*`, `explain_*`,
`*_memory`, `get_operating_inputs`) with a one-line capability index in the prompt.
**Do not dynamically expose subsets, and do not add a routing agent** — both add a failure
mode (the right tool being absent) to solve a problem we have no evidence of yet. The
trigger for revisiting: a run where the trace shows a plainly wrong tool chosen when the
right one was described accurately.

| Tool | Action | Justification |
| --- | --- | --- |
| `financial_position` | **keep** | Distinct. Currency discovery via `offset` is a real capability. |
| `financial_cash_flow` | **keep** | Distinct. Only route to the internal/unresolved/external breakdown. |
| `financial_burn_runway` | **keep** | Distinct, and its honest `unavailable` + reasons is load-bearing. |
| `compare_financial_periods` | **keep** | Distinct. |
| `explain_financial_number` | **keep** | The evidence interface. Already right. |
| `forecast_cash` | **keep** | Distinct: trajectory rows. |
| `simulate_financial_scenario` | **keep, sharpen description** | Overlaps `compare_financial_scenarios` at N=1. Not worth collapsing — it returns a trajectory the comparison tool deliberately omits — but the descriptions must state the selection rule outright: *"one scenario and you need period-by-period rows → simulate; two or more scenarios, or consequences only → compare."* |
| `compare_financial_scenarios` | **keep, sharpen description** | As above; say explicitly that it accepts a single scenario. |
| `get_memory` | **keep, promote** | Becomes the primary semantic verb once the directory exists. Description should name the directory as its source of ids. |
| `get_memory_history` | **keep, + add a policy entry** | `{kind: "read_only", retryable: true, label: "Reading how a topic changed"}`. Today it inherits the `action` default and is never retried. |
| `search_memory` | **keep, narrow** | Drop `kinds` from the schema — the adapter ignores it and its own comment says it should leave the schema. Redescribe as the fallback for a truncated directory or a word/label match. Fix `summarize` to read `topics`, not `memories`. |
| **`get_operating_inputs`** | **add** | The only genuinely unreachable layer. Returns stored planning inputs with per-field provenance and an explicit `missing[]`; aggregates the payroll roster; returns no names. Without it, "can we afford the planned hires?" requires Sam to invent the hire cost or ask the founder for a number the database already holds. |

Removed: nothing. Every existing tool answers a question no other tool answers.

---

## 5. Context accumulation behavior

**The existing harness already gives the requested execution model, with no addition.**

`createAgent` (langchain ^1.5.11) compiles a LangGraph whose `messages` channel is
append-only for the duration of a run. Each iteration:

1. The model node is called with `systemPrompt` + the **entire** current message list.
2. If the response contains `tool_calls`, the `AIMessage` (with its tool-call blocks) is
   appended and the graph routes to the tool node.
3. Each tool returns a `ToolMessage` — our `{ok, data}` JSON string — which is appended,
   tagged with its `tool_call_id`.
4. Control returns to the model node, which is now called with the original context plus
   every `AIMessage`/`ToolMessage` pair produced so far, in order.
5. When a response has no tool calls, it is the answer. `executeSamRun` reads the final
   `values` chunk.

So `result becomes available to model call 2` is not something to build — it is the
channel's semantics. Verified properties of the current stack that matter:

- **Nothing trims or summarizes mid-run.** The middleware stack is no-progress → call
  limits → retries → execution. There is no context-editing or summarization middleware,
  so a tool result cannot silently vanish between the call that produced it and the
  answer that depends on it.
- **Tool results are verbatim.** The execution middleware measures and *bounds* results;
  it never rewrites a passing one. An oversized result is replaced by an instruction to
  narrow the request, which is a better signal than a truncated payload.
- **Course changes are free.** Because every prior result stays visible, the model
  revising its plan after result 1 costs nothing structural — traces C and D below depend
  on exactly that.

What bounds accumulation: `maxToolResultChars` 8000 per result, `maxToolCalls` 12,
`maxModelCalls` 8, `runDeadlineMs` 60s, `maxRepeatedToolCalls` 2.

**`maxModelCalls: 8` is the one number that needs raising.** Trace D below uses four
tools and five model calls. Add one refused-oversized-result round and one model retry
and the run terminates as `max_model_calls` mid-investigation — the founder gets *"I ran
out of room working through that one"* on exactly the multi-step question this design is
for. Recommend 8 → 12 and `maxToolCalls` 12 → 14. Cheap, reversible, directly protects
the target behaviour.

### On a working-state store

**No think tool, no scratchpad, no explicit working state.** A think tool would let the
model emit text it can already emit; the transcript is the scratchpad and it is already
complete and ordered.

There is exactly one place where a real capability is missing, and it is *cross-turn*,
not intra-run: the assumption set Sam constructs for a scenario — the events, recurring
deltas, basis labels — lives only in a `ToolMessage`, and `conversations/store.ts`
persists only user and assistant *text*. So "now make it three engineers" rebuilds the
whole forecast input from scratch, possibly differently. That is a real defect, but a
working-state store is the wrong fix and it is not urgent:

- Re-deriving is the *honest* behaviour for trace E, which is the strongest argument
  against caching a prior answer's inputs.
- The cheap correct version, when it earns its place, is to persist `SamRunResult.toolCalls`
  (already collected, already structured) against the `runs` row for audit, and inject
  nothing. Add retrieval only when a trace shows the rebuild going wrong.

Deferred with that explicit trigger.

---

## 6. Epistemic classes

A typed envelope, not an ontology. `runTool` already wraps every tool; it gains a second
argument and the classification is declared once per tool, next to the tool.

```ts
type EpistemicClass =
  | "observed"     // provider-stated fact: Source evidence, Gusto payroll record
  | "derived"      // deterministic computation over observed data
  | "conditional"  // forecast/scenario — true only of its stated assumptions
  | "stated"       // management belief: semantic block, onboarding assumption
  | "claimed";     // asserted in this conversation, verified by nothing

interface Epistemic {
  class: EpistemicClass;
  origin: string;      // "source:plaid" | "numerical-model" | "semantic:hiring"
                       // | "company_assumptions" | "provider:gusto" | "transcript"
  asOf?: string;       // evaluation or as-of time, where the layer has one
  conditional?: true;  // set on every forecast/scenario result
}

// { ok: true, epistemic: {...}, data: {...} }
```

Each orientation section in §2 carries the same tag. Then one rule replaces nine
paragraphs of prompt:

> Each result and context section is tagged with its epistemic class. `observed` and
> `derived` results outrank `stated` and `claimed` ones about the same quantity; they
> never merge. A `conditional` result is true only of the assumptions it lists.
> When a `stated` or `claimed` value disagrees with a `derived` one, report both and name
> the disagreement — never average them, never let the belief substitute for the fact.

Why this is worth doing rather than leaving as prose:

- **Machine-checkable.** A test can assert that no `conditional` result is presented
  without its assumption list, and that `financial_burn_runway` never returns `derived`
  when `runway.status === "unavailable"`.
- **It shrinks the prompt.** The per-tool epistemic reminders currently occupy ~40% of
  `SAM_SYSTEM_PROMPT`, and a long prompt of near-duplicate rules is itself an
  instruction-following risk.
- **It reaches the UI.** `ActivityTrail` can label a step "conditional forecast" vs
  "observed evidence" from the tag, without a second vocabulary.
- **Implementation cost is one file plus one line per tool.** `tools/result.ts`,
  `prompt.ts`, and a declaration at each call site. No domain code changes.

What it does **not** do: it does not verify free-form prose. A model can still write a
sentence that blurs a boundary. It makes the boundary a property of the data rather than
a rule the model has to remember, which is the achievable half.

---

## 7. Concrete traces

Assumes the seeded company (`lib/semantic/seed.ts`): `financial-posture` (12-month runway
floor), `hiring` at revision 3 (frozen until the raise), `fundraising` ($8M Series A, Q1).

### A — "How much cash do we have?"

```
orientation ──▶ model call 1 ──▶ answer
```
**Zero tools.** Snapshot section 2 already carries the formatted cash display, account
count, missing-balance count, `valueObservedAt` freshness and scope caveat. Sam answers
with the exact display string and the coverage qualification
(`eligible_linked_accounts_only_not_all_company_accounts`).
Only exception: a currency outside the two shown → one `financial_position` call.

### B — "Why did our cash drop last month?"

```
orientation (snapshot already shows lastFullMonth recorded movement + unresolved gross)
  ▶ model 1  ──▶ financial_cash_flow {currency:"USD", period:{start,endExclusive}}
                 ← [derived] recorded movement split: internal transfers, repayments,
                   unresolved, externalCashMovement.status, operatingBurn unavailable+reasons
  ▶ model 2  ──▶ explain_financial_number {currency:"USD", metric:"cash_movement", period, limit:3}
                 ← [observed] complete basis totals + paged entry evidence with
                   counterparty strings and reconciliation legs
  ▶ model 3  ──▶ compare_financial_periods {current, prior}        ← optional
                 ← [derived] exact deltas, both windows, caveats
  ▶ model 4  ──▶ answer
```
3 tools, 4 model calls. The answer must say: recorded cash movement of X, of which Y is a
proven credit-card repayment (cash out, no new spend), Z unresolved; this is **not**
operating burn and **not** balance-to-balance change. No semantic retrieval — nothing in
this question turns on belief.

### C — "We're planning to hire the two engineers. What does that do to our runway?"

```
orientation ──▶ operating headline already carries minimum_runway_months = 12 and
                planned_hires (2 × ~$17,083/mo, earliest start), source=onboarding
                directory shows: hiring — "Hiring frozen until the raise closes" (as of 2026-09-20)

  ▶ model 1  ──▶ get_memory {id:"hiring"}
                 ← [stated, semantic:hiring] full current body: frozen until the raise
                 ★ COURSE CHANGE: the founder's premise and the company's current stated
                   plan disagree. Sam must answer the question *and* surface the conflict.

  ▶ model 2  ──▶ simulate_financial_scenario {
                   currency:"USD", startDate:<next month start>,
                   horizon:{periods:18, granularity:"month"},
                   baseline:{method:"none"},
                   scenario:{ name:"two platform hires",
                     recurringDeltas:[ {driver:"outflow", change:"increase",
                        amountMinor:1708300, cadence:"month", startDate:...,
                        basis:{kind:"management_assumption",
                               label:"Planned Q4 platform hires, ~$205K fully loaded each",
                               reference:"semantic:hiring"}}, ...x2 ],
                     assumptions:[...] },
                   thresholds:{ runwayMonths:12 } }
                 ← [conditional] incremental cash impact, ending/minimum cash,
                   reserve + runway-threshold crossings, qualification:
                   baseline=none omits unmodeled baseline activity

  ▶ model 3  ──▶ answer
```
2 tools, 3 model calls. Required shape of the answer: report the **delta** and the
threshold crossing, explicitly conditional; do **not** state an absolute runway, because
`baseline: "none"` omits unmodeled activity and `historical_recorded_average` correctly
returns unavailable; compare against the 12-month floor while naming it a management
policy (`stated`), not an observed constraint; and lead with the fact that the company's
current stated plan says hiring is frozen pending the raise.

Note what orientation bought: the hire cost and the floor were both available before the
first tool call. Today neither is — `planned_hires` is unreachable and the floor is only
in the brief if `financial-posture` happens to have made the salience cut.

### D — "What did we decide about hiring and can we still afford it?"

The composition case. Each result changes what Sam retrieves next.

```
orientation ──▶ directory lists hiring / fundraising / financial-posture with as-of dates

  ▶ model 1  ──▶ get_memory_history {id:"hiring", limit:5}          ← the question is about change
                 ← [stated] r1 two engineers Q4 (2026-09-03) → r2 maybe one (2026-09-12)
                   → r3 frozen until the raise (2026-09-20), with changeNotes; r3 marked current
                 ★ CHANGE 1: "it" is not two hires. The decision is a freeze coupled to a raise.

  ▶ model 2  ──▶ get_memory {id:"fundraising"}                       ← because r3 named the raise
                 ← [stated] $8M Series A, Q1 conversations, coupled to the enterprise launch

  ▶ model 3  ──▶ financial_burn_runway {currency:"USD", trailingMonths:3}
                 ← [derived] runway.status = "unavailable" + reasons (no operating
                   classification, history continuity unknown); recorded cash-consumption
                   comparison available, explicitly not operating burn
                 ★ CHANGE 2: "can we afford it" cannot be answered as runway months.
                   Sam pivots from asserting affordability to bounding it conditionally.

  ▶ model 4  ──▶ compare_financial_scenarios {
                   currency:"USD", startDate, horizon:{periods:18, granularity:"month"},
                   baseline:{method:"none"},
                   scenarios:[ {name:"hiring stays frozen", ...},
                               {name:"one engineer", ...},
                               {name:"two engineers", ...} ],
                   thresholds:{ runwayMonths:12 } }
                 ← [conditional] per-scenario ending/minimum cash, threshold crossings,
                   cumulative incremental impact, shared qualifications

  ▶ model 5  ──▶ answer
```
4 tools, 5 model calls — which is why `maxModelCalls: 8` is too tight once a retry lands.
The answer separates three things the founder is conflating: what was decided
(`stated`, with dates), what is observable (`derived`, and runway is honestly
unavailable), and what follows under assumptions (`conditional`, three scenarios against
the stated floor).

### E — "Why are you saying we can't afford that?"

The provenance path. The prior assistant turn is `claimed` — Sam may not defend it by
quoting itself.

```
orientation ──▶ transcript carries the earlier claim, tagged [claimed]

  ▶ model 1  ──▶ financial_position {currency:"USD"}
                 ← [derived] cash display, accountCount, missingAccountCount,
                   freshness (stale/never-synced/not-recently-observed counts),
                   trace:{tool:"explain_financial_number", metric:"cash", currency:"USD"}
                 ★ the result names its own next step — discovery without a registry

  ▶ model 2  ──▶ explain_financial_number {currency:"USD", metric:"cash", limit:3}
                 ← [observed, source:plaid|rho] per account: id, kind, provider,
                   balance ids, valueObservedAt, rawRecordId, syncId, missing flag;
                   basis totals complete, evidence page partial

  ▶ model 3  ──▶ simulate_financial_scenario {…same inputs as the original claim…}
                 ← [conditional] the numbers re-derived, with the assumption list and
                   basis labels that actually produced them

  ▶ model 4  ──▶ answer
```
3 tools, 4 model calls. The chain Sam can now state explicitly:

> `claimed` (what I said) ← `conditional` (this scenario, these assumptions, this basis)
> ← `derived` (cash of X, evaluated at T) ← `observed` (these N accounts from these
> providers, two not observed recently) — and the binding constraint was your 12-month
> floor, which is `stated` management policy, not an observed fact.

That final sentence is the payoff of §6. It is the difference between "our model says no"
and a founder being able to disagree with the assumption rather than the tool.

---

## 8. Minimal implementation plan

Ordered by material product gain. Each step ships independently.

**1. Semantic directory replaces relevance-injected bodies.** *Largest gain.* Removes the
"hope the search finds it" failure mode outright and makes discovery structural.
`lib/memory/types.ts` (optional `list()` + a `supportsMemoryList` guard, mirroring
`MemoryHistory`), `lib/semantic/memory-adapter.ts` (implement via `listCurrentBlocks`),
`lib/agents/sam/context-builder.ts` (fetch directory instead of top-3 search),
`lib/agents/sam/prompt.ts` (render; state truncation when capped),
`harness/context-budget.ts` (count directory entries). Tests: directory contains a block
the question does not lexically match; truncation is announced.

**2. Operating access: headline + `get_operating_inputs`.** *Unblocks a whole question
class.* Land `feat/company-planning-loader` (or lift `stored-source.ts` /
`stored-plan.ts`), add the tool with a policy entry, project the headline into
`SamInitialContext`. Roster aggregated; names never leave the server. Tests: planned
hires reach the model without a semantic search; the roster returns no names; `missing[]`
surfaces rather than defaulting to zero.

**3. Data availability inventory.** *Nearly free — a projection of data already loaded.*
`financialSnapshot` in `lib/finance/sam-surface.ts` (map `health.connections[]` to
provider/status/last-sync/stale) plus payroll-connected and assumptions-present flags,
and the `prompt.ts` section. Tests: a stale Rho connection is visible pre-tool-call.

**4. Epistemic envelope.** *Structural reliability, and shrinks the prompt.*
`tools/result.ts` (second argument), one declaration per tool call site, section tags in
`prompt.ts`, and replace the per-tool epistemic prose with the single precedence rule.
Tests: every forecast result is `conditional` with a non-empty assumption list; an
`unavailable` runway is never tagged `derived`.

**5. Tool hygiene.** *Small, certain.* Add the `get_memory_history` policy entry; fix
`search_memory`'s `summarize` key; drop `kinds` from `searchMemoryInputSchema`; state the
simulate-vs-compare selection rule in both descriptions; repoint `search_memory`'s
description at its residual job; add the capability index to the prompt.

**6. Budgets.** `maxModelCalls` 8 → 12, `maxToolCalls` 12 → 14, `maxContextChars`
12000 → 16000, and count transcript characters in `measureSamContext`. Do this *with* or
*before* step 1 — trace D does not fit under the current ceiling.

### Deferred, with explicit triggers

| Deferred | Trigger to revisit |
| --- | --- |
| Reinstating `search_memory` prominence; directory truncation strategy | A company exceeds ~40 current blocks |
| Persisting `SamRunResult.toolCalls` against the run row | A trace shows a cross-turn forecast rebuilt inconsistently |
| Durable thread memory (summary/notes) | Transcripts get long enough that the full history stops fitting the budget |
| Dynamic tool exposure / capability grouping | A trace shows a wrong tool chosen where the right one was accurately described |

### Explicitly rejected

Embeddings (the KB is small and lexical search plus a complete index beats approximate
similarity at this scale); knowledge graphs; a query language or raw SQL for Sam; a
source-row exploration tool; a think tool; a routing agent; collapsing the three forecast
tools; replacing the brief with a concatenation; any change to `lib/finance/` math,
reconciliation, or the Source Layer schema; redesigning `company_assumptions` storage —
the problem there was access, and access is step 2.
