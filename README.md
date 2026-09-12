# LockInVowe: CFO/Ops AI Agent

An AI agent that helps startup founders delegate financial and operational tasks. Built for the hackathon with a focus on rapid iteration and team collaboration.

## Tech Stack

- **Frontend/Backend**: Next.js 15 (App Router) + TypeScript
- **Styling**: Tailwind CSS
- **Database**: Supabase (PostgreSQL)
- **LLM**: Vercel AI SDK (provider-agnostic, defaults to Anthropic Claude)
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

## Project Structure

```
.
├── app/                    # Next.js App Router pages & API routes
│   └── api/chat/          # AI agent chat endpoint
├── lib/
│   ├── supabase/          # Supabase client setup
│   └── ai/                # LLM provider configuration
├── components/            # Reusable React components
├── supabase/              # Database migrations & schema
└── .env.example           # Environment variables template
```

## Where to Build

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
