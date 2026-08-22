# Adding a market

Written from adding New York City on 2026-08-08, which took a day and ended in
a decision **not** to add it as a covered market - and revised on 2026-08-09,
when that decision turned out to be wrong. New York City IS coverable, on three
bulk datasets nobody had probed, and the first attempt missed them because it
asked whether the portal could be scraped instead of where the jurisdiction
publishes. Both versions are kept below, because the mistake is more instructive
than the fix: see step 2c.

A runbook written from Nashville alone would say market onboarding takes four
minutes, and would be wrong about most of the remaining fifteen.

## The two-tier answer

| | Legistar market | portal market |
|---|---|---|
| example | Nashville, Oakland | New York City, Las Vegas, Anaheim |
| files changed | **2** | **6** |
| lines changed | **~2** | **~240** |
| elapsed | **~4 minutes** | **1 to 2 days** |
| new risk | none | gate vocabulary, clustering, market modelling |

The four-minute number is real and it is not the common case. It holds only when
the jurisdiction is on the public Legistar Web API, because then the adapter,
the gate, the geography resolution, the run-scope filter, the clustering rules
and the health monitor already exist and the market is genuinely configuration.

**Assume portal-market cost until the probe proves otherwise.** The probe is
one HTTP request and it is the highest-leverage four seconds in this process.

---

## Step 1: probe before you decide anything

Never write a config row before this returns 200.

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  "https://webapi.legistar.com/v1/{code}/Bodies"
```

Try plausible codes: the city name, the city name with the state, the county
name, the abbreviation. Known good: `clark`, `miamidade`, `phoenix`,
`nashville`, `sanantonio`, `oakland`.

**Read the failure, do not just count it.** The two failures mean different
things and only one of them is worth more attempts:

| response | meaning | next |
|---|---|---|
| **200** | live public API | Tier 1, go to step 2 |
| **500** with `LegistarConnectionString setting is not set up` | that client code does not exist | try other codes |
| **403** with an empty body | the code exists and the API is **closed** | stop. No code will work. |

New York City returns 403 on `nyc`. Fifteen other codes returned 500. That 403
is the whole answer and it took one request to get; the other fifteen were
confirmation, not discovery.

## Step 2: probe freshness, always, even on a 200

**A live endpoint is not a live source.** This is the step that would have been
skipped, and it is the one that killed NYC.

For any candidate source, ask for the newest record it holds and compare it to
today:

```bash
# Socrata example. READ STEP 2b BEFORE COPYING THIS: the column matters more
# than the query, and this exact example is the wrong column for ZAP.
curl -s "https://data.cityofnewyork.us/resource/{id}.json?\$select=max(app_filed_date)"
```

**Rule: if the newest record is more than 45 days old, the source cannot feed a
monthly report.** ZAP's newest filing was 110 days old, and still is: measured
again on 2026-08-09 it was 107 days stale, so the original reading was right.
A market whose only entitlement source is that stale must not be sold as
covered on that layer, however easy the adapter is - but see step 2c before
concluding the MARKET is closed, because ZAP was not New York's only source.

Record the numbers in `docs/COVERAGE-MAP.md` with the probe date, so the next
person can tell a stale source from an unchecked one.

## Step 3: decide the market string

**One decision, and it is a data migration if you get it wrong.**

A market is what a client SELECTS in the intake form. `client_scopes.markets`
holds strings a person ticks. So the question is not "what is the correct
geographic unit" but "what would a client ask to be covered for".

New York City is the hard case: five boroughs, and Manhattan and Staten Island
are not one property market by any professional reading. It is still **one
market**, because a scope naming "New York City" must not match nothing while
five borough scopes match everything. The fold is recorded in
`lib/geography.ts` MARKET_ALIASES with the reasoning, not left to be inferred.

Check what the corpus already holds before choosing. NYC records had arrived
under three different market strings before anyone looked.

## Step 4: Tier 1, the config row

Two files.

1. `agents/scraper/sources/legistar.ts` -> one entry in `DEFAULT_JURISDICTIONS`:
   ```ts
   { client: 'nashville', jurisdictionLabel: 'Nashville, TN',
     reason: 'East Bank redevelopment, stadium district, hotel boom; proven producer.' },
   ```
   The `reason` is not decoration. The jurisdiction criteria are documented above
   that array: real development in motion, a market GLI can work in, and machine
   readable records. A row without a reason is a market nobody can later defend.

2. `lib/geography.ts` -> one entry in `CONFIGURED_JURISDICTIONS`:
   ```ts
   nashville: { region: 'Tennessee', market: 'Nashville' },
   ```

Then go to step 6.

## Step 5: Tier 2, the portal adapter

Six files. Benchmarks: `sources/sfwmd.ts` is 125 lines, `sources/ceqanet.ts` is
244.

| file | change | lines |
|---|---|---|
| `agents/scraper/sources/{market}.ts` | new adapter: paging, date filter, map to `NormalizedLead`, build a per-record public URL, dates through `deriveLeadDates` | 150-200 |
| `agents/scraper/government.ts` | one entry in the `ADAPTERS` array with its market list | ~5 |
| `lib/geography.ts` | jurisdiction and any aliases | ~8 |
| `agents/scraper/cluster.ts` | an identity rule for the market's record numbering, like the Nashville metro-number rule | ~15 |
| `lib/taxonomy.ts` | gate vocabulary, if the market's filings use language the gate has not seen | ~10 |
| `docs/COVERAGE-MAP.md` | the market's row and its gaps | ~15 |

**Every record must carry a URL a client can open.** If the portal has no
per-record public page, the adapter is not finished, because a RECORD line with
no link fails the provenance gate at generation time.

## Step 6: run scoped, and only scoped

```bash
npm run scrape:government -- --market="New York City"
```

The run report must open with its scope and name the adapters it skipped:

```
SCOPE: PARTIAL RUN (pipeline=all; markets=New York City; sources=all)
  adapters in scope: (none)
  adapters skipped:  legistar, govdocs, cftod-pdf, anaheim-agendas, ...
```

**`DRY_RUN=1` DOES NOTHING IN THIS LANE.** It is read by `orchestrator.ts`, which
is the Serper lane, and by nothing in `government.ts`. This page told you to use
it for the first run of a new market, and the first run of a new market is a
GOVERNMENT run, so the safety net was documented in the one lane that does not
have it. Measured 2026-08-22 adding Broward County: `DRY_RUN=1 npm run
scrape:government -- --market="Broward County"` printed a scope banner, said
"92 gate-admitted | 92 inserted", and wrote all 92 rows. Same shape as
`scrape:all` not being every source.

So the first run is protected by SCOPE, not by a dry-run flag. Read the scope
banner before you let it finish:

```
SCOPE: PARTIAL RUN (pipeline=all; markets=Broward County; sources=all)
  adapters in scope: legistar
  adapters skipped:  govdocs, cftod-pdf, anaheim-agendas, ...
```

If the market string does not match, nothing is in scope and nothing is written.
Take a `corpus:snapshot --label pre-<market>` first either way, because that is
what makes step 7 possible and it is the only thing that makes a misaimed run
reversible by knowing what changed.

AND THE FIRST RUN NEEDS `LEGISTAR_BACKFILL=1` OR `--backfill`. A cold
jurisdiction does not backfill by derivation - the cursor is fixed and the run
goes incremental, which on Broward fetched 45 matters since 2026-07-20 and wrote
nothing. With the flag it fetched 1,006 over 6 pages.

## Step 7: prove isolation with numbers

Capture per-market, per-source and per-stream counts **before** the run, and
diff them after. The claim is not "the run was scoped"; the claim is "every
other market's count is identical", and only a table shows that.

Adding NYC moved three market counts and nothing else: `Manhattan` 1 -> 0,
`Queens` 1 -> 0, `New York City` 3 -> 5, from the deliberate borough fold. Net
NYC 5 -> 5, no record created or destroyed. The other 18 tracked markets and all
12 sources were byte-identical.

## Step 8: what a new market can break downstream

Do not skip these because the adapter worked.

- **The gate.** A new market's vocabulary moves precision and recall. Re-measure.
- **Clustering.** New record numbering can merge unrelated filings. Check the
  acceptance clusters still pass.
- **The market string in client scopes.** A market added after a client's scope
  was written is not in that scope. It does not appear in their reports until
  someone ticks it.
- **The coverage map.** A market with an adapter is not a covered market. Say
  which layers it reaches.

## The honest range

- **Legistar market, live and fresh:** 2 files, 2 lines, 4 minutes.
- **Portal market, live and fresh:** 6 files, ~240 lines, 1-2 days.
- **Market whose sources are stale or closed:** a day of probing, and the right
  answer is often not to add it. That is a successful outcome, not a failed one.
  It cost a day to learn that about market eleven instead of finding out from a
  client asking why their New York section was empty.

---

## Step 2b: a staleness reading is only as good as the column it was taken on

Added 2026-08-09, after New York City was reopened and turned out to be three
quarters live.

Step 2 above says to probe freshness and gives a Socrata example that reads
`max(app_filed_date)`. That example is **wrong for ZAP**, and following it
produced two opposite errors on the same source four months apart.

**Socrata does not fail loudly on a bad column in every client.** Ask for a
column that does not exist and the API answers:

```
{"errorCode":"query.soql.no-such-column","message":"No such column: last_milestone_date"}
```

with an HTTP status that a `curl -w '%{http_code}'` probe reports as success.
Read as a freshness number by something that did not check the body, a
non-existent column made a 107-day-stale source look 6 days fresh.

The reverse error is just as easy. `app_filed_date` **does** exist on ZAP, and
it is populated on 1,409 of 32,931 rows - 4%. A `$where` on it captures almost
nothing, and a `max()` on it describes 4% of the dataset.

**So the probe is two questions, not one:**

```bash
# 1. Which columns actually exist?
curl -s "https://data.cityofnewyork.us/api/views/{id}.json" | jq '[.columns[].fieldName]'

# 2. For each date column: how many rows actually have it, and what is the max?
curl -s "https://data.cityofnewyork.us/resource/{id}.json?\$select=count(*),count(col),max(col)"
```

A `max()` over a sparsely populated column is not a freshness measurement. On
ZAP the answer split three ways:

| column | populated | role |
|---|---|---|
| `certified_referred` | 97% | the **record date** - the only column that can date the corpus |
| `current_milestone_date` | 6% | the **incremental cursor** - the only column that ADVANCES |
| `app_filed_date` | 4% | neither |

Low population is not automatically a defect. `current_milestone_date` is at 6%
*because* it is populated for the projects still moving, which is exactly the
set an incremental run wants. Ask what a column MEANS before judging its
coverage.

**And check the dataset's own clock, not just its contents.** The decisive
evidence that ZAP was frozen rather than quiet was not a content date at all:

```bash
curl -s ".../api/views/{id}.json" | jq '.rowsUpdatedAt, .metadata.custom_fields.Update'
```

`rowsUpdatedAt` was 2026-05-26 against a declared **monthly automated** update -
two missed cycles - and the companion ZAP-BBL dataset stopped the same day three
minutes earlier. One publisher, one pipeline, one failure. Content dates tell
you how old the newest record is; the dataset clock tells you whether anyone is
still feeding it.

## Step 2c: the portal being closed does not mean the market is closed

This is the lesson the first New York attempt got backwards, and it cost a
market for four months.

That attempt probed the two things a person thinks of first - the council API
and the public-facing portal - found a 403 and a JavaScript application, and
concluded New York City could not be covered. Both findings were correct. The
conclusion did not follow.

- `webapi.legistar.com/v1/nyc/Bodies` -> 403. Still true. Still no council.
- `zap.planning.nyc.gov` -> a JavaScript SPA with no reachable API. Still true.
- **The same data, published as bulk open data, was live the whole time.**

New York City was ultimately covered by three Socrata datasets, two of them
refreshed within 48 hours, and none of them was the portal anyone had looked at.
The environmental review layer (15,362 CEQR projects, shipping its own
per-project URL) and the legal notice layer (1.1M City Record rows, carrying
hearing dates) were never probed at all, because the first probe answered "can
we scrape the portal?" instead of "where does this jurisdiction publish?"

**So the probe order is: bulk data, then API, then portal.**

```bash
# The catalogue search that should come FIRST for any US city.
curl -s "https://api.us.socrata.com/api/catalog/v1?domains={data-portal-host}&q=zoning&limit=15"
curl -s "https://api.us.socrata.com/api/catalog/v1?domains={data-portal-host}&q=environmental&limit=15"
curl -s "https://api.us.socrata.com/api/catalog/v1?domains={data-portal-host}&q=hearing&limit=15"
```

**Do not trust a dataset id you were given; look it up.** Two of the three ids
this market was described by did not exist (`7mgc-yumh` and `fkig-eyar` both
return `dataset.missing`); the real ones were `dg92-zbpx` and `gezn-7mgk`, and
the catalogue search found them in one request. The row counts were wrong too -
CEQR was described as 2,241 rows and is 15,362.

**Verify every number you are handed before building on it.** Of five claims
about this market, four were wrong: two dead dataset ids, a non-existent column,
a population figure off by 176x, and a freshness reading inverted. The one that
was right - "the council API is closed" - was the one already recorded here from
a previous probe.

## Step 5b: a portal market may need TWO date columns and a second dataset

Two shapes appeared in New York that step 5 does not anticipate, and both are
common enough to expect elsewhere:

**The cursor and the record date can be different columns.** See step 2b. Write
down which is which in the adapter, because the next reader will assume there is
one date.

**The dates may not be in the dataset at all.** NYC's CEQR Projects table has
six columns and none is a date; the dates live in a separate milestone dataset
keyed by project number. Fetch the second dataset ONCE per run and join in
memory - the alternative is one request per project, which for 15,362 projects
is a lookup rebuilt fifteen thousand times.

**Apply the date window BEFORE the gate, not after.** Both orders capture the
same records, so this looks like a style choice, and it is not. `gateDecide`
records every candidate it judges into the audit corpus, and that corpus is the
denominator gate precision and recall are measured on. Gating a twenty-year
archive and then discarding it puts records into the corpus that the system
never considered - CEQR alone contributed 15,362 candidates that way, more than
every other government source combined, which would have made the pooled gate
numbers a measurement of CEQR. Windowing first cut it to 1,350.

## Step 6b: run the new adapters alone first, then in the lane

A Socrata source that works perfectly alone can contribute **zero** inside a
concurrent run, silently. Measured here: the City Record adapter fetches 2,342
rows on its own and produced zero candidates in the gate harvest alongside two
other Socrata adapters - no exception, no rejected promise, and nothing in the
per-source table, because a source that produces nothing does not get a row in
it. Keyless Socrata throttles per host.

Two fixes, both now in the repo, and the second matters more:

1. `sources/socrata.ts` retries a failed page with backoff.
2. `gate-harvest.ts` lists the sources it EXPECTS and names any that returned
   zero. **An absent row is not a zero, and only an expectation makes it one.**

## Step 8b: what a new market can break, one more entry

- **The geography resolver.** A new market's place names are new INPUTS to
  `resolveGeography`, and its pattern branches overlap. "Bronx" resolved to
  **Brazil**: the NUTS region-code pattern is two letters plus one to four
  alphanumerics, "BRONX" satisfies it, and the BR prefix won before the
  configured-jurisdiction table was consulted. 17 records were stored in South
  America.

  It was caught only by step 7's count diff - 325 records written, the market
  count up by 308 - which is the single strongest argument for doing step 7 with
  a table rather than by eye. `npm run verify:geography` now pins it, and
  `npm run corpus:snapshot` produces the before/after step 7 asks for.
