# LockInVowe: Roadmap & Decision Log

## Current Phase: Foundation (Sept 2026)

The project is in initial setup. Infrastructure is ready; product development begins now.

---

## Phase 1: MVP — Answer 3 Questions Well (Sept-Oct 2026)

### Goal
Build a functioning AI CFO agent that founders can use to ask:
1. "What is my runway?"
2. "Can I afford this hire?"
3. "What happens under different growth scenarios?"

### Phase 1 Work

#### 1.1 Data Ingestion & Normalization
- [ ] Set up Plaid/Rho integration for bank data
- [ ] Set up Stripe integration for revenue data
- [ ] Set up Gusto integration for payroll data
- [ ] Normalize data into PostgreSQL schema
- [ ] Create Supabase tables for accounts, transactions, revenue, payroll

#### 1.2 Financial Model & Onboarding
- [ ] Design company financial model schema
  - Current cash, MRR, growth rate
  - Gross margin, burn rate
  - Planned hires with costs
  - Fundraising plans
  - Minimum runway target
  - Founder risk preferences
- [ ] Build onboarding flow
  - Connect data sources
  - Auto-generate initial assumptions from data
  - Ask founder 5-7 targeted questions
  - Save answers as structured assumptions
  - Generate initial forecasts

#### 1.3 Forecasting Engine (Deterministic, Not LLM)
- [ ] Implement `calculate_runway(cash, monthly_burn, minimum_runway)`
- [ ] Implement `forecast_cash(current, revenue_plan, expenses_plan, months)`
- [ ] Implement `forecast_headcount_cost(hires_plan, salary_schedule)`
- [ ] Implement `compare_scenarios(base, conservative, aggressive)`
- [ ] Store forecast results in database for history & learning

#### 1.4 LLM Agent
- [ ] Build Claude agent that:
  1. Understands founder questions
  2. Retrieves company assumptions from DB
  3. Calls appropriate forecasting functions
  4. Interprets results
  5. Makes clear recommendations
  6. Updates assumptions if new info arrives

#### 1.5 UI & Chat Interface
- [ ] Build chat UI component
- [ ] Dashboard showing current financial state
- [ ] Scenario comparison view
- [ ] Onboarding flow UI
- [ ] Settings page for managing assumptions

### Phase 1 Success Metrics
- Founder can onboard in <5 minutes
- Agent answers runway/hiring/scenario questions in <3 seconds
- Recommendations are backed by company-specific data, not generic LLM output
- Founders trust the recommendations enough to make actual decisions based on them

---

## Phase 2: Learning & Improvement (Oct-Nov 2026)

### Goal
The system learns from actual outcomes and improves recommendations over time.

### Phase 2 Work
- [ ] Implement forecast vs. actual tracking
  - Compare predicted runway vs. actual
  - Track hiring timing vs. plan
  - Measure revenue forecast accuracy
- [ ] Founder decision logging
  - Record all founder decisions
  - Track outcomes (hired? revenue target hit? runway improved?)
- [ ] Bias detection & model refinement
  - Example: "Management historically forecasts revenue 12% too optimistic"
  - Adjust conservative/base/aggressive factors based on historical accuracy
- [ ] Persistent learning
  - Each interaction improves the model for this specific company
  - Recommendations get better as we learn

### Phase 2 Success Metrics
- System can identify its own forecast biases
- Recommendations improve visibly over 30+ days of use
- Founder notices recommendations have become more reliable

---

## Phase 3: Integrations (Nov-Dec 2026)

### Goal
Connect to more data sources & reduce manual input.

### Phase 3 Work
- [ ] QuickBooks/Xero integration for accounting data
- [ ] CRM integration for sales pipeline forecasting
- [ ] Calendar integration for expense tracking
- [ ] Continuous data sync (not just one-time import)

---

## Phase 4: Advanced Features (2027)

### Goal
Add sophisticated financial analysis beyond MVP.

### Phase 4 Work
- [ ] Sensitivity analysis (e.g., "If growth drops 50%, what happens?")
- [ ] Cohort-based revenue models
- [ ] Unit economics analysis
- [ ] Cap table & dilution modeling
- [ ] Fundraising timeline optimization
- [ ] Expense forecasting with ML

---

## Key Decisions Made

### 1. Product Architecture
**Decision**: Forecasting happens in code (Python/TypeScript functions), not in the LLM.

**Rationale**: 
- Financial calculations must be deterministic and auditable
- LLM should interpret results, not do the math
- Enables learning from forecast accuracy over time
- Founder trust depends on reproducible calculations

**Implication**: We need a full forecasting engine, not just a chatbot.

### 2. Persistent Financial Model
**Decision**: Company assumptions are stored in the database and updated continuously, not derived fresh in each conversation.

**Rationale**:
- Founders change their plans; we need to track those changes
- Historical assumptions are essential for learning
- Compare forecast vs. actual requires saved forecast history
- The accumulated intelligence is the moat

**Implication**: Onboarding is critical; it must create a structured baseline model on day 1.

### 3. MVP Scope
**Decision**: Focus on answering 3 questions really well rather than building 10 features poorly.

**Rationale**:
- Founders' top financial anxiety: Do I have enough money? Can I make this hire? What's my plan?
- Nailing these 3 questions is more valuable than shallow answers to 10 questions
- Each question requires solid forecasting logic; perfect the logic first

**Implication**: Don't build CRM forecasting, QuickBooks sync, or cap table modeling in Phase 1.

### 4. Data Connectors as Infrastructure
**Decision**: Data integrations (Plaid, Stripe, Gusto) are infrastructure, not the product.

**Rationale**:
- Lots of existing players have these integrations
- The value is in the financial model & forecasting, not the raw data access
- Spend effort on structure, not on building yet another data connector

**Implication**: Use existing APIs/libraries. Don't build custom Plaid client.

### 5. Anthropic Claude via SDK
**Decision**: Use Anthropic's Claude via the AI SDK, not OpenAI or other providers.

**Rationale**:
- Claude excels at structured reasoning
- AI SDK provides clean abstraction
- Anthropic SDK supports tool use for calling forecasting functions
- Claude's longer context window helps with financial documents

**Implication**: Don't switch LLM providers; invest in Claude's capabilities.

### 6. Supabase for Database
**Decision**: Use Supabase (PostgreSQL) for the financial database.

**Rationale**:
- PostgreSQL is robust for structured financial data
- Supabase provides managed hosting + real-time subscriptions
- SQL is familiar for financial queries
- Can add Python data science later if needed

**Implication**: Design schema carefully; financial data demands integrity.

### 7. Vercel Deployment
**Decision**: Deployed to Vercel with auto-deployment on main branch merge.

**Rationale**:
- Serverless functions for API endpoints
- Fast iteration without infrastructure overhead
- Easy to scale
- Works well with Next.js

**Implication**: Keep API routes stateless; use Supabase for state.

---

## Non-Decisions (Explicitly Avoiding)

These are things we've decided NOT to build initially:

1. **Custom data connectors** — Use existing APIs
2. **Advanced financial modeling** — Start with simple forecasts
3. **Multi-currency support** — Single currency (USD) for MVP
4. **Multi-company support** — Single company per account for MVP
5. **Regulatory/compliance features** — Not in scope for Phase 1
6. **Email/SMS notifications** — Not in scope for Phase 1
7. **Mobile app** — Web first; mobile later if valuable

---

## Open Questions for Team

1. **Data accuracy**: How do we ensure imported data is correct?
   - Should there be a data validation step in onboarding?
   - How do we handle duplicate transactions?

2. **Assumptions updates**: When a founder says "actually, I'm hiring 4 engineers instead of 2," what happens?
   - Auto-update the model?
   - Ask for confirmation?
   - Log the change?

3. **Forecast confidence**: How do we surface forecast uncertainty?
   - Confidence intervals?
   - Range instead of point estimates?
   - Sensitivity analysis?

4. **Recommendations tone**: How forceful should agent recommendations be?
   - "You can do this" vs. "Recommended approach is..."?
   - Should recommendations vary by founder risk tolerance?

5. **Founder privacy**: What company financial data do we surface in UI?
   - Avoid showing actual employee names/salaries?
   - Anonymize revenue figures in screenshots?

---

## Success Metrics (Overall)

By end of Phase 1 (Oct 2026):
- **Adoption**: 5-10 beta founders actively using
- **Engagement**: Average 10+ questions per founder per week
- **Recommendation quality**: Founders report taking action based on agent recommendations
- **Forecast accuracy**: Initial forecasts vs. actuals track within 15% by end of month

By end of Phase 2 (Nov 2026):
- **Learning**: Agent recommendations visibly improve (e.g., "I predicted conservatively before, I've adjusted")
- **Trust**: Founders make hiring decisions directly informed by agent analysis
- **Scale**: 20+ beta founders
- **Moat**: Historical data for 5+ founders show learning effects

---

## Resources

- **Engineering Overview**: See `ai_cfo_engineering_overview.md` (project start document)
- **Tech Stack Details**: [DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md)
- **Project Overview**: [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md)
- **Claude.md (Project Instructions)**: [CLAUDE.md](../../CLAUDE.md)

---

## How to Update This Roadmap

When you:
1. Complete a task → update the ✓ checkbox
2. Make a new decision → add it to the "Key Decisions" section with rationale
3. Find a new open question → add it to "Open Questions"
4. Discover something that changes priorities → update this file before proceeding

This document is the team's shared understanding of the project. Keep it current.
