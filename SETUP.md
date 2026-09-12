# LockInVowe Hackathon Setup Guide

Welcome to the team! This repo is ready for you to start building the CFO/Ops AI agent. Here's everything you need to know.

## ✅ What's Already Set Up

- **Next.js 15** with TypeScript (strict mode ready)
- **Tailwind CSS** for styling
- **Supabase** client helpers (for database + auth)
- **Vercel AI SDK** configured with Anthropic (provider-agnostic, easy to swap)
- **Example chat API endpoint** at `/api/chat` (ready to extend with tools)
- **Git workflow** configured for team collaboration

## 🚀 Getting Started (First Time)

### 1. Clone & Install
```bash
git clone <repo-url>
cd LockInVowe
npm install
```

### 2. Set Environment Variables
```bash
cp .env.example .env.local
```

Then fill in `.env.local` with:
- **Supabase**: Get from supabase.com dashboard
- **LLM API Key**: Anthropic, OpenAI, or your provider of choice

### 3. Run Locally
```bash
npm run dev
```

Visit `http://localhost:3000` — you should see the default Next.js page.

## 📁 Where to Work

### Frontend/UI
- `app/page.tsx` — homepage
- `components/` — reusable components
- `app/layout.tsx` — root layout (metadata, styles)

### AI Agent Logic
- `lib/ai/provider.ts` — single place to configure which LLM you use
- `app/api/chat/route.ts` — streaming chat endpoint (add tools/actions here)

### Database/Backend
- `supabase/schema.sql` — database schema (track migrations here!)
- `lib/supabase/client.ts` — browser client for auth/queries
- `lib/supabase/server.ts` — server client for API routes

## 🔧 Workflow

1. **Create a branch** for your feature: `git checkout -b feature/your-name`
2. **Make changes** in your designated area
3. **Push to GitHub**: `git push origin feature/your-name`
4. **Open a PR** to `main` — don't push directly to main
5. **Review together** before merging

## 🧪 Testing the Agent Locally

The `/api/chat` endpoint accepts POST requests. Try it:

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello, who are you?"}]}'
```

You should see a streamed response from Claude. If you get an error, check that:
- `.env.local` has your `ANTHROPIC_API_KEY` (or your LLM key)
- `npm run dev` is still running

## 📝 Common Tasks

### Adding a Database Table
1. Write the SQL in `supabase/schema.sql`
2. Run it on your Supabase project dashboard (or use CLI)
3. Commit the schema file

### Adding a New API Route
1. Create `app/api/your-endpoint/route.ts`
2. Export `GET`, `POST`, etc. as needed
3. Test with curl or your frontend

### Changing the LLM Provider
Open `lib/ai/provider.ts` and swap the import:
```typescript
// From:
import { anthropic } from "@ai-sdk/anthropic";
export const model = anthropic("claude-3-5-sonnet-20241022");

// To:
import { openai } from "@ai-sdk/openai";
export const model = openai("gpt-4");
```

All routes using the model will automatically use the new provider.

## 🚢 Deploying to Vercel

Once you're ready:
1. Push to `main` on GitHub
2. Vercel auto-deploys
3. Add the same env vars in Vercel project settings → Environment Variables

## ❓ Questions?

Check the main `README.md` or ask the team. This project is built to move fast — don't get stuck optimizing.

---

**Good luck with the hackathon! 🚀**
