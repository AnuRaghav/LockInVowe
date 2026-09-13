# Development Guide for LockInVowe

## Getting Started

### Prerequisites
- Node.js 24.x
- npm/yarn/pnpm/bun
- Supabase account (already configured)
- Anthropic API key (already configured)

### Local Setup
```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Open browser
http://localhost:3000
```

### Build & Test Production
```bash
# Build for production
npm run build

# Start production server
npm start
```

---

## Git Workflow

```bash
# Create feature branch
git checkout -b feature/my-feature

# Make changes, test locally
npm run dev
# ... edit code ...

# Commit
git add .
git commit -m "feat: describe what you built"

# Push to GitHub
git push origin feature/my-feature

# Create PR → Vercel auto-deploys preview URL

# After review, merge to main
git merge feature/my-feature
git push origin main

# Vercel auto-deploys to production
# → https://lockinvowe.vercel.app
```

---

## Database

### Supabase Project
- **Project Ref**: `mmnbhqtmjfqwqxqcojop`
- **URL**: https://mmnbhqtmjfqwqxqcojop.supabase.co
- **Access**: Via Supabase client (see `src/lib/supabase.ts`)

### Schema Management

The project uses Supabase with PostgreSQL. To add/modify tables:

1. **Option A: SQL in Supabase dashboard**
   - Go to https://supabase.com/dashboard
   - Select LockInVowe project
   - SQL Editor → write migrations

2. **Option B: Local CLI** (preferred for version control)
   ```bash
   # Initialize Supabase locally (if not done)
   supabase init
   
   # Link to remote project
   supabase link --project-ref mmnbhqtmjfqwqxqcojop
   
   # Create a migration
   supabase migration new add_financial_assumptions
   
   # Edit the migration file in supabase/migrations/
   
   # Apply locally
   supabase migration up
   
   # Push to remote
   supabase db push
   ```

### Key Tables (To Be Created)

Based on the financial model, expect tables like:
- `companies` — Company profiles
- `financial_assumptions` — Structured assumptions (cash, MRR, growth targets, etc.)
- `transactions` — Bank/payment transactions
- `revenue_events` — Stripe events, subscription data
- `payroll_events` — Gusto/payroll data
- `headcount_plans` — Planned hiring
- `forecasts` — Stored forecast results
- `forecast_history` — Historical forecasts for accuracy tracking
- `decisions` — Recorded founder decisions
- `scenarios` — Base/conservative/aggressive scenario definitions

---

## API & Routing

### Next.js App Router
Routes are in `src/app/`. For example:
- `src/app/page.tsx` → `/`
- `src/app/api/chat/route.ts` → `/api/chat`
- `src/app/dashboard/page.tsx` → `/dashboard`

### Creating an API Endpoint
```typescript
// src/app/api/forecast/route.ts

import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  const { companyId, scenario } = await request.json();

  // Fetch company assumptions
  const { data: assumptions } = await supabase
    .from('financial_assumptions')
    .select('*')
    .eq('company_id', companyId);

  // Run forecasting logic
  const forecast = calculateRunway(assumptions, scenario);

  return NextResponse.json(forecast);
}
```

### Using the Anthropic SDK
```typescript
// Example: Call Claude from an API route

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const message = await anthropic.messages.create({
  model: 'claude-opus-4-1',
  max_tokens: 1024,
  messages: [
    {
      role: 'user',
      content: 'What is my runway?',
    },
  ],
});
```

---

## Environment Variables

All env vars are stored in Vercel and pulled locally via:
```bash
vercel env pull .env.local
```

**Do NOT commit `.env.local`** — it's git-ignored.

Required vars:
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL (public)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anon key (public)
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key (secret)
- `ANTHROPIC_API_KEY` — Anthropic API key (secret)

---

## Code Organization

```
src/
├── app/
│   ├── page.tsx              — Homepage
│   ├── api/
│   │   ├── chat/route.ts     — Chat endpoint
│   │   ├── forecast/route.ts — Forecasting endpoint
│   │   └── ...
│   ├── dashboard/
│   │   ├── page.tsx          — Dashboard
│   │   └── ...
│   └── layout.tsx            — Root layout
│
├── lib/
│   ├── supabase.ts           — Supabase client
│   ├── forecast.ts           — Forecasting functions
│   ├── financial-model.ts    — Company financial model logic
│   └── ...
│
├── components/
│   ├── chat.tsx              — Chat UI
│   ├── dashboard.tsx         — Dashboard UI
│   └── ...
│
└── types/
    └── index.ts              — TypeScript types
```

---

## Key Concepts to Remember

### 1. Structured Financial Model
- Don't just pass raw data to the LLM
- Create structured assumptions during onboarding
- Store: cash, MRR, growth targets, planned hiring, minimum runway, fundraising plans, risk preferences
- Each assumption should have: value, source, confidence, date

### 2. Forecasting is Code
```typescript
// ✅ DO THIS
function calculateRunway(
  cashBalance: number,
  monthlyBurn: number,
  minimumCash: number = 0
): number {
  return (cashBalance - minimumCash) / monthlyBurn;
}

// ❌ DON'T DO THIS
"Based on your cash and burn rate, your runway is approximately..."
```

### 3. Scenarios
Always compare at least 3:
- **Base case**: Expected outcome based on assumptions
- **Conservative**: Assume slower growth, higher expenses
- **Aggressive**: Faster growth, controlled expansion

### 4. Founder Goals Matter
- Each founder has different risk tolerance
- Minimum runway preference varies (some want 6mo, others 18mo)
- Store these preferences with the financial model
- Use them in recommendations

Example:
```typescript
interface CompanyAssumptions {
  currentCash: number;
  monthlyBurn: number;
  monthlyRevenue: number;
  
  // Goals & preferences
  minimumRunway: number; // e.g., 12 months
  growthTarget: number; // e.g., 0.07 for 7% monthly
  riskTolerance: 'conservative' | 'balanced' | 'aggressive';
  
  // Plans
  plannedHires: Hire[];
  fundraisingPlans: FundraisingPlan[];
}
```

---

## Testing & Validation

### Testing Forecasts
When you implement the forecasting engine, test with real company data:

```typescript
// Example: Test runway calculation
const assumptions = {
  cash: 1_800_000,
  monthlyBurn: 150_000,
  minimumRunway: 12,
};

const runway = calculateRunway(assumptions.cash, assumptions.monthlyBurn);
// runway should be 12 months

const runwayWithHire = calculateRunway(
  assumptions.cash,
  assumptions.monthlyBurn + 200_000 // new engineer
);
// runway should be < 12 months

// Verify recommendations make sense
expect(runwayWithHire).toBeLessThan(assumptions.minimumRunway);
```

---

## Common Tasks

### Add a New API Endpoint
1. Create `src/app/api/[feature]/route.ts`
2. Implement POST/GET logic
3. Call Supabase or forecasting functions
4. Return JSON response

### Add a New UI Page
1. Create `src/app/[feature]/page.tsx`
2. Import components from `src/components/`
3. Use Supabase client to fetch data
4. Render with Tailwind CSS

### Update Database Schema
1. Write SQL migration in Supabase dashboard or CLI
2. Test locally with `supabase migration up`
3. Push to remote with `supabase db push`
4. Update TypeScript types in `src/types/index.ts`

### Deploy a Change
1. Push to feature branch, create PR
2. Vercel auto-deploys preview URL
3. Test in preview
4. Merge to main
5. Vercel auto-deploys to production in ~2 minutes

---

## Debugging

### View Vercel Logs
```bash
vercel logs
```

### View Supabase Logs
- Go to https://supabase.com/dashboard → Logs

### Local Development
```bash
# Run with debug output
DEBUG=* npm run dev

# Or check browser console for errors
http://localhost:3000 → DevTools → Console
```

---

## Performance Notes

- Forecasting functions should run in <100ms
- Supabase queries should use indexes on frequently-filtered columns
- Cache company assumptions in memory or local state when possible
- Avoid N+1 queries — batch Supabase requests

---

## Questions?

If you need more context:
1. Read [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md)
2. Check [CLAUDE.md](../../CLAUDE.md)
3. Review the engineering overview document provided at project start
