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

`snapshots/` is gitignored, so the files named in this document are working
evidence on one machine rather than something a fresh clone can open: the
figures and predicates written here are the durable record, and
`npm run corpus:snapshot -- --label <label>` regenerates an equivalent artefact
at any time.

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

## 6. What we hold, judged. Brief Q item 1, measured 2026-08-23

`snapshots/holdings-judgement-live.md`, produced by
`agents/scraper/diagnostics/holdings-judgement.ts`. Labels cached in
`agents/scraper/fixtures/holdings-labels.jsonl`, which IS versioned, so unlike
the snapshots above these figures can be reproduced from a fresh clone.

### The three population counts, and section 1 of this file is now stale

| count | predicate |
|---:|---|
| 424 | every row in `projects` |
| 416 | `module='gli' and status <> 'dismissed'` and `inCorpusScope(country)` |
| 340 | the above and `stage not in ('dormant','archived')` |

**The predicate recorded above under "235, the register" now returns 416.** The
figure did not change because a filter changed; the corpus grew from 243 rows to
424 between 2026-08-19 and 2026-08-23, principally Broward County. Section 1 of
this file is a true record of 2026-08-19 and is not a current number. This is the
failure this file exists to catch, caught by this file.

### 45 hospitality developments, AND IT IS A FLOOR

```
population: the 340 live projects above
judge:      claude-sonnet-5, rubric q1-v1, one call per project
buckets:    development-vertical | development-other | instrument | housekeeping
```

| bucket | count | share of 340 |
|---|---:|---:|
| a hospitality or entertainment DEVELOPMENT | 45 | 13.2% |
| a development, outside the vertical | 60 | 17.6% |
| an instrument rather than a project | 141 | 41.5% |
| municipal housekeeping | 94 | 27.6% |

**ANYONE QUOTING 45 SHOULD QUOTE THE CALIBRATION WITH IT.** All 108 projects of
the 2026-08-22 backfill cohort sit inside this population, so the two judgements
cover the same rows and can be compared directly:

| judgement | hospitality of 108 |
|---|---:|
| 2026-08-22, read by hand | 18 (16.7%) |
| this classifier | 12 (11.1%) |

The classifier is roughly a third stricter than a human read on the only cohort
where both exist. **45 is therefore a floor, not a count**, and the equivalent
hand figure would plausibly be in the sixties. The per-project labels from
2026-08-22 were never stored, so the six that differ cannot be named; the seam is
the one real ambiguity in the buckets, which is whether a use permit ON a hotel
is a scheme being decided or an instrument attached to an address.

### 15 referral-ready, and 116 that should not be there

```
referral-ready: bucket = development-vertical
                and name_source <> 'title'
                and the entry PRINTS at least one party
                and at least one stated fact
                and at least one condition of approval
```

15 projects, **every one of them Clark County**, because conditions are the
binding term and Clark County is the only jurisdiction with a conditions reader.

```
should not be there: bucket = housekeeping                                   94
                     or (bucket = instrument and no party, no fact, no condition)  22
                     union                                                  116
```

73 of the 94 housekeeping projects are Broward County, which is the open golden
case `a-planning-document-admitting-a-county-s-whole-agenda`.

## 7. New York identifiers and CPC reports. Brief Q items 2 and 3, 2026-08-23

### 123 was wrong, and it reached a brief

Brief O item 4.4 reported "123 live records carry a ULURP-shaped number in their
text". **That figure counted records matching a regex that included the literal
word `ULURP`**, so every record merely mentioning the process was counted as
carrying an identifier. It made an unopened opportunity look roughly nine times
larger than it is, and it was quoted back into Brief Q as the reason to run the
pass.

The correct figures, on the published-field separation
`agents/scraper/diagnostics/nyc-cpc-reach` already draws:

| count | predicate |
|---:|---|
| 97 | live New York projects |
| **14** | projects carrying a ULURP number |
| **28** | distinct numbers, all of them published by ZAP as a field |
| **0** | distinct numbers that exist only in prose |
| **13** | of the 28 that return a CPC report PDF |
| **7** | distinct projects those 13 reports belong to |

A number in a ZAP column is the source stating its own identifier. There is no
prose-only set to harvest: the regex and the field agree exactly, at 28.

### 0 projects would gain a party or a decision

```
agents/scraper/diagnostics/cpc-gain.ts
```

All 7 projects with a reachable report already hold the applicant, a
`City Planning Commission action` fact and a
`Commissioners recorded as an exception on the vote` fact. The CPC route was not
unopened; it had already been run and its output is already in the corpus.
Checked per project by fact LABEL, not by "has any facts".

### 2 genuine obligations across 13 documents, which is why no conditions reader was built

```
agents/scraper/diagnostics/resolution-clause-measure.ts
```

| shape | occurrences | distinct |
|---|---:|---:|
| `RESOLVED, that ...` | 30 | 25 |
| `... subject to ...` | **0** | **0** |
| `<party> shall ...` | 38 | 14 |

Counts are not the finding; what the clauses SAY is. Of the 14 distinct `shall`
clauses: 5 are City Map filing mechanics, 4 are the Zoning Resolution quoted back
(they carry NYC's own `#defined term#` markers), 1 is a community letter of
commitment, 2 are extraction garbage from a sentence-boundary rule that misread a
colon, and **2 are genuine project obligations on the applicant**. The 25 distinct
`RESOLVED` clauses are procedural recitals - what the Commission considered and
found - not conditions of approval.

Cost per document, measured on 13 real fetches: median 1.51MB, 40 pages, 45ms
fetch, 179ms parse, 2ms extract, no model call. **Cost is not the reason not to
build it. Yield is.**

## 8. CEQAnet reach. Brief Q item 5, 2026-08-23

```
agents/scraper/diagnostics/ceqanet-reach.ts [--fetch]
```

### The reach we have today is 3 projects, not 4

Brief O reported "it attaches to 4 of 28 live California projects". **4 was the
count of live ceqanet RECORDS, not projects.** Same shape as the 123 in section 7,
smaller. The projects are:

| project | market | SCH |
|---|---|---|
| OCVibe | Anaheim | 2023100503, 2004121045 |
| Disneyland Resort | Anaheim | 2021100402 |
| 1020 West Imperial Highway | (no market) | 2026071116 |

**The third has `region_state` null**, so a California equality alone reports the
reach one project short. CEQAnet is a California-only source, so a project holding
one of its records IS in California whether or not geography resolved.

30 of the 34 have no route to an SCH at all. One further project, OTR (an Ohio
Partnership), carries an SCH-shaped number only in prose; it is reported as a
candidate rather than as reach.

### What the fields hold, over the 4 reachable records

| field | populated |
|---|---:|
| Location Parcel Number | 3 of 4 |
| Location Total Acres | 3 of 4 |
| Location Cross Streets | 3 of 4 |
| NOD Approved By Lead Agency / Approved Date | 3 of 4 |
| Contact Full Name / Authority / Job Title | 4 of 4, all agency staff |
| NOC Development Type / NOC Local Action | **0 of 4** |

One of the three parcel values is the literal string `Multiple parcels`, which is
not a lookup key. **Usable parcel numbers: 2** - `234-161-04 and 231-161-26`
(OCVibe) and `019-171-24` (1020 West Imperial Highway). So following every
identifier we hold takes California from 0 projects with a parcel number to 2.

### The developer is not in the title, on our own records

Brief O asked whether the developer in the title prose is extractable without a
name rule. On the four titles we can actually reach - "Pacific Resort Plaza",
"DEV2021-00131 A-Town Development Area F", "DisneylandForward Draft Subsequent
Environmental Impact Report", "Conditional Use Permit 26-0003 (CUP26-0003)" -
**none names a developer at all.** The question does not arise. The Brief O
example that suggested it might ("Pyka Inc. Administrative Use Permit") was a
lucky draw, and extracting "Pyka Inc." from it would still require deciding that a
leading proper noun is a company, which is a name rule.

### The route that IS worth something: search by lead agency

```
https://ceqanet.lci.ca.gov/Search?LeadAgency=Anaheim%2C%20City%20of&OutputFormat=CSV
   -> 657 rows, 55 fields, 854KB, one request, no auth
```

**The value form is exact and a wrong one returns a 200 with a header row and no
data.** `LeadAgency=City of Anaheim` and `LeadAgency=Anaheim` both return 1,171
bytes of column names and nothing else; only `Anaheim, City of` returns rows. A
status check would have called all three a success.

Two further traps, both measured: the CSV is **cp1252, not utf-8**, and it carries
**embedded newlines inside quoted description fields**, so a line count reports
1,382 where the row count is 657.

Of the 657 Anaheim rows: 251 (38%) carry a parcel number, 371 (56%) an acreage,
428 (65%) cross streets, 154 (23%) an approval date, and 90 (14%) were received in
2024 or later.

**This is a source, not an identifier follow.** It does not need an SCH from our
own text; it needs a way to match 657 CEQA filings against 19 Anaheim projects,
which is a matching build and is not costed.

### The Anaheim match, costed 2026-08-23: it does not hold

```
agents/scraper/diagnostics/ceqanet-match-cost.ts
```

The agency route returns 657 Anaheim filings with 251 parcel numbers. Joining
them to our 19 Anaheim projects was costed on all three available keys and none
of them works.

| key | result |
|---|---|
| the city's own application number | **1 of 19** projects carries a DEV/CUP/VAR/RCL/TTM number in any record. Nothing to join to. |
| street name, project side vs CEQAnet cross streets | 6 of 19 get a candidate. **1 of 19** has a candidate set small enough to resolve (<=5 rows), and that one carries **0 parcel numbers**. |
| project or applicant name vs CEQAnet Project Title | 16 of 19 "match" and essentially every one is a false positive: GardenWalk Hotel II to "Brookhurst Street Improvements", Good Hope International to "Grandma's House of Hope", Platinum Triangle to "Metropolitan West Condominiums". |

**The cause is structural, not a weak matcher.** Anaheim's arterials are long:
Katella carries 39 filings, State College 35, Santa Ana Canyon 31. A project on
Katella Avenue matching 39 CEQA filings is a street, not a match. And **CEQAnet
publishes no street address field at all** - its location fields are cross
streets, zip, coordinates, acreage and parcel number. Our Anaheim projects are
named for a company or a street ADDRESS. There is no shared key, and the one that
would be shared is the parcel number, which is the thing we are trying to obtain.

9 of the 19 carry no street on the project side at all, because they are named
after companies.

**CEQAnet stays a two-project gain.** The agency route is a real source with real
fields and we have nothing to join it on.
