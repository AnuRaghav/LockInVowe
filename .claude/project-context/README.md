# LockInVowe Project Context

Welcome! This folder contains everything you need to understand and contribute to LockInVowe.

## 🎯 Start Here

**New to the project?** Read these in order:

1. **[PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md)** (10 min)
   - What are we building?
   - How does it work?
   - Why is it different?

2. **[ROADMAP.md](./ROADMAP.md)** (10 min)
   - What's the plan?
   - What have we decided?
   - What's next?

3. **[DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md)** (as needed)
   - How do I run the code?
   - How do I build something?
   - Where do files go?

---

## 📁 File Guide

| File | Purpose | Read When |
|------|---------|-----------|
| **PROJECT_OVERVIEW.md** | Product vision, architecture, MVP scope | Starting a new task |
| **ROADMAP.md** | Phased plan, decisions, success metrics | Planning the next sprint |
| **DEVELOPMENT_GUIDE.md** | Technical how-tos, code patterns, debugging | Implementing a feature |
| **README.md** | This file — your navigation guide | You're here! |

---

## 🚀 Quick Facts

**What**: AI CFO agent for startup founders

**Why**: Founders need financial answers backed by their actual data + smart forecasting, not just chat

**How**: 
- Structured financial model (stored in database)
- Deterministic forecasting (code-based, not LLM-based)
- Smart LLM agent that calls forecasting functions
- Learn from outcomes over time

**Status**: Foundation ready, MVP development starting

**Stack**: Next.js, Supabase, Claude (Anthropic), Vercel

---

## 🎓 Key Concepts

### The Moat
The product is NOT:
- A chat interface (commoditized)
- A Plaid integration (widely available)
- Claude (everyone has access)

The product IS:
- A persistent financial model that improves over time
- Historical assumptions + actual outcomes
- Company-specific forecasting behavior
- Founder goals + risk preferences
- Decision history

### MVP = Answer 3 Questions Well
1. **What is my runway?**
2. **Can I afford this hire/expense?**
3. **What happens in different scenarios?**

Not features like: cap table, CRM sync, advanced analytics. Those come later.

### Forecasting Happens in Code
```
❌ LLM: "Based on your burn rate, runway is approximately..."
✅ Code: runway = (cash - minimum) / monthly_burn
✅ LLM: "I calculated runway as 12.3 months. Here's my recommendation..."
```

### Structured Model > Chat Memory
```
❌ Generic: "The user mentioned they want 12-month runway sometime in the conversation"
✅ Structured: 
   {
     company_id: "acme-inc",
     minimum_runway: 12,
     source: "onboarding",
     updated: "2026-09-12",
     confidence: "high"
   }
```

---

## 📋 For Different Roles

### If you're building data connectors
→ Read [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md) section "1. Data Connectors"
→ Then [DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md) "Database"

### If you're building the financial model
→ Read [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md) section "3. Persistent Company Financial Model"
→ Then [ROADMAP.md](./ROADMAP.md) "Phase 1.2"

### If you're building the forecasting engine
→ Read [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md) section "4. Deterministic Forecasting Engine"
→ Then [ROADMAP.md](./ROADMAP.md) "Phase 1.3"
→ Then [DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md) "Key Concepts"

### If you're building the agent
→ Read [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md) section "5. AI Financial Agent"
→ Then [ROADMAP.md](./ROADMAP.md) "Phase 1.4"

### If you're building the UI
→ Read [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md) "MVP" section
→ Then [DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md) "Code Organization"

---

## 🔗 External References

- **Project Start Document**: `ai_cfo_engineering_overview.md` (provided at project initialization)
- **Main Project Instructions**: [CLAUDE.md](../../CLAUDE.md)
- **Next.js Docs**: https://nextjs.org/docs
- **Supabase Docs**: https://supabase.com/docs
- **Anthropic SDK**: https://github.com/anthropics/anthropic-sdk-python
- **AI SDK (js)**: https://github.com/vercel/ai

---

## 🤔 Common Questions

**Q: Where do I start if I want to build X?**
A: Find your task type in "For Different Roles" above, then follow the reading order.

**Q: What's the most important thing to remember?**
A: The moat is the accumulated financial intelligence, not the technology. Build features that improve decision-making.

**Q: When should I ask for clarification?**
A: If something in the docs conflicts with what you see in the code, or if you're unsure about a decision, add it to [ROADMAP.md](./ROADMAP.md) under "Open Questions."

**Q: How do I update this documentation?**
A: Edit the relevant `.md` file. Keep it current—it's how future agents understand the project.

---

## 📞 Support

If you need context or clarification:

1. **Check the docs first** — most answers are here
2. **Search ROADMAP.md** — decisions and rationale are there
3. **Review git history** — commits often explain why
4. **Ask the team** — open questions in ROADMAP.md or CLAUDE.md

---

## ✨ Last Updated

September 12, 2026 — Project foundation complete, MVP development starting.

---

## 🎯 Your Next Step

Pick your task. Read the relevant section in [ROADMAP.md](./ROADMAP.md) or [DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md). Build something great.

Questions? They probably belong in [ROADMAP.md](./ROADMAP.md) under "Open Questions."
