# LockInVowe: AI CFO Agent for Startup Founders

## Executive Summary

**LockInVowe** is an AI financial agent that helps startup founders make better financial decisions by combining real-time financial data with a structured, continuously-improving financial model and deterministic forecasting engine.

**The product is NOT just a chat interface.** The core differentiation is the persistent financial model that tracks company assumptions, forecasts, and outcomes over time.

---

## Product Goal

Build an AI financial agent that can:
1. Answer financial questions (e.g., "What's my runway?")
2. Run scenario forecasts (e.g., "Can I hire 3 engineers?")
3. Make recommendations based on company-specific goals and constraints
4. Improve recommendations over time by learning from actual results

---

## Core Architecture

```
Financial Data Sources (Plaid/Rho/Stripe/Gusto/QB)
                ↓
Data Ingestion + Normalization (PostgreSQL)
                ↓
Persistent Financial Database (Company Financial Model)
                ↓
Deterministic Forecasting Engine (runs in code, not LLM)
                ↓
LLM Agent (Claude via Anthropic SDK)
                ↓
Founder Chat Interface → Recommendations
```

---

## Key Components

### 1. Data Connectors
- **Initial MVP**: Bank (Plaid/Rho), Stripe, Payroll (Gusto)
- **Later**: QuickBooks, Xero, CRM data
- Role: Connect to external systems, provide raw data

### 2. Normalized Financial Database (Supabase/PostgreSQL)
Core entities:
- Accounts, Cash balances, Transactions
- Revenue, Expenses, Vendors
- Employees, Payroll, Subscriptions
- Customers, Funding events

### 3. Persistent Company Financial Model
Created during **onboarding**, continuously updated.

Stores structured assumptions:
```
Current State:
  cash: $1.8M
  mrr: $170K
  gross_margin: 76%

Plans & Goals:
  monthly_growth_target: 7%
  minimum_runway: 12 months

Planned Changes:
  planned_hires:
    - Engineer (Nov 2026, $205K)
    - AE (Jan 2027, $180K)

Fundraising:
  target: Series A
  date: June 2027
  amount: $8M
```

Each assumption includes:
- Value
- Source (data, founder input, derived)
- Created/updated date
- Confidence level
- Scenarios it belongs to

### 4. Deterministic Forecasting Engine
Financial math happens in **code**, not in LLM.

Core functions:
- `calculate_runway()`
- `forecast_cash()`
- `forecast_revenue()`
- `forecast_headcount_cost()`
- `calculate_burn()`
- `compare_scenarios()`
- `estimate_fundraising_date()`

Supports at least 3 scenarios:
- Base case
- Conservative case
- Aggressive case

### 5. AI Financial Agent
Responsibilities:
1. Understand the founder's question
2. Retrieve relevant company data + assumptions
3. Determine which forecasts to run
4. Update assumptions when new information arrives
5. Call forecasting functions
6. Explain results clearly
7. Make recommendations

Example conversation:
```
Founder: "Can we hire 3 engineers?"

Agent:
  → Retrieves hiring assumptions
  → Checks current cash + burn
  → Runs hiring scenario
  → Compares runway vs. minimum requirement
  → Returns recommendation

Response:
"You can afford all three hires, but it reduces 
projected runway from 15.2 to 10.8 months, below 
your 12-month minimum. I recommend hiring two now 
and making the third conditional on reaching $250K MRR."
```

---

## MVP Scope

**Focus on these 3 questions extremely well:**

1. **"What is my runway?"** — Cash + burn rate analysis
2. **"Can I afford this hire/expense?"** — Scenario modeling
3. **"What happens under different growth scenarios?"** — Sensitivity analysis

**MVP Integrations:**
- Bank data (Plaid/Rho)
- Stripe (revenue/subscriptions)
- Payroll (Gusto)

**MVP Onboarding Flow:**
1. Connect bank, Stripe, payroll
2. Auto-construct initial financial model from data
3. Identify missing assumptions
4. Ask founder targeted questions
5. Save answers as structured persistent memory
6. Generate base/conservative/aggressive forecasts

---

## Product Moat

**NOT a moat:**
- Claude/GPT (commoditized)
- Chat interface (commoditized)
- Data connectors (widely available)
- Generic conversational memory (not enough)

**IS the moat:**
- Structured company financial model
- Historical assumptions + changes
- Forecast history + actual outcomes
- Founder goals + risk preferences
- Decision history
- Company-specific forecasting behavior
- Financial recommendations that improve over time

A founder can plug Plaid into ChatGPT and query financial data. Our product maintains and continuously improves the company's **financial operating model**. That's defensible.

---

## Tech Stack (Current)

- **Frontend**: Next.js 16.3.5, React 19.2.8, TypeScript, Tailwind CSS 4
- **Backend**: Next.js API routes, Vercel deployment
- **Database**: Supabase (PostgreSQL)
- **Auth**: Supabase Auth + @supabase/ssr
- **AI**: Claude via Anthropic SDK (`ai` package v4.1, `@ai-sdk/anthropic`)
- **Hosting**: Vercel

---

## Current Status

| Component | Status | Notes |
|-----------|--------|-------|
| Repo setup | ✅ | GitHub + Vercel linked, env vars configured |
| Local dev | ✅ | Ready to run: `npm install && npm run dev` |
| Data connectors | ❌ | Not started |
| Database schema | ❌ | Not started |
| Onboarding flow | ❌ | Not started |
| Forecasting engine | ❌ | Not started |
| Agent implementation | ❌ | Not started |

---

## Deployment & Branching Strategy

- **Local development**: Feature branches, `npm run dev`
- **Previews**: Create PR → auto-deploys preview URL
- **Production**: Merge to `main` → auto-deploys to https://lockinvowe.vercel.app
- **Env vars**: All set in Vercel for development/preview/production

---

## Team Notes

- **Project owner**: Anuraghav (@ap8414@nyu.edu)
- **Collaborators**: Share `.env.local` credentials for local development
- **Decision**: Full stack—focus on the financial model and deterministic forecasting, not just LLM chat
