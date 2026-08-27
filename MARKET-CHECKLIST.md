# THE MARKET SCORECARD

Part 2A. A row per market, a column per layer, and one of four answers in every
cell.

**STATUS: the axis is PROPOSED and the pass has NOT been run.** The ten layers
below are derived from what this system already reads rather than invented, and
every one carries the evidence it was derived from. Confirm or edit them before
the pass runs, because the pass is thirteen markets wide and measuring the wrong
axis costs all of it.

---

## THE FOUR ANSWERS

    FIELD    published as a queryable field, named
    DOC      published as a document we fetch and read
    BLOCKED  exists, cannot reach it, blocker named
    NONE     checked, this jurisdiction does not publish it

A blank is not one of them. A blank means nobody has asked.

---

## THE TEN LAYERS, AND WHERE EACH CAME FROM

Derived 2026-08-27 from the adapter set, the 65 `FilingFactKind` members in
`readers/core.ts`, the eight `SOURCE_TYPES` in `lib/taxonomy.ts`, and the four
criteria in `lib/market-standard.ts`.

### 1. Council or board agenda
The governing body's own meeting agenda. What is being decided, and when.
**Evidence:** `Council Agenda` is a `SOURCE_TYPE`. Read today via Legistar
(Clark, Nashville, Phoenix, Oakland, Yonkers, Westchester, Broward), Granicus
(Anaheim) and PrimeGov (Las Vegas, blocked).

### 2. Planning commission or zoning body agenda
The body that hears entitlements, which is usually not the council.
**Evidence:** `Planning/Zoning Minutes` is a `SOURCE_TYPE` and is a separate
`bodySourceType` branch in `agenda-portal.ts` and `lasvegas.ts`. Kept separate
from layer 1 deliberately: Anaheim's Planning Commission has been arriving the
whole time while its City Council has not.

### 3. Staff report or agenda sheet
The officer's analysis attached to a case. **This is the conditions layer, and it
is the layer the market standard turns on.** `market-standard.ts` records the
probe: 69 documents across five jurisdictions, and NOT ONE per-project condition
outside the Clark County agenda sheet.
**Evidence:** `Staff Report` is a `SOURCE_TYPE`; `readers/clark-agenda-sheet.ts`
returns 28 fact kinds against it.

### 4. Land-use case register
The application itself, with its own case number: use permits, waivers, zone
changes, design review, tentative maps, ULURP.
**Evidence:** Clark's UC/WS/PA/ZC/DR/SDR/TM/ET/MPC/AR series, 197 cases carrying
2,802 filing facts; New York's ULURP numbers via `nyc-zap`.

### 5. Environmental determination
CEQA, CEQR, NEPA, and the MIA in Mexico. Often the earliest public signal a
scheme exists.
**Evidence:** `sources/ceqanet.ts`, `sources/nyc-ceqr.ts`, `sources/nepa.ts`,
`sources/semarnat.ts`; the `environmental` and `ceqa_class` fact kinds; `nyc_ceqr_number`,
`nyc_ceqr_type`, `nyc_environmental_milestone`.

### 6. Legal notices and public hearing notices
The statutory advertisement, which frequently names parties the agenda does not.
**Evidence:** `sources/nyc-city-record.ts`; the `nyc_notice_type` and
`nyc_published` fact kinds; Broward's Sunshine Notices, named in its
`legistar-jurisdictions` config row.

### 7. Ordinances, resolutions and agreements
The instrument that actually binds: development agreements, disposition
agreements, incentive agreements.
**Evidence:** `readers/clark-ordinance-title.ts` reads Clark's ORD and AG series
from the title alone; `readers/oakland-ordinance.ts` returns 14 kinds and its
measurement shows development agreement language at 61% and a purchase or sale
price at 56%. "development agreement" appears 39 times across `agents/` and
`lib/`.

### 8. Building permits and construction approvals
Permit issuance, and certificates of occupancy. The construction half of the
lifecycle rather than the entitlement half.
**Evidence: ALMOST NONE, AND THAT IS THE POINT.** "building permit" appears
**once** across all of `agents/` and `lib/`, "certificate of occupancy" twice,
"demolition" zero times. The BC pipeline's `MARKET-CHECKLIST.md` treats the
building permit layer as primary and measured a 279-day median lead time from
servicing agreement to permit. This system has no such layer in any market.

### 9. Operating licences
Liquor, gaming, entertainment and business licences. For hospitality
specifically, the licence is often the first public sign of an operator.
**Evidence:** "liquor" appears 20 times; Phoenix's single document is a
liquor-licence data sheet. "business licen" appears **zero** times.

### 10. Special district and authority documents
Tourism districts, water districts, stadium authorities, redevelopment agencies,
convention authorities. Bodies that are not the city and often hold the money.
**Evidence:** `Special District Document`, `Comprehensive Plan`, `Plan Amendment`
and `Budget Document` are four of the eight `SOURCE_TYPES`; `sources/sfwmd.ts`
and the CFTOD PDF lane; `clark-tab.ts` for Clark's Town Advisory Boards and the
`tab_cac` fact kind.

---

## WHY THESE TEN AND NOT OTHERS

Three tests were applied, and layers that failed all three were dropped.

1. **Does some jurisdiction publish it as a distinct artefact?** Every one of the
   ten is a separate publication with its own URL pattern somewhere in the
   corpus.
2. **Does it answer a question a hospitality client pays for?** Layers 1 to 4
   answer "is it happening", 5 and 6 answer "how early can we know", 7 answers
   "what was agreed and for how much", 8 and 9 answer "is it actually being
   built and opened".
3. **Would a market missing it have a hole a client would notice?** This is what
   makes layer 8 belong despite the system having no instance of it. A market
   read only through layers 1 to 7 can say a hotel was approved and can never say
   it broke ground.

**Deliberately NOT separate layers,** because each is a property of a record
rather than a publication: parties, conditions, decisions and stated facts.
Those are `market-standard.ts`'s four criteria and they are the PROJECT-level
standard. This grid is the SOURCE-level one, and the two are different questions.
A market can publish all ten layers and still fail the standard, which is exactly
what Anaheim and Oakland do.

---

## THE GRID TO BE FILLED

Rows are every market currently carrying admitted records, with the count as of
2026-08-27, paged and uncapped.

| Market | Records | 1 Council | 2 Planning | 3 Staff report | 4 Case register | 5 Environmental | 6 Notices | 7 Instruments | 8 Permits | 9 Licences | 10 Special district |
|---|---:|---|---|---|---|---|---|---|---|---|---|
| Clark County | 303 | | | | | | | | | | |
| New York City | 187 | | | | | | | | | | |
| Broward County | 97 | | | | | | | | | | |
| Anaheim | 78 | | | | | | | | | | |
| Las Vegas | 70 | | | | | | | | | | |
| Phoenix | 42 | | | | | | | | | | |
| Nashville | 38 | | | | | | | | | | |
| CFTOD | 14 | | | | | | | | | | |
| Oakland | 14 | | | | | | | | | | |
| Orange County | 6 | | | | | | | | | | |
| Westchester County | 2 | | | | | | | | | | |
| Yonkers | 1 | | | | | | | | | | |
| Palm Beach County | 1 | | | | | | | | | | |

130 cells. Retired markets (San Antonio, Miami-Dade, South Florida, Lake Buena
Vista) are excluded; adding a row for a market we do not claim is the thing that
kept the dead ones looking maintained.

---

## THE PILOT: CLARK, BROWARD, ANAHEIM

Run 2026-08-27. 30 cells attempted, **20 answered and 10 not**, counted off the
grid rather than from memory. Every answer below is a live probe read by BODY,
not a status code and not an assumption.

**REVISED 2026-08-27 after the egress probe.** Two Anaheim cells flipped from
BLOCKED to DOC when the same URLs were fetched from the hosted runner. The
BLOCKED answers below are the ones that survived a clean US egress, which is the
only kind worth recording: a cell blocked only from a developer's home
connection is a fact about the developer, not about the market.

| Layer | Clark County | Broward County | Anaheim |
|---|---|---|---|
| 1 Council agenda | **FIELD** | **FIELD** | **DOC** (was BLOCKED) |
| 2 Planning body | **FIELD** | **DOC** | **DOC** |
| 3 Staff report | **DOC** | **DOC** | **DOC** (was BLOCKED) |
| 4 Case register | **FIELD** | not answered | not answered |
| 5 Environmental | **NONE** | not answered | **FIELD** |
| 6 Notices | not answered | **FIELD** | not answered |
| 7 Instruments | **FIELD** | **FIELD** | not answered |
| 8 Permits | **BLOCKED** | not answered | **BLOCKED** |
| 9 Licences | not answered | **DOC** | **FIELD** |
| 10 Special district | **DOC** | not answered | not answered |

### The evidence, cell by cell

**Clark 1 FIELD.** `webapi.legistar.com/v1/clark/Events` returns 200 and JSON.
**Clark 2 FIELD.** Legistar `Bodies` lists `Clark County Planning Commission`,
`Clark County Zoning Commission`, `Clark County Planning Commission Briefing`
and `Zoning Workshop` as distinct bodies.
**Clark 3 DOC.** 245 documents, 221 carrying facts, 28 fact kinds. The only
jurisdiction in the corpus with real per-project conditions.
**Clark 4 FIELD.** Cases carry a `MatterFile` in the UC/WS/PA/ZC/DR/SDR/TM/ET/
MPC/AR series; 197 cases hold 2,802 filing facts.
**Clark 5 NONE.** Nevada has no CEQA-equivalent statute, so there is no
project-level environmental determination to publish. Checked the county's own
navigation: what it publishes under environment is AIR QUALITY permitting, which
is a pollution permit and not a project determination. See the unexpected finding
below.
**Clark 7 FIELD.** ORD-nn-nnnnnn and AG-nn-nnnnnn carry the facts in the title
itself; 65 of 112 titles yield a fact with no document fetch at all.
**Clark 8 BLOCKED.** The informational page answers 200, but the searchable
register is `citizenaccess.clarkcountynv.gov`, an Accela portal sitting behind a
Cloudflare JS challenge (`Just a moment...`). Blocker: interactive challenge, no
plain fetch can pass it.
**Clark 10 DOC.** `clark-tab.ts` reads the Town Advisory Boards and Citizens
Advisory Councils; `tab_cac` is a fact kind; last run fetched 37 and kept 37.

**Broward 1 FIELD.** Legistar, 1,006 matters in twelve months.
**Broward 2 DOC.** The Planning Council is NOT in Legistar. Broward's Legistar
publishes three bodies and the only governing one is County Commission. The
Planning Council publishes separately: `broward.org/PlanningCouncil/` answers
200 with 233KB. **A market-level answer would have missed this entirely.**
**Broward 3 DOC.** 22 of 25 matters carry attachments, 42 in total. The
publisher publishes them and they are fetchable; our own `DRAWING_NAME` filter
discards 74% of them. See `BROWARD-DOCUMENTS-DIAGNOSIS.md`.
**Broward 6 FIELD.** Sunshine Notices are one of its three Legistar bodies.
**Broward 7 FIELD.** Its attachments include `Exhibit 1 - Proposed Ordinance`
and `Exhibit 2 - Amendment Report`, carried on Legistar matters.
**Broward 9 DOC.** `broward.org/RecordsTaxesTreasury` answers 200 with a Local
Business Tax register.

**Anaheim 1 DOC, revised from BLOCKED.** 25 of 53 meetings have every published
document on `local.anaheim.net` or `records.anaheim.net`, and both drop packets
from a Bangkok residential IP. From the hosted runner, AS8075 Azure,
`local.anaheim.net` returns **200 with 232,143 bytes** of the real City Council
agenda. The layer was never blocked; our egress was. `records.anaheim.net`
answers 302 to `CookieCheck.aspx`, a session handshake needing a cookie jar.
**Anaheim 2 DOC.** Planning Commission resolves to `anaheim.granicus.com` and
`www.anaheim.net`, both reachable from everywhere; the last run fetched 17 and
kept 17.
**Anaheim 3 DOC, revised from BLOCKED.** Same two hosts, same correction.
Separately and unchanged: the Anaheim reader returns 9 kinds and zero conditions
by measurement, so this layer is READABLE and still yields no conditions. Being
reachable and being useful are different questions and only the first one moved.
**Anaheim 5 FIELD.** The cleanest cell in the pilot. The CEQAnet lead-agency
export for `Anaheim, City of` returns 200 and **854,614 bytes of CSV** with a
real header row beginning `SCH Number,Lead Agency Name,Lead Agency Title`.
**Anaheim 8 BLOCKED, and the blocker is NOT the one first recorded.**
`permits.anaheim.net` resolves to 74.118.32.62, the same `/24` as the two hosts
that now answer from the runner, so its IP is demonstrably reachable. It still
does not answer: it times out waiting for network idle from a clean egress
because it is a CLIENT-SIDE JAVASCRIPT APPLICATION with no plain server route.
Blocker: application shape, not network.
**Anaheim 9 FIELD.** California ABC License Lookup answers 200, statewide and
public.

---

## WHAT THE PILOT PROVED, WHICH IS THE POINT OF RUNNING ONE

**1. The axis works.** Every answered cell was decided by a single probe reading
a body, and the answers are genuinely different from each other rather than all
being "we have some records from here".

**2. The unanswered cells are not random.** All 10 sit in layers 4, 5, 6, 7, 9
and 10, and 7 of the 10 are in layers 4, 6, 9 and 10: case register, legal
notices, licences and special district. Those four have no standard URL shape,
so they cannot be probed by pattern and need the jurisdiction's own navigation
read. Layers 1, 2, 3 and 8 were answerable almost mechanically in every market.
**That is the number to cost the rest of the pass on: two thirds of this grid
falls to procedure and one third needs a person to look.**

**3. The egress contaminated the scorecard, and the re-run proved it.** The first
pass recorded four BLOCKED cells. Re-probed from the hosted runner, **two of the
four flipped to DOC** and neither needed a line of code. Anaheim layers 1 and 3
were never blocked; a Bangkok residential IP was.

**This is now a standing rule for the pass: a cell may only be recorded BLOCKED
from a clean US egress.** A BLOCKED written from a developer's home connection is
a fact about the developer, and it would have marked Anaheim below standard on
two layers it has published all along.

The two that survived the re-run are the interesting ones, because their blocker
turned out to be a different KIND. `permits.anaheim.net` and
`citizenaccess.clarkcountynv.gov` are both client-side JavaScript applications
with no plain server route, and `permits.anaheim.net` sits on an IP that
demonstrably answers now. **Layer 8 is blocked by application architecture, not
by network, in both markets tested.** No proxy, VPS or egress decision would ever
have touched it, and it is the only one of the brief's four blocker categories
that turned out to be real.

**4. A market-level answer would have missed Broward's Planning Council.** It is
not in the platform the market is configured through. Layer 2 exists, publishes,
and is invisible to a Legistar-shaped question. That is the single strongest
argument for the layer axis over a per-market yes or no.

### Unexpected, and not asked for

Clark County publishes **air quality permitting**: stationary source permits, dust
control permits, and an air quality fee portal, all linked from its own home
page. That is not one of the ten layers and it is not a project environmental
determination. But dust control permits are pulled BEFORE ground is broken, on a
site-by-site basis, and this system currently has no layer that answers "has
anything started on the ground". It is the closest thing to layer 8 that Clark
publishes without a Cloudflare challenge in front of it, and it is worth a
measurement pass of its own.

---

## THE PROCEDURE FOR FILLING ONE ROW

Per Part 2B, and this is the layer above `docs/ADDING-A-MARKET.md` rather than a
replacement for it.

1. **Fingerprint the platform from the markup. Body, not status code.** Legistar
   answers 200 on any subdomain and the wildcard is 19 bytes against a real
   portal's 190KB. A 200 carrying a Cloudflare interstitial is a block.
2. **Answer all ten layers.** Four answers, no blanks.
3. **Answer the jurisdiction-specific questions:** which apply here, and which
   were checked and do not.
4. **Record the row.**
5. **`verify:market-standard` reports it from the next run.**

**A market is added when its row is complete, not when its records arrive.** The
absence of that rule is what produced a one-county product: 14 live projects
clear all four standard criteria and every one of them is Clark County.

---

## AND ONE THING THE GRID WILL PROBABLY SHOW

Layers 1 to 7 are the entitlement half of the development lifecycle and this
system reads them well. Layers 8 and 9 are the construction and operation half
and it reads them essentially not at all: one mention of "building permit",
zero of "business licence", zero of "demolition".

For a hospitality client that is a real hole, because "approved" and "opening"
are different questions and only one of them is currently answerable. I expect
column 8 to come back NONE or blank in every market and column 9 in all but
Phoenix, and if that is what it shows then the most valuable next market may not
be a new place at all. It may be a new layer in the places already covered.
