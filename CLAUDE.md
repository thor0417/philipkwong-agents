# philipkwong-agents

Lead acquisition system for Philip Kwong (regulatory compliance + corporate strategy consultant).

## Components

- **Supabase** (`supabase/schema.sql`) — shared memory: `leads`, `outreach`, `agents` tables + RLS.
- **Lead scraper** (`agents/lead-scraper/`) — pulls from two live sources, scores each with Claude Haiku, writes leads scoring ≥ 60 to Supabase:
  - `canadabuys.ts` — federal tender/RFP notices (open-data CSV, keyless). Direct consulting leads.
  - `adzuna.ts` — Canadian employer postings (free API key). Secondary signal; skipped if keys unset.
  - (Upwork RSS was the original source but those feeds are dead — see Deviations.)
- **Dashboard** (`dashboard/`) — Next.js 14 App Router. Supabase auth login, pipeline table, agent status panel.

## Layout

This is a two-package repo:

- **Root** — the agent runtime (Node + tsx). `tsconfig.json` covers `agents/` and `lib/`.
- **`dashboard/`** — a self-contained Next.js project with its own `package.json` and `tsconfig.json`. (Next App Router must be rooted where `app/` lives, so the dashboard can't share the root package.)

## Environment

Secrets live in `.env.local` (gitignored). Copy `.env.example` → `.env.local`.

- Agents read: `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and (optional) `ADZUNA_APP_ID` + `ADZUNA_APP_KEY`.
- Dashboard reads: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  (locally via `dashboard/.env.local`; on Vercel via project env vars).

> The service role key bypasses RLS — server-side only, never shipped to the browser.

## Commands

```bash
# Agents (root)
npm install
npm run typecheck          # tsc --noEmit
npm run scrape:leads       # runs the scraper once (needs .env.local, Node >= 20.6)

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
- Replaced the dead Upwork RSS source with CanadaBuys tenders + Adzuna postings (verified live June 2026); renamed the agent `upwork-scraper` → `lead-scraper`.

## Lead-source landscape (verified June 2026)

- **Dead:** Upwork RSS, Indeed Job-Search API, GitHub Jobs, Workopolis — do not revive.
- **CanadaBuys** (federal tenders, keyless CSV): works, but **low yield for Philip's niche** — federal procurement skews construction/defence/IT; compliance/QMS/cannabis/strategy barely appear. Cannabis is provincial, so it never appears federally.
- **Adzuna** (free key): employer postings, location-filtered to BC by default. Softer signal than tenders.
- **BC Bid:** no open-data feed for open opportunities (gated portal; catalogue has historical awards only).
- **MERX** (`merx-scraper`, still seeded but unbuilt): **deferred** — public BC listings exist but the site is a JS/.NET app with no clean rows/JSON/RSS; reliable scraping needs a headless browser (Playwright). Revisit only if BC tenders prove important; a paid aggregator API (e.g. ProcureData) is the lower-maintenance alternative.
