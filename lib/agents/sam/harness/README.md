# Sam execution harness

The agent decides *what* to do. This layer decides *how much that is allowed to
cost, what happens when it fails, and what is recorded about it*.

It is deliberately small. Where LangChain already solves a problem well, we use
its middleware rather than rebuilding it.

## What runs where

| Concern | Mechanism |
| --- | --- |
| Model-call budget | `modelCallLimitMiddleware` (native) |
| Tool-call budget, global and per tool | `toolCallLimitMiddleware` (native) |
| Transient model retries | `modelRetryMiddleware` (native) |
| Transient tool retries, retry-safe tools only | `toolRetryMiddleware` (native) |
| Run deadline + cancellation | `AbortSignal.any([caller, AbortSignal.timeout])` into `agent.invoke` |
| Loop backstop | LangGraph `recursionLimit`, derived from the budgets |
| Per-call timeouts, timing, token usage, tool governance | `SamExecutionMiddleware` (ours) |
| Repeated-identical-call protection | `SamNoProgressMiddleware` (ours) |
| Termination reason | `classifyRunFailure` → `SamRunOutcome` |

Ordering is the design: earlier middleware wraps later. No-progress detection
sits *outside* the retry middleware, so a deliberate retry of the same call is
never mistaken for the model looping.

## Watching a run: the event contract

`harness/events.ts` defines `SamRunEvent` - **our** vocabulary for a run in
flight. LangChain and LangGraph event formats are translated at the boundary and
never reach a caller, so replacing the framework is a change to
`executeSamRun` and nothing else.

Every event carries `runId`, a monotonic `seq`, and `at`. The union:

| Event | Meaning |
| --- | --- |
| `run_started` | accepted; budget is ticking (`trigger` distinguishes a founder from a future background run) |
| `context_built` | what this turn opens knowing - counts and budget, never content |
| `context_failed` | an optional dependency failed; the run continues with less |
| `model_started` / `model_completed` / `model_failed` | one attempt each, retries included |
| `message_delta` | a fragment of the **visible** reply |
| `tool_started` | `name`, `kind`, and the tool's declared `label` ("Calculating runway") |
| `tool_completed` | duration, result size, truncation, and the declared summary if any |
| `tool_failed` | duration, error, `retryable`, `critical` |
| `tool_repeat_blocked` | non-progress protection refused a duplicate call |
| `tool_awaiting_approval` | a state-changing tool is waiting on a human |
| `run_completed` | terminal; the answer plus the full `SamRunRecord` |
| `run_terminated` | terminal; budget, deadline, cancellation, or failure |

`SamRunObserver` is the single seam: `runSamAgent` hands it to a logger,
`streamSamAgent` hands it to a queue. There is no second source of truth.

### One execution path

`streamSamAgent` is not a second agent. Both entry points call
`prepareSamRun` → `buildSamAgent` → `executeSamRun` → `completedSamResult` /
`failedSamResult`. `executeSamRun` always runs the graph with
`streamMode: ["values", "messages"]`; the only difference is whether an
`onDelta` callback is listening. Same policy, same middleware, same outcomes -
nothing to drift.

### What is never streamed

- **Private reasoning.** Only `text` content blocks become `message_delta`;
  Anthropic `thinking` and `redacted_thinking` blocks are dropped, as are
  tool-argument fragments and tool messages on the same channel.
- **Raw tool payloads.** Tool events carry shape - name, kind, status, duration,
  size. Anything derived from a result reaches a caller only through a
  `summarize` function the tool itself declared, kept qualitative (a status
  word, a count) and never the company's figures.

### Cancellation

`streamSamAgent` owns an `AbortController` merged into the same signal chain the
harness already uses. Abandoning the iterator - `break`, `return`, a closed HTTP
connection - aborts it, the run ends `cancelled`, and a terminal event is still
emitted to any observer. A caller's own `signal` works exactly as before.

### Room left

The contract is shaped so these need new *tool policies and events*, not a new
mechanism: source-data retrieval and semantic-memory retrieval are `read_only`
tools, numerical work is `calculation`, approvals already have
`tool_awaiting_approval`, and proactive runs already have `trigger: "system"`.

## Checkpointing: deliberately deferred

`createAgent()` runs on LangGraph, so a `checkpointer` is one option away. We
did not add one, because today it would buy nothing and cost something:

- **Thread continuity already exists elsewhere.** The API route sends the full
  message history on every request, and thread working state lives behind
  `ThreadMemory`. A checkpointer would be a second, overlapping home for the
  same conversation state, with no rule for which wins.
- **Nothing durable to write to.** Sam runs on Vercel's serverless functions.
  The only checkpointer available without new infrastructure is in-process, and
  in-process state does not survive the next invocation - so it would give the
  appearance of recoverability without the substance.
- **No interrupt to resume from.** Checkpointing pays for itself with
  human-in-the-loop approval and mid-run resume. Sam has no state-changing tool
  yet, so there is nothing to pause on.

**Revisit when** the first state-changing tool ships (approval needs a resumable
interrupt) or when runs get long enough that restarting one is expensive. At
that point the change is `checkpointer: <saver>` on `createAgent` plus a
`thread_id` in the invoke config - the harness already threads a `threadId`
through the trusted runtime context, so nothing else moves.

## Context budget

The shape we hold to:

```
small relevant initial context  +  just-in-time retrieval  +  bounded tool results
```

- The Context Builder selects a few memories, not everything the company knows.
- The memory tools reach the rest mid-loop, when Sam finds it needs to.
- `SamExecutionMiddleware` refuses any tool result over
  `policy.maxToolResultChars`, with instructions to narrow the request, so one
  tool cannot flood the window.
- `measureSamContext` records the assembled size on every run.

There is no token allocator, on purpose. When the recorded sizes show threads
outgrowing the budget, the next step is LangChain's `summarizationMiddleware` or
`contextEditingMiddleware` added to the stack in `run.ts` - which is why the
measurement exists first.

## Deliberately deferred

Not built, and not designed out either:

- **Circuit breakers / bulkheads** around Anthropic and future data providers.
  Retries are bounded and classified, so a breaker wraps this rather than
  replacing it.
- **Queues, and any out-of-process execution.** A run is one request today.
- **Fallback model routing.** `modelFallbackMiddleware` exists natively if a
  second model is ever warranted; one model with retries is the simpler correct
  default.
- **Distributed rate limiting.** Budgets here are per run, not per tenant.
- **Human approval UI.** The gate is implemented
  (`SamToolPolicy.requiresApproval` + `SamToolApprover`); no tool sets it, so it
  never fires. Only the interface is missing.
- **Persisted run records.** `SamRunObserver` is the seam; today the default
  observer writes structured log lines.
- **Stream backpressure and resumability.** Events buffer in memory for one
  consumer; a run cannot be re-attached after a dropped connection. Both want a
  durable event log first, which is the same seam as above.
