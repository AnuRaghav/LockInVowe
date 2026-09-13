# LockInVowe: CFO/Ops AI Agent

An AI agent that helps startup founders delegate financial and operational tasks. Built for the hackathon with a focus on rapid iteration and team collaboration.

## Tech Stack

- **Frontend/Backend**: Next.js 15 (App Router) + TypeScript
- **Styling**: Tailwind CSS
- **Database**: Supabase (PostgreSQL)
- **LLM**: Vercel AI SDK (chat endpoint) + LangChain (`@langchain/anthropic`) for the Sam agent
- **Deploy**: Vercel

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Set up environment variables

Copy `.env.example` to `.env.local` and fill in your credentials:

```bash
cp .env.example .env.local
```

You'll need:
- **Supabase**: Project URL and keys from [supabase.com](https://supabase.com)
- **LLM API Key**: Anthropic, OpenAI, or another provider supported by the AI SDK

### 3. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Checks

```bash
npm run lint
npm run typecheck
npm test
```

## Database & Migrations

Schema changes are versioned SQL migrations under `supabase/migrations/`, applied
by the Supabase CLI (pinned as a devDependency — no global install needed). There
is no hand-maintained `schema.sql`; the migration history *is* the schema.

Running the local stack needs Docker.

| Command | What it does |
| --- | --- |
| `npm run db:start` | Start the local Supabase stack (Postgres, API, Studio) |
| `npm run db:stop` | Stop it |
| `npm run db:status` | Show local service URLs and keys |
| `npm run db:migration <name>` | Create `supabase/migrations/<timestamp>_<name>.sql` |
| `npm run db:migrate` | Apply pending migrations to the local database |
| `npm run db:reset` | Drop and rebuild the local database from every migration |
| `npm run db:types` | Regenerate `lib/supabase/types.ts` from the local schema |

Typical loop:

```bash
npm run db:start
npm run db:migration add_companies      # write SQL in the new file
npm run db:reset                        # replay the full history locally
npm run db:types                        # refresh the generated types
```

Commit the migration file and the regenerated `lib/supabase/types.ts` together.
Never edit an already-merged migration — add a new one.

`supabase/migrations/` is deliberately empty: the real tables arrive with the
company semantic model. `lib/supabase/types.ts` is a placeholder with an empty
`public` schema until then, and `npm run db:types` replaces it wholesale.

## The Sam Agent

Sam is the CFO/ops agent, built on LangChain with Claude via `@langchain/anthropic`.

```ts
import { runSamAgent } from "@/lib/agents/sam";

const { text, toolCalls } = await runSamAgent({
  messages: "We have $600k in the bank, $20k MRR, and spend $70k a month. How long do we have?",
  context: { companyId },
});
```

**The boundary that matters**: the LLM decides *what* information or calculation
a question needs and calls the matching tool. Deterministic code in
`lib/finance/` does the actual math. Never put a formula, threshold, or domain
rule in a prompt — it belongs in `lib/finance/`, with a test.

### Company-scoped tool context

Sam always runs inside an explicit company context. Claude chooses **which tool
to call**; the application chooses **which company it operates on**. The two are
kept apart on purpose — a `companyId` that the model could emit is a `companyId`
a prompt injection or a hallucination can point at someone else's data.

```text
request
  ↓ resolveCompanyContext(req)            lib/company/context.ts
runSamAgent({ messages, context })        lib/agents/sam/agent.ts
  ↓ agent.invoke(state, { context })      contextSchema: samContextSchema
Sam chooses a tool
  ↓ tool(input, runtime)                  input = model args, runtime.context = trusted
requireSamContext(runtime, toolName)      lib/agents/sam/context.ts
  ↓
deterministic domain code (lib/finance/) → Supabase
```

- `SamContext` (`lib/agents/sam/context.ts`) is the trusted payload — `companyId`
  today, more fields later. It is passed to `runSamAgent()` once per request and
  reaches tools through LangChain's `contextSchema` / `runtime.context`, so it is
  never serialized into the model's tool arguments.
- **TEMPORARY:** with no auth yet, `resolveCompanyContext()` returns a fixed
  development company (`DEV_COMPANY_ID`, overridable per-request in non-production
  via the `x-dev-company-id` header). Replace that one function with authenticated
  workspace resolution when auth lands — nothing downstream changes.

### Adding a tool

1. Write the calculation in `lib/finance/` (or another domain module) as plain,
   tested TypeScript with no LLM awareness.
2. Wrap it in a thin `tool()` adapter under `lib/agents/sam/tools/`.
3. The `zod` schema declares **only the arguments Claude is allowed to choose**.
   Anything identifying *whose* data is involved belongs in `SamContext`.
4. Read the trusted context with `requireSamContext(runtime, toolName)`.
5. Wrap the body in `runTool()` (`lib/agents/sam/tools/result.ts`) so every tool
   returns the same `{ ok: true, data }` / `{ ok: false, error }` envelope —
   failures come back to the model instead of aborting the run.
6. Register it in `lib/agents/sam/tools/index.ts`.

`lib/agents/sam/tools/calculate-runway.ts` is the reference implementation.

Sam uses text conversations with streaming answers and inline charts. No microphone
access or audio provider credentials are required.

## Project Structure

```
.
├── app/                    # Next.js App Router pages & API routes
│   └── api/chat/          # AI agent chat endpoint
├── lib/
│   ├── agents/sam/        # Sam: the CFO/ops agent (LangChain + Claude)
│   ├── finance/           # Deterministic financial calculations
│   ├── company/           # Company (workspace) resolution - TEMPORARY dev stub
│   ├── supabase/          # Supabase clients + generated database types
│   └── ai/                # LLM provider configuration
├── components/            # Reusable React components
├── supabase/
│   ├── config.toml        # Local Supabase stack config
│   └── migrations/        # Versioned SQL migrations
└── .env.example           # Environment variables template
```

## Where to Build

- **Sam Agent**: `lib/agents/sam/` — model config, system prompt, tool registry, public `runSamAgent()`
- **Financial Logic**: `lib/finance/` — plain TypeScript, no LLM. Sam's tools call into here
- **AI Agent Logic**: `lib/ai/provider.ts` (change LLM provider here), `app/api/chat/route.ts` (add tools/agents)
- **Database Schema**: `supabase/migrations/` (one versioned migration per change)
- **UI Components**: `components/` (shared across pages)
- **Pages**: `app/` (new routes go here)

## Workflow for Teams

1. **Create a feature branch**: `git checkout -b feature/your-feature-name`
2. **Make your changes** in your assigned area
3. **Push and create a PR** to `main`
4. **No direct pushes to main** — all code goes through PRs for visibility

## Deploy to Vercel

```bash
git push origin main
```

Vercel auto-deploys on push to main. Set environment variables in Vercel project settings to match `.env.example`.

## Next Steps

- [ ] Create Supabase project and add credentials to `.env.local`
- [ ] Choose LLM provider and add API key
- [ ] Design the company semantic model and land it as the first migration
- [ ] Replace `resolveCompanyContext()` with authenticated workspace resolution
- [ ] Test chat endpoint: `curl -X POST http://localhost:3000/api/chat -H "Content-Type: application/json" -d '{"messages":[{"role":"user","content":"Hello"}]}'`
- [ ] Start building!
