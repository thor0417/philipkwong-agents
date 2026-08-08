# Coverage map

What each market is actually covered on, and what it is not.

**This document exists because a market name on a client's cover page is a
claim.** A report scoped to New York City implies we are watching New York City.
If what we are watching is five trade-press headlines, the client has been told
something untrue by omission, and they will not find out until they ask about a
rezoning we never saw. So every market here carries the layers it is covered on
AND the layers it is not, and the second list is the load-bearing one.

Layers, from the eight-layer blueprint:

| # | layer | what it is |
|---|---|---|
| 1 | Legislative agendas | council / commission agendas and matters |
| 2 | Entitlement filings | rezonings, use permits, plan amendments |
| 3 | Environmental review | CEQA / CEQR / NEPA documents |
| 4 | Utility permits | building, water, power |
| 5 | Aviation | airport authority capital work |
| 6 | Special regulators | gaming boards, landmarks, districts |
| 7 | Capital plans | agency capital budgets |
| 8 | Bond issuances | financing that precedes construction |

`FULL` = a machine-readable source is captured on a schedule.
`PARTIAL` = captured but known to be incomplete.
`PRESS ONLY` = the intelligence lane sees it; no filing is captured.
`NONE` = not captured.

---

## The ten covered markets

These are the markets a government-lane adapter is pointed at. Layer coverage
below is stated at the level the adapters actually reach, which for most markets
is layers 1 and 2 with some of 3.

| market | region | legislative | entitlement | env review | source |
|---|---|---|---|---|---|
| Clark County | Nevada | FULL | FULL | NONE | `legistar` (clark), `clark-tab` |
| Las Vegas | Nevada | FULL | FULL | NONE | `agenda-portal` (PrimeGov) |
| Anaheim | California | FULL | FULL | PARTIAL | `agenda-portal`, `ceqanet` |
| Phoenix | Arizona | FULL | FULL | NONE | `legistar` (phoenix) |
| Nashville | Tennessee | FULL | FULL | NONE | `legistar` (nashville) |
| San Antonio | Texas | FULL | FULL | NONE | `legistar` (sanantonio) |
| Oakland | California | FULL | FULL | PARTIAL | `legistar` (oakland), `ceqanet` |
| Miami-Dade County | Florida | FULL | FULL | NONE | `legistar` (miamidade) |
| South Florida | Florida | NONE | PARTIAL | NONE | `sfwmd` (water permits, layer 4) |
| Central Florida Tourism Oversight District | Florida | FULL | FULL | NONE | `cftod-pdf` |
| Yonkers | New York | FULL | FULL | NONE | `legistar` (yonkersny) |
| Westchester County | New York | FULL | FULL | NONE | `legistar` (westchestercountyny) |

Layers 5 through 8 are **NONE in every market**. No aviation, special-regulator,
capital-plan or bond source is captured anywhere. That is a system-wide gap, not
a per-market one, and it is stated once here rather than repeated in ten rows.

---

## New York City - PRESS ONLY

**Added:** 2026-08-08. **Status: intelligence lane only. Not a covered market.**

| layer | status | why |
|---|---|---|
| 1 Legislative agendas | **NONE** | NYC Council is not on the public Legistar Web API |
| 2 Entitlement filings | **NONE** | ZAP exists and is machine-readable but is ~3.5 months stale |
| 3 Environmental review | **NONE** | CEQR rides inside ZAP; inherits the same lag |
| 4 Utility permits | **NONE** | DOB NOW is live but is not captured, and is low-signal |
| 5-8 | **NONE** | as everywhere |

**What we do have:** 5 records in the corpus, all `gli_serper`, all
`stream=intelligence`. Trade press about Resorts World, Willets Point, the USS
housing project. No filing, no hearing date, no applicant from a public record.

### The council gap, measured 2026-08-08

`webapi.legistar.com/v1/{code}/Bodies`, the endpoint every other Legistar market
answers 200 on:

- `nyc` and `NYC` -> **HTTP 403, empty body**, on every endpoint tried (Bodies,
  Matters, Events, BodyTypes, MatterTypes, MatterStatuses) and with every header
  variation (Accept json/xml, Referer, Origin, no User-Agent). The client code
  exists in InSite; its Web API is deliberately closed.
- 12 other codes (`newyorkcity`, `nyccouncil`, `council`, `newyork`, `nycc`,
  `ny`, `nyccl`, `nycouncil`, `newyorkcitycouncil`, `nyc-council`, `nycny`,
  `cityofnewyork`, `nycgov`, `councilnyc`, `nyccouncilny`) -> **HTTP 500**,
  `LegistarConnectionString setting is not set up in InSite for client: X`.
  Those codes do not exist.
- `legistar.council.nyc.gov` serves HTML (200) and advertises **zero** feed or
  API links across 96 KB of Legislation.aspx and 911 KB of Calendar.aspx.
- `Feed.ashx` returns HTTP 200 with a single `<item>` titled **"Invalid feed"**,
  or HTTP 410 Gone, depending on the mode parameter.
- NYC Open Data `6ctv-n46c` "City Council Legislation" is 11,622 rows but was
  **last updated 2025-03-27** and is citywide legislation, not land use.

**There is no council record to configure.** A Legistar config row for NYC would
add a jurisdiction that returns 403 on every fetch: zero records, a permanent
dead-source alarm, and the market's name on a coverage map backed by nothing.

### The ULURP gap

The entitlement layer for NYC is ULURP, exposed as **ZAP (`hgx4-8ukb`)** on NYC
Open Data. It is genuinely good data - 32,931 rows, named applicants, ULURP and
CEQR numbers, per-project public URLs - and it is **stale**:

| measure | value (probed 2026-08-08) |
|---|---|
| portal `rowsUpdatedAt` | 2026-05-26 |
| max `app_filed_date` | 2026-04-20 |
| max `current_milestone_date` | 2026-04-24 |
| rows with a milestone after 2026-06-01 | **0** |
| rows filed in July 2026 or later | **0** |

A July 2026 report would have received nothing from it.

### What this means for a client scope

`New York City` is selectable in the intake form and resolves correctly
(country United States, region New York, market New York City). **A scope that
selects it is buying press coverage, not filings.** Say so in writing before a
client's scope includes it.

### Re-check condition

Re-probe ZAP freshness monthly. If `max(app_filed_date)` moves inside 45 days of
today, the entitlement layer becomes viable and NYC can be promoted to PARTIAL
with the ~200-line adapter described in `docs/ADDING-A-MARKET.md`. The council
layer has no re-check condition: it will not open without Legistar granting API
access, which is a procurement question, not an engineering one.

---

## Downstate New York, added 2026-08-08

The NYC test found the city closed. It did not look outside the city limits, and
the two largest projects in the live downstate casino cycle are out there:
**MGM Empire City in Yonkers** and **Sands at Nassau Coliseum in Uniondale**.
A market named New York City would have missed both, the same way a market named
Las Vegas misses the Strip.

### Yonkers, NY - ADDED (`yonkersny`)

Legistar live. 274 matters in twelve months, **28 matching leisure or
entitlement vocabulary**, including `RES.123-2025 RESOLUTION - APPROVING
COMMUNITY BENEFITS AGREEMENT WITH MGM YONKERS, INC.`

**STATED GAP: the newest matter is 2026-06-12, 57 days old at the time of
probing, which fails the runbook's 45-day rule.** Monthly volume was 46 in May
and 18 in June, then nothing in July, and December was similarly thin at 5. That
pattern reads as a council in summer recess rather than a dead feed, which is a
different thing from a stale dataset: the source is live, the body is not
sitting. It is added on that reading, and the reading is written down here so it
can be checked rather than assumed.

**Re-check condition:** if no Yonkers matter appears with an intro date after
2026-09-15, the recess explanation is wrong and the jurisdiction should be
treated as degraded.

### Westchester County, NY - ADDED (`westchestercountyny`)

Legistar live and current: 560 matters in twelve months, newest 10 days old.
**Low yield - only 3 of 560 match leisure or entitlement vocabulary** - and
added anyway because the county owns **Rye Playland**, a county-run amusement
park, and a Legistar config row costs two lines. The first records captured are
capital budget and bond acts for `Ice Casino Improvements II`, which is the
historic ice rink building at Playland.

### Nassau County, NY - PROBED AND REJECTED 2026-08-08

Do not re-probe blindly before 2027-02.

| probe | result |
|---|---|
| Legistar `nassau`, `nassaucounty`, `nassaucountyny`, `nassauny` | **500** on all four: the code does not exist |
| Granicus `nassaucountyny.granicus.com` | **404 Page not found** |
| CivicClerk `nassaucountyny.portal.civicclerk.com` | 200 - **and so does `zzznotarealjurisdiction.portal.civicclerk.com`**. The portal is a wildcard SPA shell, so the 200 means nothing. Its API answers 404. |
| NovusAgenda `nassaucountyny.novusagenda.com` | 200, a real NovusAGENDA shell, contents not verified |
| `www.nassaucountyny.gov` | **connection timeout** from this runtime, repeatedly |
| Socrata `data.nassaucountyny.gov` | 404, no portal |

The county's own website is unreachable from here, so even the manual tier is
not available. **Sands at Nassau Coliseum is therefore uncovered**, and that is
the single largest known gap in the downstate picture.

---

## Layer 6, special regulators: NONE in every market

Probed 2026-08-08. A licence application often precedes the land use filing, so
this is an earlier signal than anything currently captured. Nothing here is
built.

### Nevada Gaming Control Board and Commission - VIABLE, best value

`https://www.gaming.nv.gov/about-us/agendas-and-dispositions-minutes/` returns
200, 81 KB, **134 PDF links**, current: `august-2026-gcb-agenda.pdf` and
`july-2026-ngc-agenda.pdf` are both present. Static PDF links on a plain HTML
index, which is the exact shape `sources/pdf-agenda.ts` and `sources/govdocs.ts`
already handle.

No API. `wp-json` is 404, and the `/about/meetings/` page carries only six
links. The agenda index is the way in.

**Cost: 6 to 8 hours** - a new adapter reusing the PDF agenda parser, plus gate
vocabulary for licensing language. **Highest value per hour of anything probed
in this amendment.**

### New York State Gaming Commission and Facility Location Board - BLOCKED

`gaming.ny.gov` and `dos.ny.gov` both return **403 with a Cloudflare "Just a
moment..." interstitial**, on every path tried, with and without `www`. NY State
Socrata carries lottery results, not licensing.

The downstate licensing decisions live here rather than in any municipal record,
so this is the source that would complete the New York picture, and it is not
reachable programmatically from this runtime. **Manual tier, or a headless
browser.** Do not attempt an adapter.

### Nevada ride safety permitting - NOT LOCATED

`dir.nv.gov/OSHA/Home/` and `/OSHA/Mechanical_Compliance/` both return 200 with
a **zero-byte body**, which means JS-rendered or blocked. The agency holding
amusement ride permits was not confirmed. An amusement ride permit is as direct
a signal as this vertical has, so this is worth a second look with a browser
before it is written off. **Not costed; the source was not found.**

### Liquor licensing - ALREADY CAPTURED, NO ADAPTER NEEDED

This one answered itself. The corpus already holds **10 liquor licence records,
all from Phoenix Legistar**, and every one of them is a hotel or an arena:

    Liquor License - AC Hotel By Marriott City North and Element Hotel City North
    Liquor License - Fire N Ice Arena - District 2
    Liquor License - Aloft Hotel Phoenix Airport - District 8

Clark County's liquor board also files through `clark.legistar.com`, which is
already ingested. So liquor licensing is not a new source: it arrives inside the
Legistar lanes already running.

**And the flooding question answers itself too.** Every restaurant in the county
does file, and none of them are in the corpus, because the gate requires a venue
noun. `hotel`, `arena` and `resort` are STRONG terms; a taqueria's liquor licence
matches nothing and is dropped. The filter is already in place and already
working. **Cost: zero. Nothing to build.**
