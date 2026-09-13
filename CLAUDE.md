# LockInVowe Project Guide for Claude Agents

## Quick Overview

**What we're building**: An AI CFO agent for startup founders that combines real-time financial data with a structured financial model and deterministic forecasting.

**Why it matters**: Founders can ask "What's my runway?" or "Can I hire 3 engineers?" and get answers backed by their actual company data + sophisticated financial modeling—not just LLM-generated guesses.

**The moat**: The accumulated financial intelligence (company assumptions, forecast history, actual outcomes, decision history) that improves recommendations over time. This is NOT just another chat interface.

---

## 📖 Read This First

**See [.claude/project-context/PROJECT_OVERVIEW.md](./.claude/project-context/PROJECT_OVERVIEW.md)** for the full technical architecture, MVP scope, and current status.

---

## Tech Stack

- **Frontend**: Next.js 16.3.5, React 19, TypeScript, Tailwind CSS 4
- **Backend**: Next.js API routes on Vercel
- **Database**: Supabase (PostgreSQL)
- **Auth**: Supabase Auth
- **AI**: Claude via Anthropic SDK (ai v4.1, @ai-sdk/anthropic v0.0.50)
- **Hosting**: Vercel (auto-deploys on push to main)

---

## Deployment

- **Local**: `npm install && npm run dev` → http://localhost:3000
- **Staging**: Create a pull request → auto-deploys preview URL
- **Production**: Merge to `main` → auto-deploys to https://lockinvowe.vercel.app
- **Env vars**: All configured in Vercel (development/preview/production)

---

## Key Architectural Decisions

1. **Forecasting happens in code, not in the LLM** — Call deterministic functions (`calculate_runway()`, `forecast_cash()`, etc.), then let the LLM interpret results
2. **Persistent financial model** — Store company assumptions, plans, and goals separately from raw transactions. Update them continuously.
3. **Onboarding is critical** — The first conversation should establish the company's baseline financial memory (cash, MRR, growth targets, hiring plans, minimum runway, etc.)
4. **Three scenarios always** — Base case, conservative, aggressive. Let founders explore trade-offs.

---

## Current Status

- ✅ Project linked to Vercel
- ✅ Supabase connected
- ✅ Environment variables configured (all 3 environments)
- ✅ Local development ready
- ✅ Source Layer: provider-neutral schema + Plaid and Rho adapters (`lib/source/`)
- ❌ Numerical Model (not started)
- ❌ Onboarding flow (not started)
- ❌ Forecasting engine (not started)
- ❌ Agent implementation (not started)

---

## When Starting a Task

**1. Read the overview first**
   → [.claude/project-context/PROJECT_OVERVIEW.md](./.claude/project-context/PROJECT_OVERVIEW.md)

**2. Understand the architecture**
   - Where does your task sit in the pipeline?
   - Are you building data connectors? Financial model? Forecasting? Agent?

**3. Remember the moat**
   - Your code should improve financial decision-making, not just move data around
   - Structured assumptions + historical learning matter more than raw LLM capability

**4. For agent tasks:**
   - The agent should call forecasting functions, not do financial math in prompts
   - Results should be backed by company-specific data and goals
   - Recommendations should compare scenarios and explain trade-offs

---

## Key Files & Folders

```
/
├── .claude/
│   └── project-context/
│       └── PROJECT_OVERVIEW.md         ← Read this!
├── CLAUDE.md                            ← You are here
├── .env.example                         ← Env var template
├── .env.local                           ← Your local env (git-ignored)
├── .vercel/project.json                 ← Vercel project linkage
├── package.json                         ← Dependencies (Next.js, Supabase, Anthropic)
├── src/
│   ├── app/                             ← Next.js app router
│   └── lib/                             ← Utilities (Supabase client, etc.)
└── supabase/                            ← (To be created) DB migrations & schema
```

---

## Reference: AGENTS.md

@AGENTS.md
