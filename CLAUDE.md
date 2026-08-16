# philipkwong-agents

A primary-source development intelligence platform for the US hospitality and
entertainment vertical. It reads government records across covered markets,
clusters filings into named projects, extracts the parties from the applications
themselves, and generates branded client documents.

Clients never see the dashboard. They receive generated documents. The dashboard
is the asset; the reports are the product.

## The finish line

A report Philip would send to a paying client without editing, and someone paying
for it. Not a completed pass list.

## Commands

```
npm run verify                    root gate: typecheck plus every scraper suite
npm run verify:staleness          is any configured jurisdiction reading a dead feed
npm run gate:measure              precision and recall over the labelled corpus
cd dashboard && npm run verify    build plus the full Playwright suite
cd dashboard && npm run audit:exclusions   does every document state what it withheld
```

`audit:exclusions` is a DASHBOARD script, not a root one. Run from root it fails
with "Missing script", which reads like the audit passing.

## Layout

Two packages, and the split is not cosmetic. `npm run typecheck` at the root does
not see the dashboard, and `npm run verify` in the dashboard does not see the
agents. Both gates are needed and neither substitutes for the other.

- **Root** — the agent runtime (Node + tsx). Its `tsconfig.json` covers `agents/`
  and `lib/` only.
- **`dashboard/`** — a self-contained Next.js project with its own
  `package.json` and `tsconfig.json`. Next's App Router must be rooted where
  `app/` lives, so it cannot share the root package.

`lib/dead-feeds.ts` is read across the split by both packages deliberately: a
mirrored copy is a copy that goes stale, and the stale half decides what a client
is told.

## Environment

Secrets live in `.env.local` (gitignored). Copy `.env.example` -> `.env.local`.

- Agents read `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- Dashboard reads `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  (locally via `dashboard/.env.local`, on Vercel via project env vars).

The service role key bypasses RLS. Server-side only, never shipped to the browser.

## Standing rules

1. NEVER FABRICATE a name, firm, role, figure or contact detail. Not from
   inference, not from a plausible pattern, not from a model's reading. Where a
   record says nothing, the honest negative is the answer.
2. MEASURE BEFORE CHANGING, AND MEASURE PER MARKET. A corpus average hides a
   market-specific harm: a mixed-use gate change helped New York and strictly
   harmed Anaheim.
3. NOTHING IS SILENTLY ABSENT. If a document withholds a project or a record, the
   document states the count and the reason.
4. PROVENANCE IS SEPARABLE IN CODE. [RECORD] from a captured filing with its
   link, [PRESS] reported elsewhere, [ASSESSMENT] Philip's own read. A generator
   that can emit an assessment unlabelled is a defect.
5. MIGRATIONS ARE PRINTED FOR PHILIP TO RUN, BLOCKING. Never run DDL from code.
6. NOTHING IS HARD DELETED. Dismissal is a status with a tombstone.
7. A DEFECT PRODUCES A PERMANENT RULE AND A GOLDEN CASE, not a one-time cleanup.
   A case is added by appending one entry to `agents/scraper/fixtures/golden.jsonl`
   naming the shape it guards, the input, the assertion and the date, and pointing
   `id` at the suite that proves it.
8. WHEN A DEFECT IS FOUND, FIND EVERY OTHER INSTANCE OF ITS SHAPE before fixing
   the one. Six defects this month were the same shape found separately: a label
   read as the thing it names.
9. DONE MEANS A GENERATED DOCUMENT READ BACK, or a live query pasted. A commit is
   never done.
10. REPORT ANYTHING FOUND THAT THE BRIEF DID NOT ASK ABOUT.
11. NO OUTREACH IS SENT AUTOMATICALLY FROM THIS REPO. The scrapers are
    scrape-and-display; the intake agent drafts replies, and every draft queues as
    `pending` in Supabase `outreach` for manual review. Nothing sends.

## Commit discipline

One commit per component. `tsc --noEmit` clean and `npm run build` passing before
every commit, GATED SEPARATELY rather than in a compound command. Use pipefail on
any piped command: a verify piped to `tail` has produced a false green twice here.
Push and confirm each ref. No em dashes anywhere, including in generated text. No
hardcoded keys. Targeted edits only; never rewrite working code to fix something
unrelated to it.

## Dead ends, so they are not rebuilt

- **Lead sources:** Upwork RSS, Indeed Job-Search API, GitHub Jobs and Workopolis
  are dead. Do not revive them. CanadaBuys and Adzuna work and are low yield for
  this vertical; they feed the retired `agents/lead-scraper` lane.
- **BC Bid** publishes no open-data feed for open opportunities. **MERX** needs a
  headless browser; a paid aggregator is the cheaper answer if BC tenders ever
  matter.
- **Google Custom Search** is dead for new projects. Serper is the search source.

## Compact instructions

When summarising this conversation, preserve: every measurement and its numbers,
every rule proposed and whether Philip approved it, every migration printed and
whether it has been run, and anything found that the brief did not ask about.
Summarise exploration briefly.
