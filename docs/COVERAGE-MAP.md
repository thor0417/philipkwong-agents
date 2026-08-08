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

Layers 5 through 8 are **NONE in every market**. No aviation, special-regulator,
capital-plan or bond source is captured anywhere. That is a system-wide gap, not
a per-market one, and it is stated once here rather than repeated in ten rows.

---

## New York City — PRESS ONLY

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
