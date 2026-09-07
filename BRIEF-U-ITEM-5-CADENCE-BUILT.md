# BRIEF U ITEM 5. THE WEEKLY CADENCE, BUILT.

Built 2026-09-07. The report it was built from is `BRIEF-S-ITEM-5-CADENCE.md`,
measured 2026-08-27; this file records what changed since that report, what was
built, what was proven, and what is still somebody's to do.

---

## 1. WHAT CHANGED SINCE THE REPORT

Three of the five blockers that report listed as Philip's are now cleared, and
they were cleared without anyone saying so, which is worth recording because two
of them were named as **blocking**.

| Blocker, as the report stated it | State on 2026-09-07 |
|---|---|
| Migration 044, `source_health.market` | **APPLIED.** Probed directly: the column selects without error. |
| `next_delivery` is null on both clients | **SET.** Both read `2026-08-31`. |
| `cadence` is `monthly`, the product is weekly | **CHANGED.** Both read `weekly`, so migration 045 is applied too. |
| Nothing reads cadence or next_delivery | **BUILT.** `agents/scraper/cadence.ts`. |
| Egress, PR #6 | Unchanged. Las Vegas still answers 403 from this machine. |

So a strict reading of the model no longer produces zero documents on a Monday.
Both clients are due today.

---

## 2. WHAT WAS BUILT, AGAINST THE TWELVE STEPS

The report named three steps that did not exist. All three now do.

| # | Step | Was | Now |
|---|---|---|---|
| 6 | decide which clients are due | NO | `agents/scraper/cadence.ts`, `npm run cadence:due` |
| 7 | build each due client's document | BROWSER ONLY | `dashboard/e2e/weekly.deliver.ts`, project `deliver` |
| 10 | file reaches a recipient | NO | a workflow artefact, 90-day retention |
| 11 | recipient is told | NO | a GitHub Issue, labelled `weekly-cadence` |
| 12 | alarm lands somewhere | stdout | the same issue, plus the job fails on a red verdict |

`.github/workflows/weekly.yml`, `ubuntu-latest`, Monday 01:00 UTC, 16 steps.

### The rule for "due", and the failure mode it refuses

A client is due when `status = 'active'` AND `next_delivery <= today`.

**A null `next_delivery` means NEVER due, not always due.** The other reading
mails every client every week from one missing value, and the first time it
happens it happens to a real person. The null is reported by name and count and
nothing is generated for it.

`next_delivery` advances **after** the documents exist, never before, from
`cadence/delivered.json`. A date advanced ahead of the generation is a week
silently skipped when the generation fails. And the advance is from **today**
where the stored date has already gone by, or a due date three weeks old would
set the next one two weeks in the past and the client would be due again on
every run, forever.

### Why Playwright and not a generator

`buildReport` is behind `'use client'`. Extracting it into a headless path is
real work that has to respect the package split, which is asymmetric and has
broken a deploy once already. So the first Monday document is built by the exact
code path Philip uses, which is also the only way to be sure it is the same
document. That is a deliberate first version and it is written into the file
header so nobody mistakes it for the right long-term answer.

### What a week with nothing to report sends

**The document, with the zero stated.** Not silence and not a shorter artefact.
Silence is indistinguishable from the system being dead, and if a quiet week and
a broken pipeline produce the same empty inbox the client cannot tell which one
they are paying for. The only case that generates nothing is a **refusal by the
composer** on an incomplete provenance basis, and the spec reports that by name
rather than swallowing it. A due client that produces no document **fails the
job**.

### Where the alarm lands

Two channels. The issue is written **first** and the job fails **second**, so a
red week is reported before it is failed.

The verdict is about the **corpus**, not about a crash: a run that captures
nothing still exits 0, and `HEALTH_NO_WRITE=1` is one environment variable away
from a run that looks completely normal and records nothing. The workflow never
sets it and says so in a comment where somebody would be tempted to.

It goes red on: an empty `source_health`; any covered market the newest run
**read** and kept nothing for; every market reading never-recorded, which is what
`HEALTH_NO_WRITE=1` looks like from outside; and every due client having zero
included projects.

---

## 3. THE SECRETS. FOUR, PLUS TWO, PLUS A LOGIN.

**The four the report named:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

**Two the lanes need and which the report treated as optional:**
`ANTHROPIC_API_KEY` and `SERPER_API_KEY`. Absent, the workflow runs the
government lane alone, which is the half that feeds covered markets, and the
issue says so rather than implying everything ran.

**And one pair the report did not name, which is a real gap in it:**
`E2E_EMAIL` and `E2E_PASSWORD`. The composer runs through the authenticated
dashboard, so without a login nothing can be generated at all. The workflow
checks all six **before** capturing anything: a run that scrapes for forty
minutes and then cannot log in has spent the whole budget to produce nothing, and
the failure would read as a composer fault rather than a missing secret.

---

## 4. PROVEN, NOT DESCRIBED

Run end to end on this machine against the real corpus, 2026-09-07,
`CADENCE_RUN=1 npx playwright test --project=deliver`, **NPM_EXIT=0**:

```
due clients: 2
--- JKR & Associates (115 included projects) ---
  preview: 57 projects, 4 records
  wrote ../cadence/documents/jkr-associates-weekly-2026-09-07.pdf (55800 b)
--- Simtec Attractions (5 included projects) ---
  preview: 5 projects, 2 records
  wrote ../cadence/documents/simtec-attractions-weekly-2026-09-07.pdf (48503 b)
2 of 2 due clients delivered
```

Both read back off disk: `%PDF-1.3`, 5 pages, 26,734 characters of text in the
JKR document. It carries the cover, the provenance legend, the scoping statement
with every exclusion counted, What moved, Headline finds with links, the per
category detail and the coverage note. Nobody clicked anything.

`cadence/` is gitignored. A client document in the repository is a client
document in every clone.

---

## 5. FOUND WHILE BUILDING IT, AND IT WAS PRINTING IN CLIENT DOCUMENTS

**`lib/source-health.ts` `captureByMarket` treated a run as an instant.**

`persistSourceRuns` inserts one batch per LANE, and a capture is more than one
lane. Measured against the stored table: the 2026-09-02 capture wrote its
legistar rows at 10:04:34.156 and its anaheim rows at 11:06:49.343, 62 minutes
apart. `newestRun` returned 11:06:49 and every market legistar had read fell
outside it. The sentence this produced, through the coverage note in
`report-sections`, in a **client document**:

> Our last capture run, on 2026-09-02, recorded nothing for these markets:
> Broward County (last captured 2026-09-02, 23 records); Clark County (last
> captured 2026-09-02, 282 records); Nashville (29); Oakland (10); Phoenix (36);
> Westchester County (2); Yonkers (1).

Recorded nothing, 282 records, same date, on the same line. Seven markets named
and wrong about all seven. That is standing rule 3's own machinery inverted: the
sentence that exists so a gap is never silent was inventing gaps.

**Fixed.** A run is a window of 12 hours rather than an instant, and the number
is taken from those measurements: the longest gap inside one capture is 62
minutes and the shortest gap between captures is days. And a fourth state,
`not-in-run`, because the newest run's rows **name its scope** -
`government.ts` already writes a `market:<name>` row with `kept: 0` for every
market a run declared and which produced nothing. A market with no row in the
newest run was not read by it, which is neither a success nor a failure and gets
its own sentence saying so. Golden case
`a-scoped-run-reported-as-a-capture-failure`, and the existing case
`a-missing-capture-and-a-shallow-market-are-two-sentences` was rewritten to model
what the writer actually writes rather than what the first version assumed.

**Not fixed, and reported: per-market health rows exist for two adapters only.**
Only the legistar and agenda-portal lanes write `market:` rows. `nyc-zap`,
`nyc-city-record`, `nyc-ceqr`, `clark-tab`, `ceqanet`, `cftod-pdf`, `sfwmd` and
`govdocs` all write `market: null`. So **New York City**, with 97 live projects,
**can never read `captured`** and its client-facing sentence is permanently "No
capture run on record has kept a record for New York City" - which is true as
stated and is a gap in the recording rather than in the capture. Las Vegas and
CFTOD are in the same position. That is one line per adapter and it belongs with
the fresh run rather than here.

---

## 6. WHAT IS STILL SOMEBODY'S

1. **Set the eight secrets in the repository settings.** Nothing runs without
   the six required ones.
2. **The first scheduled run is the wall-time measurement.** No run report in
   this repository records a capture wall time and none is estimated here.
   GitHub Actions gives 2,000 free minutes a month on a private repository; the
   question is whether a full cycle fits in the 120-minute job timeout, not
   whether it fits in a budget.
3. **`staleness.yml` runs at 06:00 UTC Monday, five hours AFTER this.** Its own
   header says it exists so a dead feed is known **before** a document quoting it
   is generated. That is the wrong way round and it is left alone deliberately:
   changing another workflow's schedule from inside this one is how two jobs come
   to disagree about which ran first. One line, and it is Philip's call.
4. **Delivery is an artefact and an issue, not an email.** Wiring the Gmail route
   means putting `token.json` into CI secrets and touching the send path, with
   standing rule 12 sitting next to it. That is v2.
