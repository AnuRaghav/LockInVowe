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
