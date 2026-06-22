# philipkwong-agents

Lead acquisition system for Philip Kwong (regulatory compliance + corporate strategy consultant).

## Components

- **Supabase** (`supabase/schema.sql`) — shared memory: `leads`, `outreach`, `agents` tables + RLS.
- **Upwork scraper** (`agents/upwork-scraper/`) — fetches Upwork RSS, scores each posting with Claude Haiku, writes leads scoring ≥ 60 to Supabase.
- **Dashboard** (`dashboard/`) — Next.js 14 App Router. Supabase auth login, pipeline table, agent status panel.

## Layout

This is a two-package repo:

- **Root** — the agent runtime (Node + tsx). `tsconfig.json` covers `agents/` and `lib/`.
- **`dashboard/`** — a self-contained Next.js project with its own `package.json` and `tsconfig.json`. (Next App Router must be rooted where `app/` lives, so the dashboard can't share the root package.)

## Environment

Secrets live in `.env.local` (gitignored). Copy `.env.example` → `.env.local`.

- Agents read: `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- Dashboard reads: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  (locally via `dashboard/.env.local`; on Vercel via project env vars).

> The service role key bypasses RLS — server-side only, never shipped to the browser.

## Commands

```bash
# Agents (root)
npm install
npm run typecheck          # tsc --noEmit
npm run scrape:upwork      # runs the scraper once (needs .env.local, Node >= 20.6)

# Dashboard
cd dashboard
npm install
npm run typecheck
npm run dev                # http://localhost:3000
```

## Rules

- One commit per component. Never combine schema / scraper / dashboard.
- No secrets in git. `tsc --noEmit` clean before every commit.
- Targeted edits only — never modify working code to fix something unrelated.
- Scrape-and-display only. No outreach is sent from this repo yet.

## Deviations from spec v1.0 (intentional fixes)

- Split into two `package.json` files (Next requires its own project root).
- Standardized agent env var on `SUPABASE_URL` (spec mixed it with `NEXT_PUBLIC_SUPABASE_URL`).
- Fixed the `outreach` RLS policy (spec had an extra `)`), made the schema idempotent.
- Added `tsx` to run TypeScript agents directly; centralized the admin client in `lib/supabase-admin.ts`.
