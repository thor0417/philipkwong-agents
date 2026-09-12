# THE FRESH RUN, 2026-09-12. HALF OF IT.

Run after migration 050 applied. **The government lane is complete. The
intelligence and opportunity lanes did not run, because the Serper account is out
of credits.** This file reports the half that happened and does not present it as
the whole.

Both commands, per CLAUDE.md, because `scrape:all` IS NOT EVERY SOURCE. Their own
SCOPE lines confirm which ran:

```
npm run scrape:government   SCOPE: FULL RUN of government only    NPM_EXIT=0
npm run scrape:all          SCOPE: FULL RUN of intelligence +
                                   opportunity only               NPM_EXIT=0
```

`NPM_EXIT=0` on the second one is worth pausing on: **the lane exited clean and
captured nothing.** The alarm, not the exit code, is what says so.

---

## 0. THE SNAPSHOTS, LABELLED

```
snapshots/corpus-2026-09-12T02-14-09-brief-u-fresh-run-BEFORE.json
snapshots/corpus-2026-09-12T03-06-32-brief-u-fresh-run-AFTER.json
```

| | BEFORE | AFTER |
|---|---:|---:|
| project rows | 441 | **449** |
| live (register predicate) | 275 | **282** |
| records, all | 2,465 | **2,511** |
| records, live | 984 | **1,030** |
| fact reach | 160 of 275 (58%) | 159 of 282 (**56%**) |

**Fact reach fell and nothing broke.** Seven live projects arrived carrying no
fact, so the denominator moved and the numerator did not. A percentage that falls
because the register grew is not a regression, and it is the kind of number that
reads as one.

## 1. THE GOVERNMENT LANE TOOK THREE PASSES

| pass | Legistar jurisdictions in | note |
|---|---|---|
| 1 | **0 of 7** | every Matters request timed out |
| 2 | 4 of 7 | Clark, Nashville, Yonkers timed out |
| 3 | **7 of 7** | zero timeouts |

No code changed between them. Hand-run, the adapter's exact Matters query answers
in 2.6 to 3.8 seconds against a 30 second timeout: `clark 200, 336,797b, 3.84s`.
Seven simultaneous timeouts followed by seven clean responses is the connection,
not the query, and it is the same class as the `verify:staleness` HTTP 0 readings
that got it moved off the pre-push hook.

**The run said so itself rather than reporting zero as coverage.** Every
jurisdiction printed `*** TRUNCATED: A PAGE REQUEST FAILED ***` and
`PARTIAL HARVEST ... do not read the counts above as coverage`, and the health
judge raised `TOTAL DEATH fetched nothing adapter:legistar [usually 123.0]`. That
machinery worked. Pass 3, the one that counts:

| jurisdiction | matters | pages | matched |
|---|---:|---:|---:|
| Clark County | **427** | 3 | **59** |
| Yonkers | 178 | 1 | 1 |
| Oakland | 150 | 1 | 1 |
| Westchester County | 149 | 1 | 2 |
| Nashville | 130 | 1 | 3 |
| Broward County | 105 | 1 | 1 |
| Phoenix | 65 | 1 | 1 |

## 2. THE MOVEMENT REPORT

`agents/scraper/diagnostics/run-movement.ts --since 2026-09-12T02:14:09Z`,
NPM_EXIT=0, both tables paged to exhaustion.

### New projects: 8

| market | stage | project | bucket |
|---|---|---|---|
| Clark County | filed | COUNTY OF CLARK(AVIATION): PLAN AMENDMENT to redesignate | instrument |
| Clark County | filed | Coast Hotels & Casinos resort | instrument |
| Clark County | filed | Pacific Classic | instrument |
| Clark County | filed | California Hotel casino | instrument |
| Clark County | filed | Cactus 7861 Bermuda Investments | development-other |
| Clark County | approved | Nite Owl | instrument |
| Yonkers | filed | 300 Admiral Way | instrument |
| Anaheim | filed | Development Application NO. 2021-00002 (2021-2029 Housing Element) | development-other |

### New records: 46

| | |
|---|---:|
| on a project that already existed | 35 |
| on a project created this run | 8 |
| unclustered, in the Inbox | 3 |

Per source: `legistar` 29, **`anaheim-agendacenter` 16**, `clark-tab` 1.
Per market: Clark County 25, **Anaheim 16**, Westchester 2, Nashville 1,
Broward 1, Yonkers 1.

Against the last run (2026-09-07): 9 records from `clark-tab` 4, `nyc-ceqr` 3,
`legistar` 1, `ceqanet` 1. This run is five times that, and the difference is
Clark's 427-matter window plus a market that was not being read at all.

### Writes per source, pass 3

```
  legistar              27 inserted / 41 updated
  anaheim-agendacenter   0 inserted / 16 updated
  nyc-city-record        0 / 68     clark-tab      0 / 33
  nyc-ceqr               0 / 65     agenda-portal  0 / 15
  nyc-zap                0 / 42     cftod-pdf      0 / 13
```

### Stage changes: 2

Both Clark County, both `filed -> hearing scheduled`: Grand Flamingo Capital
Management and SCW Diamond, each dated 2026-09-16, which is a hearing in the
future and is what that stage means.

### The emit ledger

Three entries, one per government pass: **23 + 5 + 47 = 75 events inserted, 0
write failures, 0 rejected as duplicate.**

**That zero is the check on migration 050.** The migration corrected
`project_events.occurred_at` in the same act as `leads.published_date` precisely
so this run would not insert a second event, one day apart, for every filing it
re-read. 49 of the 75 are dated after the cut: 28 `record_attached`, 12
`party_identified`, 7 `project_created`, 2 `stage_changed`.

### The tombstones held, and the Gate Note's premise still does not

| | |
|---|---:|
| projects carrying a tombstone note | 88 |
| of those, no longer dismissed | **0** |
| records written this run onto a tombstoned project | **0** |
| new project rows matching a tombstoned name and market | **0** |
| Broward records created this run | 1 |
| of those, title says comprehensive or land-use plan | **0** |

## 3. WHAT ARRIVED, JUDGED IN THE SAME BUCKETS

Judge claude-sonnet-5, rubric q1-v1, 274 labels cached and **8 judged**, which is
exactly the eight arrivals.

**Six instruments, two developments outside the vertical, and ZERO hospitality or
entertainment developments.**

The two that are developments are a Clark County investment parcel and Anaheim's
**2021-2029 Housing Element** - housing, correctly bucketed outside the vertical.

So the arrivals are worse than the register's own mix, which is the honest
comparison to draw:

| bucket | the register now | this run's arrivals |
|---|---:|---:|
| a hospitality or entertainment DEVELOPMENT | 46 (16.3%) | **0** |
| a development, but outside the vertical | 62 (22.0%) | 2 |
| an instrument rather than a project | 153 (54.3%) | 6 |
| municipal housekeeping | 21 (7.4%) | 0 |

Against the post-cleanout judgement of 2026-09-07 - 272 live, 44 developments -
the register is now 282 live and 46 developments. **Two more of the subject, from
a run that added eight projects.**

## 4. THE TWENTY STRONGEST

**Eight projects arrived and none is a hospitality development, so there are no
twenty strongest arrivals to paste.** What follows is the register as it now
stands, ranked by depth - what a reader MEETS on the page - so the brief's
question has an answer even though its subject does not exist this week.

| # | depth | project | market | stage | recs | facts | conds |
|---:|---:|---|---|---|---:|---:|---:|
| 1 | 288 | Heart Hotel / Kulik River | Clark County | permitted | 38 | 24 | 220 |
| 2 | 226 | Happy Miner mixed-use development | Clark County | filed | 25 | 24 | 46 |
| 3 | 210 | Tropicana Land resort | Clark County | approved | 10 | 16 | 206 |
| 4 | 192 | Mary Bartsas 7 | Clark County | filed | 6 | 17 | 58 |
| 5 | 165 | BR Ovation Limited Partnership mixed-use | Clark County | filed | 8 | 24 | 32 |
| 6 | 150 | B & O Investment hotel | Clark County | filed | 3 | 24 | 32 |
| 7 | 148 | World Buddhism Association HQ & MGM-Grand | Clark County | approved | 7 | 12 | 40 |
| 8 | 107 | Metropolitan Park / Willets Point | New York City | approved | 13 | 24 | 0 |
| 9 | 102 | S4A004 hotel | Clark County | filed | 2 | 15 | 20 |
| 10 | 98 | Apple Hospitality Las Vegas 7145 hotel | Clark County | filed | 2 | 16 | 19 |
| 11 | 93 | V L V 1 resort | Clark County | filed | 4 | 15 | 16 |
| 12 | 93 | OCVibe | Anaheim | approved | 33 | 14 | 0 |
| 13 | 87 | Monitor Point | New York City | approved | 3 | 24 | 0 |
| 14 | 78 | 185 BCC | Clark County | filed | 1 | 14 | 13 |
| 15 | 72 | Bally's Bronx | New York City | approved | 7 | 15 | 0 |
| 16 | 70 | Mirage Propco casino | Clark County | approved | 3 | 11 | 7 |
| 17 | 64 | Majestic Ejm Arroyo V | Clark County | filed | 1 | 13 | 5 |
| 18 | 63 | CHD Convenience hotel | Clark County | approved | 1 | 13 | 7 |
| 19 | 60 | NP Durango casino | Clark County | filed | 1 | 12 | 7 |
| 20 | 58 | Visible Noise | Clark County | filed | 5 | 12 | 4 |

**Seventeen of the twenty are Clark County**, which is the same concentration
every depth ranking in this repo has shown, and it is a fact about where the
conditions reader exists rather than about where the projects are.

## 5. ANAHEIM'S FIRST CAPTURE

The lane built on 2026-09-11 ran for the first time.

```
Anaheim AgendaCenter: category 18, 44 meetings listed (33 with an action agenda,
11 agenda only), 44 read, 0 refused as another body, 0 unreadable -> 16 item leads
    pass 1:  16 inserted /  0 updated
    pass 2:   0 inserted / 16 updated
    pass 3:   0 inserted / 16 updated
```

**Sixteen, exactly as the dry measurement predicted, and then the same sixteen
updated twice.** That is `MeetingRef.identityUrl` doing the one job it exists for:
an item keeps one identity across the agenda and the action agenda, so a weekly
cadence re-reading the same meetings updates them rather than filing each hearing
again. It was the part of the Anaheim design I was least sure of and it is now
measured rather than argued.

Anaheim contributed 16 of the run's 46 records, second only to Clark County.

## 6. WHAT DID NOT RUN, AND WHY

```
Serper "...": failed: HTTP 400 - Not enough credits        (every query)
TOTAL DEATH  fetched nothing  adapter:serper  [fetched 0, kept 0, usually 731.7]
LANE ALERT: "intelligence" fetched 0 and wrote 0 (total death)
```

**The Serper account is out of credits**, and Serper is the ONLY active source in
that half of the run: `Fetched per source: 0 serper`. Everything downstream
reported zero - feasibility 0, TED CPV 0, GLI Tier 1 0, and the fuel module
printing its own `** FAILURE: zero fuel tenders found. This is a reportable
failure, not a pass. **`

Nothing in this repository can work around that. It needs a credit top-up.

**The press half of this run does not exist**, so no press record arrived, no
press figure was added to any project, and the intelligence lane's contribution
to the movement report above is zero by absence rather than by judgement.

## 7. FOUND, NOT ASKED ABOUT

1. **A transient stall zeroes seven markets and nothing retries.** Pass 1 lost
   all seven Legistar jurisdictions and roughly 123 records. The run reported it
   honestly, in the middle of a long report, and stopped. I noticed and re-ran
   three times. **On a Monday, under the weekly cadence, nobody does that**: the
   job would finish green with `PARTIAL HARVEST` buried in it and the week would
   be silently short. A page-level retry is the obvious answer. Queued.
2. **Serper credits are an unmonitored prerequisite.** The same weekly job would
   have produced the same silent zero for the whole intelligence half. There is
   no check anywhere that says "the search account has credit", and the failure
   presents as `NPM_EXIT=0`. Queued.
3. **`NPM_EXIT=0` over a total death is the shape this repo already knows.** The
   captured exit line is the answer to "did the command run", and it is not the
   answer to "did the run capture anything". Both alarms fired correctly; the
   exit code said nothing. Worth remembering wherever an exit code is the gate.
