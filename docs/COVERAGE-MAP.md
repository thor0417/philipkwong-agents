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

## The covered markets

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
| New York City | New York | NONE | **STALE** | FULL | `nyc-zap`, `nyc-ceqr`, `nyc-city-record` |
| Yonkers | New York | FULL | FULL | NONE | `legistar` (yonkersny) |
| Westchester County | New York | FULL | FULL | NONE | `legistar` (westchestercountyny) |

Layers 5 through 8 are **NONE in every market**. No aviation, special-regulator,
capital-plan or bond source is captured anywhere. That is a system-wide gap, not
a per-market one, and it is stated once here rather than repeated in ten rows.

---

## New York City - COVERED, with the entitlement layer stale

**Added:** 2026-08-08 as press-only. **Promoted 2026-08-09** on three Socrata
sources. **Status: covered on environmental review and legal notices; the
entitlement layer is captured but frozen.**

| layer | status | source | why |
|---|---|---|---|
| 1 Legislative agendas | **NONE** | - | NYC Council is not on the public Legistar Web API. 403, evidence below. |
| 2 Entitlement filings | **STALE** | `nyc-zap` | ZAP captured in full, but DCP stopped publishing 2026-05-26 |
| 3 Environmental review | **FULL** | `nyc-ceqr` | CEQR Projects + Milestones, refreshed daily |
| 6 Special regulators | **PARTIAL** | `nyc-city-record` | BSA, Landmarks, City Planning Commission and FCRC hearing notices |
| 4, 5, 7, 8 | **NONE** | - | as everywhere |

> **STATE THIS IN ANY COVERAGE CLAIM FOR NEW YORK CITY.** Layer 1 being NONE is
> not a formality. A City Council approval reaches us only if the City Record
> happens to publish a notice we match, and it frequently does not.
>
> The measured instance, 2026-08-12: the Council approved the Western Rail Yard
> financing in June 2025, roughly $2bn for the platform, and **we hold no record
> of it**. Our newest Western Rail Yard record is the CEQR text of 2025-05-30,
> which still describes the withdrawn Wynn gaming facility. June 2025 produced
> 12 NYC government records across all three sources and none concerned Hudson
> Yards. The project's current brand, "Hudson Yards West", appears in **zero of
> 1,695 corpus records**.
>
> So for New York City we can say what was filed and what was reviewed. **We
> cannot say what was approved.** Any claim of New York coverage that does not
> carry that sentence is overstating what this system knows.

**What we have:** 330 records and 178 projects, up from 5 press records.

| source | dataset | fetched | written | freshness (probed 2026-08-09) |
|---|---|---|---|---|
| `nyc-zap` | `hgx4-8ukb` | 860 | 88 | **107 days stale** |
| `nyc-city-record` | `dg92-zbpx` | 2,342 | 123 | 4 days |
| `nyc-ceqr` | `gezn-7mgk` + `8fj8-3sgg` | 15,362 | 114 | 2 days |

70 of the 114 CEQR projects cross-reference a ZAP application on the CEQR
number, so the environmental and entitlement layers join into one project
rather than running beside each other.

### The entitlement layer is captured and frozen, and that is not the same as covered

ZAP is ingested as a **historical entitlement backbone**, not as live coverage.
It is the only source of applicant names, borough, and the `ulurp_numbers` to
`ceqr_number` link, and it is 107 days stale.

| measure | value (probed 2026-08-09) |
|---|---|
| dataset `rowsUpdatedAt` | 2026-05-26 (75 days before the probe) |
| newest `current_milestone_date` | 2026-04-24 |
| rows filed in the last 90 days | **0** |
| rows with a milestone in the last 90 days | **0** |
| declared update frequency | **Monthly, automated** |

**Why it stopped: no stated reason and no successor.** DCP's metadata still
declares a monthly automated feed, names no replacement, and the companion
ZAP-BBL dataset (`2iga-a6mk`) froze the same day three minutes earlier. That is
the signature of a stalled automated job, not a supersession. There is no
replacement feed: both "ULURP Recommendations" datasets are abandoned (88 and 91
rows, last touched 2017 and 2021), and `zap.planning.nyc.gov` is a JavaScript
application with no reachable public API from this runtime. The dataset version
stamp is `20260427`, published 2026-05-26, which is one on-schedule monthly run
followed by two missed ones.

**Re-check condition:** re-probe `max(current_milestone_date)` monthly. If it
moves inside 45 days of today, the entitlement layer becomes live and this row
becomes FULL with no code change - the incremental cursor is already wired.
Worth an email to `zap_feedback_dl@planning.nyc.gov`.

### Measuring staleness on the wrong column

The earlier probe reported ZAP as 110 days stale and was **correct**. A later
reading claimed the source was 6 days fresh, measured on `last_milestone_date` -
a column that does not exist. The query returns `query.soql.no-such-column`, and
read as a freshness figure it made a frozen source look live.

Column population over all 32,931 rows:

| column | populated | share |
|---|---|---|
| `certified_referred` | 32,017 | 97% |
| `completed_date` | 29,882 | 91% |
| `current_milestone_date` | 2,069 | 6% |
| `app_filed_date` | 1,409 | 4% |

`current_milestone_date` is the incremental **cursor** (the only column that
advances as a project moves through review). `certified_referred` is the
**record date** (the only column populated enough to date the corpus).
`app_filed_date` is neither: set once at filing, populated on 4% of rows, so a
`$where` on it captures almost nothing.

### The hearing-date question, answered

The City Record is the only New York source carrying a hearing date, so it
decides whether a forward calendar screen is buildable.

- 2,027 of 2,342 land use notices (87%) carry an `event_date`.
- **13 carry one still in the future**, all in Public Hearings and Meetings.
- **0** carry a future `due_date`.

13 is not a small number because the source is thin; it is the steady-state size
of a two-week rolling window. Over the last twelve months, 532 notices carry
both a publication and a hearing date, **100% were published before the
hearing**, median lead **13 days**, and 387 of 532 had at least 7 days. So the
calendar IS buildable and would hold roughly 13 to 25 items at any moment,
refreshed daily. Bodies on it today: City Planning Commission, Board of
Standards and Appeals, Landmarks Preservation Commission, Franchise and
Concession Review Committee, and DCAS property acquisitions.

### What Property Disposition names

It names the **agency and the site, not a buyer**. A disposition notice is
published before a counterparty is selected ("FOR ACQUISITION - portions of
Block 3264, Lot 20"), so there is no named buyer to capture at this stage; the
buyer appears later in the procurement award stream, which this adapter
excludes. These rows are a site-level early signal - block and lot identify a
parcel years before an entitlement - but the "city land sale with a named buyer"
shape does not exist at disposition time.

### The council gap, measured 2026-08-08, unchanged

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

**There is no council record to configure.** It will not open without Legistar
granting API access, which is a procurement question, not an engineering one.

### What this means for a client scope

`New York City` is selectable and resolves correctly (United States / New York /
New York City). A scope selecting it now buys **environmental review and hearing
notices as they happen, plus entitlement filings up to April 2026**. Say the
April cutoff in writing.

### The boroughs are one market

Unchanged, and now load-bearing: `nyc-zap` and `nyc-ceqr` both carry a `borough`
column and both fold it to `New York City` through `lib/geography`. No
borough-level market is created. CEQR's 523 `Upstate` rows - city watershed
property in the Catskill and Delaware systems - are excluded rather than folded,
because they are city agency actions outside the five boroughs.

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

---

## Central Florida and Miami, probed 2026-08-14 - ALL FIVE NEED ADAPTER WORK

Florida coverage today is **Disney only**: CFTOD governs Walt Disney World and
the SFWMD permits in Lake Buena Vista are Disney's land. Universal Epic
Universe, the I-Drive hotel corridor, SeaWorld and the Orange County Convention
Center district are invisible, in the busiest theme-park corridor in the world.
Miami has the same shape one layer down: Miami-Dade County is configured, but
the county handles the airport, seaport, transit and unincorporated land, while
hospitality files with the City of Miami and Miami Beach.

Five jurisdictions were probed against every platform this repo can read. **None
is a config row. Every one is adapter work**, and the work differs per market.

| jurisdiction | platform | evidence | config row? |
|---|---|---|---|
| Orange County, FL | none identified | not on Legistar (7 code variants, all HTTP 500); no Granicus, PrimeGov, IQM2, CivicClerk, CivicWeb or NovusAgenda instance answers. `apps.ocfl.net/agenda/` returns the same 7,420-byte shell for every path, so it is a JS application | **no** - adapter work, and the platform is not yet known |
| City of Orlando, FL | **NovusAgenda** | `orlando.novusagenda.com` is live and real (79 KB listing, meeting ids resolve) | **no** - no NovusAgenda adapter exists |
| Osceola County, FL | none identified | not on Legistar, Granicus, NovusAgenda, IQM2, CivicWeb or CivicClerk under any code tried. The `granicus` strings on osceola.org are the OpenCities **website** product, not an agenda system | **no** - adapter work, platform unknown |
| City of Miami, FL | **Granicus** | `miamifl.granicus.com` view_id=1 is 5.99 MB and carries 313 AgendaViewer links | **no** - see below |
| Miami Beach, FL | **Granicus**, but empty at the public view | `miamibeachfl.granicus.com` view_id=1 returns 46 KB with **zero** agenda, minutes, media or clip links; view_id 2-6 all 404 | **no** - adapter work, and there may be nothing to read |

### The City of Miami Legistar trap

`webapi.legistar.com/v1/miamifl/Bodies` answers **HTTP 200**, and adding a
config row on that basis is the obvious mistake. It is a **test instance**:

```
Matters (no filter, top 1000): 6
  25-023   2026-03-25  Test March 26, 2026 Resolution Item
  26-0018  2026-04-29  Test item
  26-0020  2026-05-13  Minutes of May 18th, 2026 of the City Commission
  ...
Events: 4
```

Six matters, two of them literally titled "Test item", none matching any
leisure or entitlement word. The city publishes through Granicus instead. **A
200 from Legistar is not evidence of a usable jurisdiction; check the matter
count and the titles.**

### Why Granicus is not a config row either

`sources/agenda-portal.ts` supports Granicus for **Anaheim specifically**:
`ANAHEIM_VIEWPUBLISHER` is a constant, `parseAnaheimMeetings` hard-codes the
body names `City Council|Planning Commission`, and `scrapeAnaheimAgendas` is a
named function. Adding a Granicus market means generalising that adapter into a
configured one - real work, and worth doing once for Miami rather than twice.

### Two blockers found by fetching, not by reading

Both were found by running the gate over real fetched text (read-only, nothing
stored):

- **Miami's AgendaViewer pages do not fetch from this runtime.** The 313 links
  exist in the listing; `AgendaViewer.php?view_id=1&clip_id=NNNN` fails with a
  transport error. Same class as [[anaheim-agenda-hosts]], where Granicus
  stopped serving agendas inline. This must be resolved before any Miami adapter
  is costed, because it may be the whole job.
- **Orlando serves agendas as PDF.** `DisplayAgendaPDF.ashx?MeetingID=NNNN`
  returns a binary; run through the HTML text extractor it yields PDF stream
  noise, and the gate correctly rejects all of it as `no-match`. The repo has
  `fetchPdfPages` already, so this is plumbing rather than research - but it is
  plumbing plus an ASP.NET WebForms listing whose links are all `WebResource.axd`
  postbacks.

### What this means for a claim of coverage

Florida is Disney-only today and stays Disney-only until one of these adapters
is built. Orange County is where Universal Epic Universe, the convention centre
and the I-Drive corridor file, and it is the one with **no identified platform
at all** - so it is the highest value and the least tractable of the five.

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
