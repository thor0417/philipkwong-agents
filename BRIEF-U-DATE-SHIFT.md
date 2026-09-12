# THE DATE SHIFT. COSTED, FIXED, AND THE MIGRATION PRINTED.

Measured and fixed 2026-09-11. Diagnostics:
`agents/scraper/diagnostics/date-shift-census.ts` and
`agents/scraper/diagnostics/date-shift-cost.ts`, both NPM_EXIT=0, both paged to
exhaustion with no cap. `npm run verify` NPM_EXIT=0.

---

## 0. THE SHORT ANSWER

**Three call sites was wrong. It is one shared writer and seven direct ones.**
`toIso` in `sources/types.ts` serves 30 call sites across 20 adapters and had no
way for a caller to say what shape it was handing over, so it could not be
correct for all of them at once. That is where the fix went.

**No date is off by more than one day, and that is arithmetic rather than a
sample.** The correction is +7 hours. Every distinct clock time in the corpus was
counted: 1,204 values sit at 17:00:00Z and move one day; 366 sit at 00:00:00Z and
were always right; the rest carry a real publication time and do not move.

**The fix DOES change which records fall inside a client document's period
bounds, through events rather than records.** A document's record lines are
scoped on `first_seen`, which carries no shift at all. Its **What moved** section
is scoped on `project_events.occurred_at`, and 1,021 of 2,083 events carry the
shift. On the one July 2026 window already delivered, the events inside the
period go **245 to 254**. On the 2026-08-03 to 08-06 window, **41 to 40**.

**Nothing leaves the register.** The correction only ever moves a date forward,
so a project can look more recent and never less. 232 projects change their
latest-activity day and **zero** cross the twelve-month liveness floor.

---

## 1. WHERE IT COMES FROM, AFTER THE SWEEP

`new Date(s)` parses a string carrying no timezone in the **runtime's local
zone**. An ISO date-only string is parsed as UTC by specification, which is why
this is not everywhere.

| | |
|---|---|
| `new Date('December 15, 2025')` | UTC+7 -> `2025-12-14T17:00:00Z` |
| `new Date('2026-07-13T00:00:00')` | UTC+7 -> `2026-07-12T17:00:00Z` |
| `new Date('2026-07-13')` | -> `2026-07-13T00:00:00Z`, safe |

The sweep found the writers I had not: `sources/types.ts:80` (`toIso`, the shared
one), `sources/serper.ts:362` (`parseSerperDate`, "Dec 12, 2025"),
`sources/worldbank.ts:119` through `toIso` ("15-Jul-2026"),
`sources/legistar.ts:611` (`EventDate`, a second Legistar shift the `latestIso`
fix alone would have missed), and `sources/lasvegas.ts:92`. It also found the
sibling shape: **local-calendar arithmetic on a UTC instant** at
`legistar.ts:356` and `:390` and `verify-staleness.ts:129`, where `setMonth` and
`getDate` walk the runtime's calendar and move a window bound by a day near a
month boundary.

**Confirmed against the live publishers, not against a literal:**

```
webapi.legistar.com/v1/clark/matters   MatterIntroDate '2026-09-09T00:00:00'   no zone
anaheim.granicus.com ViewPublisher     "December 15, 2025"                     no zone
```

## 2. THE COST, PER MARKET

Undismissed rows whose printed date moves one day forward.

| market | dated | shifted | crossing a month edge | crossing a year edge |
|---|---:|---:|---:|---:|
| Clark County | 349 | **301** | 3 | 0 |
| (no market) | 366 | 127 | 3 | 1 |
| Broward County | 98 | **98** | 0 | 0 |
| Anaheim | 78 | **75** | 1 | 0 |
| New York City | 188 | 51 | 1 | 0 |
| Phoenix | 43 | 40 | **6** | 0 |
| Nashville | 40 | **40** | 2 | 0 |
| Las Vegas | 66 | 16 | 1 | 0 |
| San Antonio | 14 | **14** | 0 | 0 |
| Oakland | 14 | **14** | 0 | 0 |
| Orange County, Miami-Dade | 6, 6 | 6, 6 | 0 | 0 |
| 35 further markets | 1 to 3 each | all | 0 | 0 |

**17 rows cross a month boundary**, which is the boundary a monthly client
document is scoped by. No market escapes: Broward, Nashville, San Antonio and
Oakland are shifted on **every** dated row they hold, and Anaheim on 75 of 78.

Per source, which is where the fix had to land:

| source | dated | at local midnight |
|---|---:|---:|
| legistar | 510 | **507** |
| gli_serper | 140 | 107 |
| worldbank | 98 | 89 |
| agenda-portal | 118 | 73 |
| nyc-zap | 43 | **43** |
| iadb | 7 | 2 |
| nyc-ceqr, nyc-city-record, clark-tab, ceqanet, cftod-pdf, sfwmd | 206 | **0** |

## 3. THE FIRST CHECK: IS ANY DATE OFF BY MORE THAN ONE DAY?

**No, and the corpus says so directly rather than by sampling.** Every distinct
clock time across 1,808 dated rows:

```
  17:00:00   1204   local midnight at UTC+7. ONE DAY EARLY.
  00:00:00    366   parsed as UTC. correct.
  02:00:00     67   agenda-portal: a 09:00 Las Vegas meeting. RIGHT DAY.
  (no time)    53   stored as a bare date. correct.
  11:00:00     27   agenda-portal: an 18:00 meeting. RIGHT DAY.
  04:00:00     13   sfwmd, epoch arithmetic. correct.
  05:00:00     12   sfwmd. correct.
  21:00:00      3   iadb.       10:00:00  1  agenda-portal.
  and 20 further gli_serper values at real clock times, from relative dates.
```

**No other local-midnight offset is present**: no 16:00:00Z (UTC+8), no
18:00:00Z, no 05:00:00Z pattern. One capturing machine, one offset, one day.

And the 67 rows at 02:00:00Z are the useful counter-example. A Las Vegas PrimeGov
meeting published as `2026-07-13T09:00:00` parsed to 02:00:00Z here, which is the
**right day** because nine in the morning is more than seven hours after
midnight. Only a value at or before 07:00 local crosses back over midnight. That
is why the count is 1,204 and not all 1,808.

## 4. THE SECOND CHECK: DOES IT MOVE ANYTHING INSIDE AN ALREADY-SENT DOCUMENT?

**Yes. Through events, not records, and that was worth checking rather than
assuming.**

`report-build` scopes record lines on `first_seen` (`:566`) and events on
`occurred_at` (`:675`). Measured over every delivered window on record:

| delivered window | records in window | events in window |
|---|---|---|
| 2026-07-01 .. 2026-07-31 | 1,377 -> 1,377 | **245 -> 254** |
| 2026-08-03 .. 2026-08-06 | 0 -> 0 | **41 -> 40** |
| 2026-08-07 .. 2026-08-07 | 0 -> 0 | 0 -> 0 |

`first_seen` carries the shift on **0 of 2,465 rows**, because it is written from
a zero-argument `new Date()` and has no source string to misparse. So no record
line moves. Nine events enter the July window and one leaves the August one: a
**What moved** section regenerated after the migration will not match the one
already sent. Six further delivered rows stored no `period_end` at all and have
no bounds to cross.

The month-by-month view of the dashboard's own date filter, which **is** keyed on
`published_date`:

```
  2026-06   112 -> 105   (-7)      2026-08   130 -> 125   (-5)
  2026-07   131 -> 139   (+8)      2026-09    20 ->  25   (+5)
  2025-03     9 ->   8   (-1)      2025-04    12 ->  13   (+1)
  2026-04    67 ->  66   (-1)      2000-12     1 ->   0   (-1)
```

## 5. THE FIX

`agents/scraper/sources/source-date.ts`. `sourceIso` keeps a stated zone and
reads a zoneless value as UTC, so the calendar fields the publisher wrote
survive. `toIso` delegates to it, which corrects 30 call sites across 20 adapters
in one place; `agenda-portal`, `legistar` (both `latestIso` and `EventDate`),
`nyc-zap`, `lasvegas`, `serper` and `ceqanet` are wired to it directly. The
sibling shape went with it: `backfillBound`, `matterBound` and
`verify-staleness`'s `monthsAgo` now use `setUTCMonth` and `setUTCDate`, and the
"years behind" figure in the staleness verdict parses Legistar's naive datetime
through `sourceIso`.

**What is deliberately NOT claimed.** A PrimeGov agenda that says
`2026-07-13T09:00:00` means nine in the morning **Pacific**, and the true instant
is 16:00Z or 17:00Z depending on the season. `sourceIso` stores 09:00Z: the wrong
instant and the right day. The day is the fact every consumer here uses. Inventing
a jurisdiction's offset to fix an hour nobody reads would be a fabrication.

**Two things the fix got wrong first, both caught by the golden case rather than
by review.** The offset correction had the sign backwards and landed on the same
wrong day by a different route. And `HAS_ZONE`, written as a bare
`[+-]\d{2}:?\d{2}$`, matched the tail of **"15-Jul-2026"** - hyphen, 20, 26 - so
every World Bank date read as already-zoned and came back a day early from the
function written to correct it. Both are in the file as comments where the next
person will hit them.

Golden case `a-meeting-date-that-is-the-machines-midnight` is now **guarded**
rather than pending. Its check has two halves on purpose: the behavioural half
would pass on the UTC runner however the call sites were written, so the second
half asserts that each of the seven writers still routes through the helper.

## 6. THE MIGRATION, RUN 2026-09-12

**It ran, it reported an error, and the error was not what it looked like.** The
editor answered `ERROR: 42P01: relation "shifted_leads" does not exist`, and read
back immediately afterwards every row it was meant to move had moved, once:

```
  leads.published_date at 17:00:00Z    1,204 -> 0
    and at 00:00:00Z                     366 -> 1,570   (366 + 1,204, exact)
  project_events.occurred_at           1,021 -> 3       (the 3 named below)
  projects.last_activity                 319 -> 0
  leads.deadline                           1 -> 1       (TED, excluded on purpose)
```

**Applied once, not twice**: a second +7h would leave rows at 07:00:00Z and there
are none.

**The human check passes.** Anaheim's Planning Commission meets on a Monday and
its Council on a Tuesday. Before the correction every stored Planning Commission
record fell on a **Sunday** and every Council record on a **Monday**. After it,
Planning Commission Mon 17; City Council Tue 57, with one Monday, two Wednesdays
and one Friday that are special meetings. The 15 December 2025 agenda now reads
2025-12-15 and read 2025-12-14 before.

**What failed was the temp table, and it has been removed.** The first version
built `shifted_leads` inside a `BEGIN`/`COMMIT` with `ON COMMIT DROP` and had
three later statements read it. A temp table lives in one session and
`ON COMMIT DROP` destroys it at the first commit; a SQL editor over a pooled
connection promises neither. The migration was relying on something the place it
runs does not offer. It is rewritten with no temp table, no transaction block and
no session setting: **every statement stands alone**, the one real dependency is
stated as an order (the event update runs before the lead update, because it
finds its events through the leads that update is about to change), and every
predicate matches nothing once it has run. Golden case
`a-migration-that-needs-a-session`.

I cannot say from here which statement raised the error and the honest version is
that the data settles what matters while the mechanism is inference.

## 6a. WHAT IT WAS, AS PRINTED

`agents/scraper/migrations/050_correct_local_midnight_dates.sql`. Standing rule
5: it is printed for Philip to run and nothing here runs it.

```
  leads.published_date          1,204 rows   +7h
  project_events.occurred_at    1,018 rows   +7h   (768 by lead, 250 project-dated)
  projects.last_activity          319 rows   +7h
  leads.deadline                      0 rows
```

**The source list in the predicate is not decoration.** The single
`leads.deadline` value at 17:00:00Z belongs to a TED notice, and TED publishes an
explicit `+00:00`, so five in the afternoon UTC is what the publisher said. A
clock-only predicate would have corrupted a real deadline. It is excluded by
source and stays as it is.

**Both tables move in one act** because `project_events` dedupes on an identity
that includes `occurred_at`: correct a lead date without correcting the event it
already produced and the next event pass inserts a second event for the same
filing, one day apart, and a client document prints both.

The file pins the session timezone, requires an explicit `Z` on the stored text
before touching it, states its expected row counts, is safe to run twice, and
ends with a read-back block including one human-readable spot check: Anaheim's
Planning Commission met on Monday 15 December 2025, and every corrected Anaheim
row for that week should read 2025-12-15.

## 7. FOUND, NOT ASKED ABOUT

1. **Three `record_attached` events dated 2026-12-31T17:00:00Z** whose lead is
   published 2026-01-01. Their date does not come from their lead and nothing in
   the corpus says where it does come from. They are future-dated as well. The
   migration leaves them alone and names them rather than sweeping them along.
2. **`toIso` cannot be correct for all its callers and has no way to be told.**
   It serves free text, naive ISO, slashed dates with a bare clock, and
   genuinely zone-bearing feeds, and it erases the distinction at the boundary.
   `sourceIso` makes it answer consistently, but 14 adapters remain whose
   published shape nobody in this repo has ever pinned - Careerjet, Jooble,
   Adzuna, CanadaBuys, CDB, ADB, NEPA, CONFOTUR, TexasESBD among them. Each is
   one raw response away from being settled and none of them feeds a covered
   market today.
3. **UNGM deliberately strips the one zone its source states.** `ungm.ts:33`
   removes `(GMT 2.00)` before parsing. It is now read as UTC rather than as the
   runtime's zone, which is better and is still not what the source said.
4. **Legistar's `MatterAgendaDate` can be in the future** and `latestIso` takes
   the maximum, so a matter introduced on 2026-09-09 with an agenda date of
   2026-11-03 is stored as 2026-11-03. That is a separate question from this one
   and it is the reason a future-dated filing can exist at all.
