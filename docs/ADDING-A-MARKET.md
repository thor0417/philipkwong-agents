# Adding a market

Written from adding New York City on 2026-08-08, which took a day and ended in
a decision **not** to add it as a covered market. That is the useful version of
this document. A runbook written from Nashville alone would say market
onboarding takes four minutes, and would be wrong about most of the remaining
fifteen.

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
# Socrata example
curl -s "https://data.cityofnewyork.us/resource/{id}.json?\$select=max(app_filed_date)"
```

**Rule: if the newest record is more than 45 days old, the source cannot feed a
monthly report.** ZAP's newest filing was 110 days old. A market whose only
entitlement source is that stale must not be added as a covered market, however
easy the adapter would be.

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

Use `DRY_RUN=1` for the first run. It skips Haiku scoring and all writes, so a
misaimed scope costs nothing.

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
