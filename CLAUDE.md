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

```
npm run hooks:install       ONCE PER CLONE. core.hooksPath is local config and
                            is not versioned, so a fresh clone has no gate until
                            this is run.
npm run verify:fast         what the pre-commit hook runs. 9s, no DB or network.
npm run verify:golden       the golden set on its own.
```

The gate is enforced by `.githooks/`: pre-commit runs the fast checks and refuses
the commit on a non-zero exit, pre-push runs the full suite. See standing rule 7
for how a case is added.

## Layout

Two packages, and the split is not cosmetic. `npm run typecheck` at the root does
not see the dashboard, and `npm run verify` in the dashboard does not see the
agents. Both gates are needed and neither substitutes for the other.

- **Root**: the agent runtime (Node + tsx). Its `tsconfig.json` covers `agents/`
  and `lib/` only.
- **`dashboard/`**: a self-contained Next.js project with its own
  `package.json` and `tsconfig.json`. Next's App Router must be rooted where
  `app/` lives, so it cannot share the root package.

`lib/dead-feeds.ts` is read across the split by both packages deliberately: a
mirrored copy is a copy that goes stale, and the stale half decides what a client
is told.

## Where things are

So a session does not open with fifteen greps. Measured on this one: nine shell
commands and eleven file reads before the first edit, and every one of the nine
was answering a question this section answers.

**The agent runtime** (`agents/scraper/`)
- `orchestrator.ts` runs the lanes. `government.ts`, `gli.ts`, `opportunity.ts`.
- `cluster.ts` turns records into projects. `bestDate` is here and is why a
  dateless record is never a project's latest activity.
- `targets.ts` is the named-project list, with `districtWide` for terms that
  name a place rather than a project.
- `project-naming.ts` derives a name. `verify-naming.ts` is its test.
- `fixtures/golden.jsonl` + `verify-golden.ts` are the golden set.

**Shared taxonomy** (`lib/taxonomy.ts`, 1400 lines, the single densest file)
- `governmentGate` admits or refuses a record. `GOV_GATE_OUT_OF_VERTICAL` is the
  junk list, `BORROWED_CONTEXT` neutralises boilerplate that is not a subject.
- `classifyVenueType` and `venueReadableText` read the same neutralised text.
- `provenStage` is the stage ladder, `HIGHEST_UNPROVEN_STAGE` its bar.
- `isProvisionalName` decides whether a project may be printed to a client.
- `lib/dead-feeds.ts` is read across the package split by both packages.

**The dashboard** (`dashboard/`)
- `app/(app)/projects/` is the register, and is the working surface: `page.tsx`,
  `ProjectsRail.tsx`, `ProjectsDetail.tsx`, `page.module.css`.
- `components/shell/` is the chrome every screen shares. `navigation.ts` is the
  one nav list the rail and the palette both read.
- `app/tokens.css` is the design system. Every value the interface may use is
  there and nothing else is allowed. `/design` renders it.
- `lib/report-build.ts` builds every document; `lib/use-client-view.ts` is the
  client view and the membership gate's proposal path.

**The harnesses** (`dashboard/e2e/`)
- `filters.audit.ts` is the largest and covers the filter axes end to end.
- `rail.shots.ts` MEASURES as well as photographs: rail height, controls above
  the first row, rows per viewport.
- `screens.shots.ts` enforces the accent budget per screen. Exceeding it fails.
- `report.shots.ts` generates real documents into `e2e/shots/documents/`.
- `scripts/exclusion-audit.ts` checks that every withheld thing is stated.

**Running it**
- The dashboard needs a server on :3000. Use `npm run build && npm run start`,
  not `npm run dev`: this repo lives inside OneDrive, which locks `.next/types`
  and makes long dev runs fail with EBUSY in ways that read as product defects.
- Playwright reuses an existing server, so start one first and leave it up.

**Send to a subagent, not to the main context**
Any question of the form "where is X handled", "is this asserted anywhere",
"find every place this shape appears". The answer is a list; the forty file
excerpts that produced it are not needed again and should not be in the
conversation. Use the `sweep` skill for defect shapes.

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
   `id` at the suite that proves it. A defect found but NOT yet fixed is added as
   `guard: "pending"` with a `closedBy` naming the work that closes it: it runs,
   it reports what the system does today, and it does not fail the gate, because
   there is nothing to regress from. A case that has ever passed may never be
   moved back to pending, which is the line between an open case and a known
   issue.
8. WHEN A DEFECT IS FOUND, FIND EVERY OTHER INSTANCE OF ITS SHAPE before fixing
   the one. Six defects this month were the same shape found separately: a label
   read as the thing it names.
9. DONE MEANS A GENERATED DOCUMENT READ BACK, or a live query pasted. A commit is
   never done.
10. REPORT ANYTHING FOUND THAT THE BRIEF DID NOT ASK ABOUT.
11. A THING IS DONE WHEN IT EXISTS ON DISK AND HAS BEEN READ BACK, NOT WHEN IT
    HAS BEEN DESCRIBED. Before reporting anything as done, name the path and open
    it. Three in one session, each of which passed its own checks:
    - a comment saying "the conditions get their own block" with no block
      anywhere, so 36 conditions reached no page;
    - `referral-brief.pdf`, generated and read back for weeks, built from the
      market-report section set and containing no referral section at all;
    - "migration 036 is printed and blocking" when 036 was a `console.log` and
      `migrations/` stopped at 035.
    The shape is the same each time: a description of the work stands in for the
    work, and every check passes because the checks test what exists. A generator
    that PRINTS an artefact must read it off disk, so a missing file fails the
    run instead of manufacturing the appearance of one.
12. NO OUTREACH IS SENT AUTOMATICALLY FROM THIS REPO. The scrapers are
    scrape-and-display; the intake agent drafts replies, and every draft queues as
    `pending` in Supabase `outreach` for manual review. Nothing sends.

## Commit discipline

One commit per component. `tsc --noEmit` clean and `npm run build` passing before
every commit, GATED SEPARATELY rather than in a compound command. Use pipefail on
any piped command: a verify piped to `tail` has produced a false green twice here.
Push and confirm each ref. No em dashes anywhere, including in generated text. No
hardcoded keys. Targeted edits only; never rewrite working code to fix something
unrelated to it.

## Coverage

**This system is United States only, and that is a system setting rather than a
client one.** `lib/corpus-scope.ts` is the single declaration; the intelligence
lane refuses a record whose project resolves outside it. Reopening a country is
one line there. An unresolved country is NOT a foreign one and is admitted, so
"Fort Wayne" is not thrown away to enforce a rule about Riyadh.

Records already captured from outside it are TOMBSTONED, never deleted: they
carry `status = 'dismissed'` and `score_reason = 'outside the countries this
system covers'`, so what we held before a market opens can be read back rather
than re-scraped.

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
