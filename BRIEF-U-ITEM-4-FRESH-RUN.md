# BRIEF U ITEM 4. THE FRESH RUN.

Run 2026-09-07, after the cleanout and after item 3. Government lane first, then
`scrape:all`. Both commands, because `scrape:all` IS NOT EVERY SOURCE and the run
report's own SCOPE line cannot be trusted to say which happened - it printed
`FULL RUN of government only` and `FULL RUN of intelligence + opportunity only`
respectively, which is exactly the pair CLAUDE.md says to check for.

## The snapshots, labelled

```
snapshots/corpus-2026-09-07T08-55-07-brief-u-item-4-BEFORE.json
snapshots/corpus-2026-09-07T09-15-27-brief-u-item-4-AFTER.json
```

| | BEFORE | AFTER |
|---|---:|---:|
| project rows | 438 | **441** |
| live (register predicate) | 272 | **275** |
| dormant | 70 | 70 |
| records, all | 2,456 | **2,465** |
| records, live | 975 | **984** |
| fact reach | 160 of 272 (59%) | 160 of 275 (58%) |

Both gates captured on their own line: `npm run scrape:government` **NPM_EXIT=0**,
`npm run scrape:all` **NPM_EXIT=0**.

---

## 1. THE MOVEMENT REPORT

### New projects: 3

| market | stage | project | bucket |
|---|---|---|---|
| New York City | filed | Phoenix Roller Coaster East Walk Demapping | **development-vertical** |
| New York City | filed | 79th Street Boat Basin Reconstruction Project | **development-vertical** |
| Broward County | filed | MOTION TO APPOINT Barbra A. Stern to the Performing Arts Center Authority | housekeeping |

### New records: 9

| | |
|---|---:|
| on a project that already existed | 5 |
| on a project created this run | 3 |
| unclustered, in the Inbox | 1 |

Per source: `clark-tab` 4, `nyc-ceqr` 3, `legistar` 1, `ceqanet` 1.
Per market: Clark County 4, New York City 3, Broward County 1, none 1.

### Per-source volume, against the last run

The government lane wrote **284 records of 349 matched** - 9 inserted, 275
updated - and **65 were skipped as dismissed against the tombstone**, which is
the cleanout holding on the write path rather than only on the register.

| jurisdiction | fetched | matched | gate-admitted | inserted / updated |
|---|---:|---:|---:|---|
| Clark County, NV | (35 matters, 64 attachments listed, 35 fetched) | | | |
| Broward County, FL | **277** | **1** | **1** | 1 / 0 |
| nyc-zap | 891 | | 48 | 48 |
| nyc-city-record | 2,383 | | 96 | 96 |
| nyc-ceqr | 15,391 | | 66 | 66 |
| Las Vegas | **0** | 0 | 0 | **0** |

Attachment depth: Clark 35 matters / 64 listed / 35 fetched / 33 contact blocks;
Nashville 3 / 2 / 2 / 1; Oakland 1 / 5 / 2 / 1; Westchester 2 / 7 / 5 / 2;
Broward 1 / 1 / 1 / 0; Phoenix 1 / 0 / 0 / 0.

Project attachment: **284 written, 261 joined an existing project, 3 created a
new one, 20 left unclustered.**

### `scrape:all`: the intelligence lane wrote nothing, and the alarm fired

```
Serper (curated intelligence): 157 searches, 192 unique results
GLI: dropped 54 leads as low-quality source
GLI: recency gate (90d) dropped 5 stale, kept 133 undated
  Fetched from Serper:   192
  Kept after inclusion rule: 0
  Dropped as noise:      129
  Written (hospitality): 0

LANE ALERT: "intelligence" fetched 192 and wrote 0
ERROR  Lane "intelligence" fetched 192 and wrote 0  kind=empty-lane verdict=zero-write
```

**The alarm behaved exactly as designed and nobody would have seen it.** It went
to stdout. That is precisely the finding `BRIEF-S-ITEM-5-CADENCE.md` section 5
made and precisely what item 5's workflow now routes into a GitHub Issue and a
red job.

The Serper watch-term pass also returned **48 results, all 48 off the curated
list**, and the hosts are `facebook.com` 11, `instagram.com` 8, `linkedin.com` 4,
`tiktok.com` 5, `m.youtube.com` 3, `reddit.com` 2. The unrestricted watch pass is
returning social media, not filings.

The fuel module reported its own failure honestly: `** FAILURE: zero fuel tenders
found. This is a reportable failure, not a pass. **`

### Stage changes

The lifecycle sweep scanned 2,465 rows: **0 newly expired, 4 newly dead**, 706
already classified. The four are a commissioner report, a cancelled 2023 hearing
notice, Hudson Boulevard Block 4 and a Flamingo street-name change.

Live register by stage: filed 163, dormant 70, approved 62, hearing scheduled 38,
stalled 10, under construction 1, permitted 1.

### The emit ledger

`snapshots/project-events-emit.jsonl`, newest entry:

```json
{"at":"2026-09-07T09:10:13.563Z","label":"backfill-projects","derived":19,
 "duplicatesInBatch":0,"alreadyStored":2,"attempted":17,"inserted":17,
 "rejectedAsDuplicate":0,"refusedByACoarserIndex":0,"writeFailures":0,
 "byType":{"party_identified":5,"project_created":3,"milestone_set":1,"record_attached":8}}
```

19 derived, 2 already stored, 17 attempted, **17 inserted, 0 write failures, 0
rejected as duplicate, 0 refused by a coarser index.**

---

## 2. THE GATE NOTE'S QUESTION, ANSWERED

`GATE-NOTE-COMPREHENSIVE-PLAN.md` logged the claim that the 71 Broward rows would
return on the next capture. **They did not, and the measurement is unambiguous on
this run.**

```
Broward County, FL: 277 fetched / 1 matched / 1 gate-admitted
                    dropped 0 excluded / 3 weak-no-action / 273 no-match
```

**273 of 277 Broward candidates did not match the vocabulary at all.** The one
admitted is `MOTION TO APPOINT Barbra A. Stern to the Performing Arts Center
Authority` - it matched on a real venue noun, not on 'comprehensive plan' - and
the judge bucketed it `housekeeping` on arrival, so it is already labelled for
the next cleanout.

And the tombstones held, on every path back:

| | |
|---|---:|
| projects carrying a tombstone note | 88 |
| of those, no longer dismissed | **0** |
| records written this run onto a tombstoned project | **0** |
| NEW project rows matching a tombstoned name+market | **0** |
| Broward records created this run whose title says comprehensive/land-use plan | **0** |

### THE PREMISE DOES NOT HOLD IN THIS CODE, AND THAT IS CHECKABLE

Both halves of the claim were checked in the tree rather than assumed, which the
gate note said to do:

**'comprehensive plan' was not on an exclusion list.** It was on the VENUE
VOCABULARY - a positive-match list - and removing it on 2026-08-23 is why 76
Broward records stopped matching and 71 projects emptied. Removing a term from a
positive list cannot be undone by another path "letting it back in"; a record
either matches the vocabulary or it does not.

**There is no LLM free-text admission path.** `gate-decide.ts` is the single
admission route and contains no model call. Its two bypasses are `targets.ts`
(a curated named-project list) and adapters declaring `bypass: true`, of which
`govdocs` is the one that consults no gate - and that is documented in
`lib/taxonomy.ts` beside the removal itself. `government.ts` DOES hold an
Anthropic client, and it is a **player extractor**: `mergePlayers` fills
`presented_by`, `applicant`, `representative` and `action_sought` on records that
have ALREADY passed the gate. It runs after admission and cannot admit anything.

### THE ONE QUALIFICATION, STATED RATHER THAN BURIED

**The 71 originals were not re-offered on this run.** Legistar Broward ran
incrementally: `129 matters since 2026-07-20`. The rows the cleanout tombstoned
predate that window, so this run could not have resurrected them by re-fetching
them. What it DOES prove is the rate on Broward's current filings - 273 no-match
out of 277 - and that no path wrote onto a tombstoned project.

**A forced backfill is the only test that re-offers the originals.**
`npm run scrape:government:backfill` would do it, and it was not run here because
it is a twelve-month re-fetch of every jurisdiction and this run had a movement
report to produce. It is one command and it is the honest closing of this
question.

---

## 3. WHAT ARRIVED, JUDGED IN ITEM 2'S BUCKETS

Three projects arrived. Two of the three are in the vertical, which is a **67%
vertical rate against the register's 16.7%** - but on a denominator of three, so
it is an observation and not a trend.

| bucket | arrived | the register now | the register before the cleanout |
|---|---:|---:|---:|
| hospitality/entertainment DEVELOPMENT | **2** | 46 (16.7%) | 49 (13.8%) |
| a development, outside the vertical | 0 | 61 (22.2%) | 61 (17.2%) |
| an instrument rather than a project | 0 | 147 (53.5%) | 148 (41.8%) |
| municipal housekeeping | **1** | 21 (7.6%) | 96 (27.1%) |

The judge's own reasons for the two vertical arrivals, verbatim:

- **Phoenix Roller Coaster East Walk Demapping** - "Street demapping enables
  roller coaster construction in amusement park."
- **79th Street Boat Basin Reconstruction Project** - "Marina reconstruction
  scheme falls within leisure development vertical."

Both are New York City, both carry one record and no stated fact, and one carries
a party. They are thin on arrival, which is normal: a ULURP application arrives
before the CPC report that describes it.

---

## 4. THE TWENTY STRONGEST, BY NAME

The brief asks for the twenty strongest arrivals. **Three projects arrived, so
there are not twenty**, and the two vertical ones are listed above with their
reasons. What follows is the twenty strongest in the register as it now stands,
which is what a reader actually meets, ranked by depth rather than by
significance.

| # | depth | project | market | stage | party | recs | facts | conds |
|---:|---:|---|---|---|---|---:|---:|---:|
| 1 | 288 | Heart Hotel / Kulik River | Clark County | permitted | KULIK RIVER CAPITAL, LLC | 38 | 24 | 220 |
| 2 | 218 | Happy Miner mixed-use development | Clark County | filed | HAPPY MINER, LLC | 21 | 24 | 46 |
| 3 | 208 | Tropicana Land resort | Clark County | approved | TROPICANA LAND, LLC | 9 | 16 | 206 |
| 4 | 188 | Mary Bartsas 7 | Clark County | filed | MARY BARTSAS 7, LLC | 4 | 17 | 58 |
| 5 | 165 | BR Ovation Limited Partnership mixed-use development | Clark County | filed | BR OVATION LIMITED PARTNERSHIP | 8 | 24 | 32 |
| 6 | 150 | B & O Investment hotel | Clark County | filed | B & O INVESTMENT, LLC | 3 | 24 | 32 |
| 7 | 148 | World Buddhism Association HQ & MGM-Grand | Clark County | approved | World Buddhism Association | 7 | 12 | 40 |
| 8 | 107 | Metropolitan Park / Willets Point | New York City | approved | NYC Economic Development Corp | 13 | 24 | 0 |
| 9 | 102 | S4A004 hotel | Clark County | filed | S4A004, LLC | 2 | 15 | 20 |
| 10 | 98 | Apple Hospitality Las Vegas 7145 hotel | Clark County | filed | APPLE HOSPITALITY LAS VEGAS | 2 | 16 | 19 |
| 11 | 89 | V L V 1 resort | Clark County | filed | V L V 1, LLC | 2 | 15 | 16 |
| 12 | 89 | OCVibe | Anaheim | approved | Anaheim Real Estate Partners | 27 | 14 | 0 |
| 13 | 85 | Monitor Point | New York City | approved | GO Quay LLC | 3 | 24 | 0 |
| 14 | 78 | 185 BCC | Clark County | filed | 185 BCC, LLC | 1 | 14 | 13 |
| 15 | 72 | Bally's Bronx | New York City | approved | Bally's | 7 | 15 | 0 |
| 16 | 70 | Mirage Propco casino | Clark County | approved | MIRAGE PROPCO, LLC | 3 | 11 | 7 |
| 17 | 64 | Majestic Ejm Arroyo V | Clark County | filed | MAJESTIC EJM ARROYO V, LLC | 1 | 13 | 5 |
| 18 | 63 | CHD Convenience hotel | Clark County | approved | CHD CONVENIENCE, LLC | 1 | 13 | 7 |
| 19 | 60 | NP Durango casino | Clark County | filed | NP DURANGO, LLC | 1 | 12 | 7 |
| 20 | 58 | Visible Noise | Clark County | filed | VISIBLE NOISE, LLC | 5 | 12 | 4 |

Three of those twenty were not on the list a day ago. **S4A004 hotel (#9) and
V L V 1 resort (#11)** were in the reader gap with zero facts and were moved off
zero by re-running the Clark reader; **B & O Investment hotel (#6)** was two
project rows sharing one name until the cleanout tombstoned the empty half.

---

## 5. FOUND, NOT ASKED ABOUT

1. **The Serper watch-term pass is returning social media.** 48 results, all 48
   off the curated list, and the hosts are Facebook 11, Instagram 8, TikTok 5,
   LinkedIn 4, YouTube 7, Reddit 2. Zero were kept. The unrestricted pass was
   built to reach beyond the curated allowlist and what it is reaching is
   consumer social, so the search terms rather than the allowlist are the
   problem.
2. **The intelligence lane wrote zero from 192 fetched and only stdout knows.**
   That is the exact failure the cadence's red verdict exists for, and this run
   is the first time it has been observed live.
3. **Las Vegas fetched 0 again, from this machine.** `0 records fetched, 0
   keyword-matched, 1 written. No Las Vegas signals surfaced this run.` It is a
   403, not an empty week, and only the hosted runner can tell the difference.
   Item 3 section 4 has the scoping.
4. **`leads` has no `created_at` column.** The movement cut uses `first_seen`,
   which the write path sets on insert and never on update, so it is the arrival
   column. Worth knowing before someone writes a query against `created_at` and
   gets an empty result rather than an error.
5. **20 records were left unclustered and went to the Inbox this run**, against 3
   projects created. That ratio is worth a look: the clusterer is declining to
   attach nearly seven times as many records as it is creating projects for.
