# LockInVowe: CFO/Ops AI Agent

An AI agent that helps startup founders delegate financial and operational tasks. Built for the hackathon with a focus on rapid iteration and team collaboration.

## Tech Stack

- **Frontend/Backend**: Next.js 15 (App Router) + TypeScript
- **Styling**: Tailwind CSS
- **Database**: Supabase (PostgreSQL)
- **LLM**: Vercel AI SDK (chat endpoint) + LangChain (`@langchain/anthropic`) for the Sam agent
- **Voice**: ElevenLabs (optional)
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

## The Sam Agent

Sam is the CFO/ops agent, built on LangChain with Claude via `@langchain/anthropic`.

```ts
import { runSamAgent } from "@/lib/agents/sam";

const { text, toolCalls } = await runSamAgent({
  messages: "We have $600k in the bank, $20k MRR, and spend $70k a month. How long do we have?",
});
```

**The boundary that matters**: the LLM decides *what* information or calculation
a question needs and calls the matching tool. Deterministic code in
`lib/finance/` does the actual math. Never put a formula, threshold, or domain
rule in a prompt — it belongs in `lib/finance/`, with a test.

To add a tool: write the calculation in `lib/finance/`, wrap it in a thin
`tool()` adapter under `lib/agents/sam/tools/` with a `zod` schema, and register
it in `lib/agents/sam/tools/index.ts`.

Voice is optional: `speak(text)` in `lib/agents/sam/voice.ts` returns an audio
stream when ElevenLabs credentials are set, and `null` otherwise.

## Project Structure

```
.
├── app/                    # Next.js App Router pages & API routes
│   └── api/chat/          # AI agent chat endpoint
├── lib/
│   ├── agents/sam/        # Sam: the CFO/ops agent (LangChain + Claude)
│   ├── finance/           # Deterministic financial calculations
│   ├── supabase/          # Supabase client setup
│   └── ai/                # LLM provider configuration
├── components/            # Reusable React components
├── supabase/              # Database migrations & schema
└── .env.example           # Environment variables template
```

## Where to Build

- **Sam Agent**: `lib/agents/sam/` — model config, system prompt, tool registry, public `runSamAgent()`
- **Financial Logic**: `lib/finance/` — plain TypeScript, no LLM. Sam's tools call into here
- **AI Agent Logic**: `lib/ai/provider.ts` (change LLM provider here), `app/api/chat/route.ts` (add tools/agents)
- **Database Schema**: `supabase/schema.sql` (track all schema changes)
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
- [ ] Test chat endpoint: `curl -X POST http://localhost:3000/api/chat -H "Content-Type: application/json" -d '{"messages":[{"role":"user","content":"Hello"}]}'`
- [ ] Start building!
