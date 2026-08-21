# numbers.md

Every figure this project quotes, with the exact predicate that produces it, the
date it was measured and the table it was measured against.

## Why this file exists

Three different numbers were in circulation describing "the corpus" and none had
a written predicate. That is the same failure `agents/scraper/corpus-snapshot.ts`
was written to stop at the corpus level, and its header says why: three "live"
counts disagreed in one week and every disagreement was an unwritten filter. The
snapshot fixed it for the corpus. This file extends the same rule to every other
number that reaches a person, including the ones a client document prints.

A figure without a predicate does not go in this file.

## How these were measured

Corpus figures are read off a labelled snapshot on disk, not from a one-off
query:

```
npm run corpus:snapshot -- --label <label>   writes snapshots/corpus-<stamp>-<label>.json
```

Document figures are read off a generated document on disk and reconciled
against the tables the generator queried.

### The pair behind this file

| | Snapshot | projects.all | projects.live | dormant | country equality |
|---|---|---:|---:|---:|---:|
| before | `snapshots/corpus-2026-08-19T08-11-52-post-run-complete.json` | 243 | 155 | 80 | 230 |
| after | `snapshots/corpus-2026-08-21T05-46-28-pass1-numbers-md.json` | 243 | 155 | 80 | 230 |

Identical on every axis. The pass that produced this file was read only, and the
pair on disk is what says so rather than the claim.

---

## 1. The corpus

Measured 2026-08-21 against `projects`, from
`snapshots/corpus-2026-08-21T05-46-28-pass1-numbers-md.json`.

The four populations are a strict ladder. Each row adds one clause to the row
above it.

### 243, every project row

```sql
select count(*) from projects;
```

Snapshot key `projects.all`, predicate `projects, no filter`.

### 243, in the live pipeline

```sql
select count(*) from projects where module = 'gli';
```

Snapshot key `populations[inPipeline]`. THIS CLAUSE REMOVED NOTHING on
2026-08-21 and the snapshot flags it as never fired. Every row in the table is
`gli`. A clause that fires on nothing looks exactly like a clause that fires
correctly, so it is recorded here rather than trusted.

### 235, the register

```sql
select count(*) from projects
 where module = 'gli' and status <> 'dismissed';
```

Snapshot key `populations[register]`. Counts dormant projects, because the
register is what is on the books rather than what is moving.

Adding `inCorpusScope(country)` leaves this at 235 and is also flagged as never
fired: the eight dismissed rows are the out-of-country tombstones, so the scope
clause has nothing left to remove by the time it runs.

### 155, live projects

```sql
select count(*) from projects
 where module = 'gli'
   and status <> 'dismissed'
   and inCorpusScope(country)          -- lib/corpus-scope.ts, US only today
   and stage <> 'dormant';
```

Snapshot key `projects.live`. **This is the definition of live**, and it does
return exactly 155. The figure in circulation as "~155 after corpus cleaning" is
this predicate and needs no approximation.

`inCorpusScope` rather than `country = 'United States'` is load bearing even
though it removes nothing today: an unresolved country is not a foreign one, and
equality throws away every project whose country did not resolve. See the next
figure.

### 230, an explicit pick of one country

```sql
select count(*) from projects
 where module = 'gli'
   and status <> 'dismissed'
   and country = 'United States';
```

Snapshot key `projects.reconciliation.asQuoted.unitedStates214`, which labels
this predicate WRONG **as a statement about coverage**, in the snapshot's own
words: equality drops every project whose country did not resolve.

It is still the right predicate for one thing, and only that thing: a person
asking the register for a named country. `/projects?country=United+States`
returns 230 and should, because that is the question asked.

**IT WAS ALSO THE REGISTER'S DEFAULT UNTIL 2026-08-21, AND THAT WAS THE DEFECT.**
`DEFAULT_COUNTRY = 'United States'` was applied whenever the `country` parameter
was absent, so the screen a project is confirmed on opened on 230 and hid five
projects whose country did not resolve. None of them is foreign: UMusic Hotel
Austin, Sacramento lodging growth, 1020 West Imperial Highway and two more, all
captured by the press lane with no country parsed. An invisible project cannot
be confirmed, and an unconfirmed project can never reach a client document.

The default is now corpus scope. Measured through the pager before and after:

| the register's default view | count |
|---|---:|
| before, `country = 'United States'` | 230 |
| after, `country IS NULL OR country IN (corpus)` | **235** |
| explicit pick, unchanged | 230 |
| cleared, `?country=any` | 235 |

Guarded by `dashboard/e2e/corpus-scope.audit.ts`, which asserts the gap against
the database rather than against an inequality, and by golden case
`an-unresolved-country-is-not-a-foreign-one-on-the-screen-either`.

The corpus did not move: `corpus-2026-08-21T06-35-44-pre-default-country.json`
and `corpus-2026-08-21T06-43-23-post-default-country.json` are identical at 243
all, 155 live, 80 dormant. This changed what the screen shows, not what is held.

### 184, the filter audit baseline

**Not reproducible, and no predicate should be invented to reach it.**

Source: `dashboard/WALKTHROUGH.md` section 9, last committed 2026-08-16 in
`fbcacd3`. The audit reads its totals from the register's pager.

The predicate that produced it, read off the audit's own table, is:

```sql
select count(*) from projects
 where module = 'gli' and status <> 'dismissed';
-- with the country control CLEARED
```

The audit's own next row is `Geography: United States | 184 -> 162`, which is
what establishes that the country filter was off at the baseline. So 184 is the
`register` population above, which on 2026-08-21 returns **235**.

Since the corpus-scope fix the register's DEFAULT view also returns 235, so the
audit's baseline and the screen as it opens are now the same predicate. They
were not when the audit was written, which is why it had to clear the country
control to get a baseline worth comparing against.

No snapshot on disk has ever held 184; the counts recorded across the eight
snapshots in `snapshots/` are 226, 228 and 243 for `all` and 138, 140, 146 and
155 for `live`. The corpus grew between the audit and today. The register
predicate crossed 184 on 2026-08-10 by `created_at`.

The audit is stale rather than wrong. Two of its rows have since changed:

| Audit row | Then, 2026-08-16 | Now, 2026-08-21 |
|---|---:|---:|
| `status = 'dismissed'` | 0 | 8 |
| `watch = true and status <> 'dismissed'` | 0 | 4 |
| `status = 'new'` | 184 of 184 | 235 of 235 |

`status = 'new'` still returns every undismissed row. No project has ever been
triaged through `projects.status`, which is why that column is not the
confirmation gate. See section 3.

### The stage axis, and why three chips never summed

`stage` is ONE text column on `projects` carrying an eight value vocabulary
(`lib/taxonomy.ts`, `PROJECT_STAGES`). `stalled` and `dormant` are values IN
that column, not a separate axis: `STAGE_LADDER` is the six document derived
rungs, and `deriveProjectStage` applies stalled and dormant OVER the ladder
result rather than beside it.

So three stage chips can never account for a whole register. The audit's table
lists three and its prose lists all seven values it then held, summing to 184
exactly.

Measured 2026-08-21 over `module = 'gli' and status <> 'dismissed'`, 235 rows:

| stage | count |
|---|---:|
| filed | 91 |
| dormant | 80 |
| approved | 41 |
| stalled | 12 |
| hearing scheduled | 10 |
| under construction | 1 |
| permitted | 0 |
| operating | 0 |

---

## 2. The Clark County market report

Source document: `deliverables/2026-08-20/market-report-clark-county.md`,
generated 2026-08-20 for JKR & Associates, geography Clark County, period All
time, detail cap 15. Its own footer records `membership gate: enforced`.

Every figure below was re-measured against the live tables on 2026-08-21 and
every one reproduces exactly.

### The scope ladder

Market is NOT filtered on `projects.market`. It is a record facet: a project is
in scope if it holds at least one live record naming the market
(`projectsMatchingRecordFacets`, `dashboard/lib/clients.ts`). Filtering the
project column would ask whether the project's most common market matches rather
than whether the project has any record that matches.

```sql
-- step 1: the record facet, 36 projects
select distinct project_id from leads
 where market ilike 'Clark County' and status <> 'dismissed';
```

| step | clause added | count | source |
|---|---|---:|---|
| record facet | `leads.market ilike 'Clark County' and leads.status <> 'dismissed'` | 36 | `leads` |
| scope query | `and projects.module = 'gli' and projects.status <> 'dismissed'` | 36 | `projects` |
| dormancy | `and projects.stage <> 'dormant'` | 36 | `projects` |
| membership gate | `and project_id in (included for JKR)` | 25 | `client_projects` |
| provisional name | `and not isProvisionalName(name_source)` | 23 | `projects` |

The order matters and is the order `buildReport` applies. The gate runs after
every scope axis so that the held out count means "the scope proposed it and
nobody confirmed it" rather than "it was never in scope".

### 23 projects, the report basis

The bottom of the ladder above. Printed on the cover as `Basis 23 projects` and
in the footer as `projects in scope: 23`.

### 11 projects held out as unconfirmed

```sql
select count(*) from projects p
 where p.id in (<the 36 from the record facet>)
   and p.module = 'gli' and p.status <> 'dismissed' and p.stage <> 'dormant'
   and p.id not in (
     select project_id from client_projects
      where client_id = 'd3ede386-9a33-4a8c-918c-a7e80dde6827'   -- JKR & Associates
        and status = 'included'
   );
```

Source table `client_projects`, migration 033, which is applied. Confirmation is
a row in that table, never a column on `projects`.

### 2 projects with no published name

```sql
-- among the 25 the gate kept
select count(*) from projects
 where id in (<the 25>)
   and (name_source = 'title' or name_source is null);
```

`isProvisionalName` in `lib/taxonomy.ts` is exactly that test. Applied AFTER the
membership gate, which is why the document reports 2 rather than the 4 the whole
36 hold.

### 15 described in full, 8 counted but not described

`15` is the composer's detail cap, `DETAIL_CAP_DEFAULT` in
`dashboard/lib/report-build.ts`, passed through as `req.detailCap`. Not a
predicate over any table.

`8` is `23 - 15`, the remainder of the ranked list.

Selection is by significance, ranked over the projects that are placed and hold
a record in the period:

```js
// dashboard/lib/report-build.ts
const ranked = [...eligible].sort(
  (a, b) =>
    (b.significance ?? -1) - (a.significance ?? -1) ||
    (b.record_count ?? 0) - (a.record_count ?? 0) ||
    a.name.localeCompare(b.name)
);
const detailedProjects = ranked.slice(0, detailCap);
```

`projects.significance` is numeric, 0 to 100, written by
`agents/scraper/significance` and declared retrospectively in migration 041. It
is also the register's default sort. The two tiebreaks are `record_count`
descending and then name, so the order is total and a regeneration cannot
reshuffle equal scores.

### 89 records on the cover

```sql
select count(*) from leads
 where project_id in (<the 23>)
   and status <> 'dismissed';
```

Returns 89. `select sum(record_count) from projects where id in (<the 23>)` also
returns 89, so the stored counter and the table agree.

The period contributes no bound here because the report period is All time. On a
bounded period the same query gains `and first_seen >= <since> and first_seen <
<until>`.

### 18 duplicate captures, and 14 further filings

**Neither is a SQL predicate, and neither can be written as one.** Both are
computed in TypeScript at generation time, over the records already fetched.

`18` is `mergedRecords`, accumulated from `dedupe()` in
`dashboard/lib/report-entry.ts`. Two records merge on a content similarity test:
identical normalised text, or a shared content word overlap at or above the
threshold measured against the SMALLER word set, so a page fragment folds into
the full item it repeats. Bilingual pairs keep the English record; otherwise the
longer one wins. There is no column on `leads` that marks a duplicate.

`14` is `heldRecords`, accumulated from `buildEntry`'s
`held = ordered.length - shown.length`, where an entry prints at most
`ENTRY_RECORD_CAP = 8` filings and keeps the NEWEST. A referral brief overrides
the cap to `RECORD_CAP` so that a single matter brief shows every filing it has.

Both are recorded here anyway, because a figure that reaches a client document
needs a written derivation whether or not that derivation is a query.

---

## 3. Confirmation is a table, not a column

`projects` carries no confirmation column. The three columns that look like they
might are `status`, `watch` and `stage`, and none of them is:

| column | type | what it actually is | 2026-08-21 |
|---|---|---|---|
| `status` | text, default `'new'` | triage and the dismissal tombstone | 235 `new`, 8 `dismissed` |
| `watch` | boolean, default `false` | the register's watchlist view and the report's watch list section | 4 true |
| `stage` | text, default `'filed'` | the eight value stage vocabulary | see section 1 |

Confirmation lives in `client_projects`, migration 033, one row per client and
project, `status in ('proposed', 'included', 'excluded')`. Only `included` may be
printed. Measured 2026-08-21:

| client | proposed | included | excluded |
|---|---:|---:|---:|
| JKR & Associates | 126 | 117 | 0 |
| Simtec Attractions | 31 | 5 | 10 |

The watch list a market report prints reads `projects.watch` directly, and on
2026-08-21 that column holds four rows: OCVibe (Anaheim), Top Gun Las Vegas (Las
Vegas), Heart Hotel / Kulik River (Clark County) and Nevada Palace (Clark
County). The two Clark County rows are exactly the two the Clark County report
prints. There is no second watch column.
