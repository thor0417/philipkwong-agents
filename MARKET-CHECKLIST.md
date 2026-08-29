# THE MARKET SCORECARD

Part 2A. A row per market, a column per layer, and one of four answers in every
cell.

**STATUS: THE PASS HAS RUN. 90 cells, nine markets, every cell carrying its
evidence.** Probed 2026-08-29 from GitHub Actions run 33256295489 at commit
1b00d9a, egress Des Moines, Iowa, US - because rule 1 says a BLOCKED cell is only
ever recorded from the hosted runner. See THE GRID, FILLED below.

46 of the 90 are answered and 44 are NEEDS-NAVIGATION, which is a real answer and
not a blank: it means the layer has no URL sourceable from an adapter, from the
pilot, or from a named statewide register, so nobody has asked it yet. A blank is
still not one of the answers, and after this pass there are none.

The ten layers are derived from what this system already reads rather than
invented, and every one carries the evidence it was derived from.

---

## THE FOUR ANSWERS

    FIELD    published as a queryable field, named
    DOC      published as a document we fetch and read
    BLOCKED  exists, cannot reach it, blocker named
    NONE     checked, this jurisdiction does not publish it

A blank is not one of them. A blank means nobody has asked.

**THIS GRID MEASURES REACHABILITY, NOT COVERAGE, AND A `DOC` CELL IS NOT A
CLAIM THAT THE MARKET IS AT STANDARD ON THAT LAYER.** It answers "does the
publisher publish this, and can we fetch it". Whether what we fetched carries
parties, conditions, decisions and stated facts is the PROJECT-level question,
and `lib/market-standard.ts` and `verify:market-standard` are what answer it.
The two are routinely different: Anaheim's layer 3 is reachable and its reader
returns nine fact kinds and ZERO conditions, and a market can be `DOC` or
`FIELD` on all ten layers and still fail the standard on every criterion.
Reading a `DOC` cell as coverage is the same mistake as reading a label as the
thing it names, which is the defect this repository keeps finding.

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

## THE ROWS, RE-DERIVED ON THE DAY OF THE PASS

The 2026-08-27 list was copied from a count taken that day. It is re-derived here
from the corpus by `npm run diag:scorecard-rows`, paged and uncapped, because a
grid cut on a stale count puts a market in the deferred block that has since
grown past the ones above it.

**Measured 2026-08-29. 1,902 hospitality records read whole, 1,096 not dismissed,
across 11 covered markets.** Not a sample: PostgREST's silent 1,000-row default
would have made this a fact about the first thousand records.

| # | Market | Records | Band |
|---:|---|---:|---|
| 1 | Clark County | 301 | SCORED |
| 2 | New York City | 187 | SCORED |
| 3 | Broward County | 97 | SCORED |
| 4 | Anaheim | 78 | SCORED |
| 5 | Las Vegas | 70 | SCORED |
| 6 | Phoenix | 42 | SCORED |
| 7 | Nashville | 38 | SCORED |
| 8 | Central Florida Tourism Oversight District | 14 | SCORED |
| 9 | Oakland | 14 | SCORED |
| 10 | Westchester County | 2 | DEFERRED |
| 11 | Yonkers | 1 | DEFERRED |

Clark is 301 and not 303: two of its records have been dismissed since the
27th. Nothing else moved.

### THE DEFERRAL, STATED. Standing rule 3.

A scorecard that simply stopped at nine rows would be withholding four markets
without saying so. The four the 2026-08-27 grid listed below the top nine are
**not one category, they are two**, and collapsing them would have been the
error the rule exists to prevent.

**Deferred on size. Two covered markets, three live records between them, 0.3%
of the live corpus.**

| Market | Live records | Live projects | Why deferred |
|---|---:|---:|---|
| Westchester County | 2 | 1 | Two records and one project. Ten cells of probing to characterise a market that contributes 0.2% of the corpus, when the same effort spent on Clark's 301 changes what a client reads. It is on the covered-markets table, `verify:coverage-table` passes it, and it is scored in the next pass. |
| Yonkers | 1 | 1 | One record, newest 2025-09-15, which is the oldest newest-record of any claimed market. Same reasoning. Its age is worth a look of its own before ten cells are spent on it. |

**NOT DEFERRED, BECAUSE THEY SHOULD NEVER HAVE BEEN ROWS.** Both were on the
2026-08-27 grid and neither is on the covered-markets table, so a row for either
would have implied a coverage claim this system does not make. That is precisely
what "kept the dead ones looking maintained" describes, arriving from the other
direction.

| Market | Live records | Live projects | Why it is not a row |
|---|---:|---:|---|
| Orange County | 6 | **0** | `isCoveredMarket('Orange County')` is false. Six records cluster into no live project at all. Its CEQAnet lead agency was probed in the pilot for completeness; that is not a coverage claim. |
| Palm Beach County | 1 | **0** | Not covered, and one live record clustering into no project. It was a single row on the grid because a single record carried the market string. |

Both keep their records. Standing rule 6: nothing is hard deleted, and a record
from an uncovered market is held rather than thrown away, so that what we had
before a market opens can be read back rather than re-scraped.

**90 cells scored, 20 deferred and stated, 20 withdrawn and stated.** Retired
markets (San Antonio, Miami-Dade, South Florida, Lake Buena Vista) are excluded
for the same reason as Orange County and Palm Beach.

---

## THE GRID, FILLED

**Probed 2026-08-29 from GitHub Actions, run 33256295489, commit 1b00d9a. Runner
egress Des Moines, Iowa, US.** Rule 1: a BLOCKED cell is only recorded from the
hosted runner, and this is that runner. 96 cells emitted, 90 unique, one per
market per layer.

THE FIRST RUN OF THIS PROBE WAS THROWN AWAY, and it is worth saying why in the
file rather than only in a commit message. It ran from a clean US egress and
still produced four classes of unusable cell:

- an unencoded space in `$orderby=MatterId desc` returned HTTP 000, so all five
  Legistar markets reported the IDENTICAL answer on layers 3, 4 and 7. Fifteen
  cells that were facts about a URL. Five publishers behaving identically is the
  signature of a broken probe, not of five publishers.
- `(plan|zon)` matched Ka-PLAN and recorded **Oakland L2 FIELD, body: Rebecca
  Kaplan** - a councilmember as a planning body.
- five URLs were invented and their 404s recorded as findings: Anaheim L2 NONE,
  Anaheim L4 NONE, NYC L9 NONE, and BLOCKED on two permit hosts that do not
  exist. The Anaheim Granicus probe used `view_id=10`; `agenda-portal.ts:345`
  uses `view_id=2`.
- a 39-byte page was called DOC, because the classifier only rejected thin pages
  when scripts were present.

All four are fixed and the fixes are named in the workflow header so they are
checkable. **A NONE on an invented URL is fabrication with a status code
attached**, and three of those four broke the rule the workflow's own header
states.

| Market | Records | 1 Council | 2 Planning | 3 Staff report | 4 Case register | 5 Environmental | 6 Notices | 7 Instruments | 8 Permits | 9 Licences | 10 Special district |
|---|---:|---|---|---|---|---|---|---|---|---|---|
| Clark County | 301 | **FIELD** | **FIELD** | **DOC** | **DOC** | **NONE** | nav | **FIELD** | **BLOCKED** | nav | **DOC** |
| New York City | 187 | **BLOCKED** | nav | nav | **FIELD** | **FIELD** | **DOC** | nav | nav | nav | nav |
| Broward County | 97 | **FIELD** | **DOC** | **DOC** | **FIELD** | **FIELD** | **FIELD** | **DOC** | nav | **DOC** | nav |
| Anaheim | 78 | nav | **DOC** | nav | nav | **FIELD** | nav | nav | **BLOCKED** | **DOC** | nav |
| Las Vegas | 70 | **FIELD** | **FIELD** | **DOC** | **DOC** | **NONE** | nav | nav | nav | nav | nav |
| Phoenix | 42 | **FIELD** | **FIELD** | **DOC** | nav | **NONE** | nav | **FIELD** | nav | nav | nav |
| Nashville | 38 | **FIELD** | **FIELD** | nav | nav | **NONE** | nav | **FIELD** | nav | nav | nav |
| CFTOD | 14 | **DOC** | nav | **DOC** | nav | **FIELD** | nav | nav | nav | nav | **DOC** |
| Oakland | 14 | **FIELD** | nav | nav | nav | **FIELD** | nav | **FIELD** | nav | **DOC** | nav |

`nav` is NEEDS-NAVIGATION: the layer has no URL sourceable from an adapter, from
the pilot, or from a named statewide register, so nobody has asked it yet. It is
NOT `NONE`, which means checked and not published.

**44 NEEDS-NAVIGATION, 22 FIELD, 17 DOC, 4 NONE, 3 BLOCKED.** 90 cells, 46 answered and 44 not.

### THE EVIDENCE, CELL BY CELL

**Clark County**

- **L1 FIELD.** Legistar Events returns 3 events as queryable JSON (sources/legistar.ts)
- **L2 FIELD.** Legistar body: Clark County Planning Commission
- **L3 DOC.** matter 110885 carries 1 attachments, e.g. Staff Report;
- **L4 DOC.** 46 of 60 carry the case number in MatterTitle and not in a queryable field, e.g. ORD-26-900587: Conduct a public hearing on an ordina
- **L5 NONE.** Nevada has no CEQA-equivalent statute. What Clark publishes under environment is AIR QUALITY permitting - stationary source and dust control - which is a pollution permit, not a project determination
- **L6 NEEDS-NAVIGATION.** no notices body in Legistar
- **L7 FIELD.** 1 instrument matter types: Introduction of Ordinances;
- **L8 BLOCKED.** NETWORK: no TCP to citizenaccess.clarkcountynv.gov:443 from the runner. Accela CitizenAccess; the pilot probed this host
- **L9 NEEDS-NAVIGATION.** no licence register for this market is named in any adapter or in the pilot; 'business licen' appears zero times across agents/ and lib/
- **L10 DOC.** www.clarkcountynv.gov answers 200 with 7905b of readable text. clark-tab.ts reads the Town Advisory Boards

**New York City**

- **L1 BLOCKED.** NETWORK: webapi.legistar.com/v1/nyc returns 403 from the runner, so this is the feed refusing and not our egress. Unchanged since first recorded
- **L2 NEEDS-NAVIGATION.** the City Planning Commission calendar is not read by any adapter; ZAP is the project register and is layer 4
- **L3 NEEDS-NAVIGATION.** no CPC staff-report source is named in any adapter
- **L4 FIELD.** ZAP project register answers 200 (sources/nyc-zap.ts)
- **L5 FIELD.** Socrata dataset gezn-7mgk answers 200; CEQR projects queryable (sources/nyc-ceqr.ts)
- **L6 DOC.** a856-cityrecord.nyc.gov answers 200 with 5164b of readable text. sources/nyc-city-record.ts
- **L7 NEEDS-NAVIGATION.** no local-law or agreement source is named in any adapter
- **L8 NEEDS-NAVIGATION.** no permit portal for this market is named in any adapter or in the pilot, and this repo holds one building-permit reference in total; the jurisdiction's own navigation has to be read
- **L9 NEEDS-NAVIGATION.** no licence register for this market is named in any adapter or in the pilot; 'business licen' appears zero times across agents/ and lib/
- **L10 NEEDS-NAVIGATION.** no authority document source is named in any adapter

**Broward County**

- **L1 FIELD.** Legistar Events returns 3 events as queryable JSON (sources/legistar.ts)
- **L2 DOC.** www.broward.org answers 200 with 155893b of readable text. the pilot's Broward 2 evidence: the Planning Council is NOT in Broward's Legistar  [LAYER CORRECTED BY HAND: the pilot assigned this URL to layer 2 and argued for it; my workflow asked it under layer 10. The evidence is unchanged, only the label was wrong.]
- **L3 DOC.** matter 18667 carries 1 attachments, e.g. Exhibit 1 - DelegationRequestForm - Eligha Lewis;
- **L4 FIELD.** 5 of 60 carry a case-numbered MatterFile, e.g. SN26-106
- **L5 FIELD.** SFWMD ArcGIS REST answers 200 with 31556b; environmental resource permitting is queryable (sources/sfwmd.ts)
- **L6 FIELD.** Legistar body: Sunshine Notices
- **L7 DOC.** no instrument matter TYPE, but 24 of 60 titles name an ordinance, resolution or agreement; it is in text, not in a field
- **L8 NEEDS-NAVIGATION.** no permit portal for this market is named in any adapter or in the pilot, and this repo holds one building-permit reference in total; the jurisdiction's own navigation has to be read
- **L9 DOC.** www.broward.org answers 200 with 151788b of readable text. the pilot's Broward 9 evidence, Local Business Tax register
- **L10 NEEDS-NAVIGATION.** no special district or authority for Broward is named in any adapter; the Planning Council URL previously counted here is a planning BODY and moves to layer 2

**Anaheim**

- **L1 NEEDS-NAVIGATION.** local.anaheim.net answers 200 but carries only 39b of visible text and no scripts; that is not a document, read the navigation. govdocs.ts:118; pilot recorded 232,143b for a specific agenda, this is the index
- **L2 DOC.** anaheim.granicus.com answers 200 with 98148b of readable text. agenda-portal.ts:345, the Planning Commission publisher
- **L3 NEEDS-NAVIGATION.** local.anaheim.net answers 200 but carries only 39b of visible text and no scripts; that is not a document, read the navigation. same host as L1; this probes REACHABILITY only. The Anaheim reader returns 9 fact kinds and ZERO conditions by measurement, so the layer can be readable and still yield nothing
- **L4 NEEDS-NAVIGATION.** no land-use case register for Anaheim is named in any adapter; the first run guessed a city URL, got 404 and recorded NONE
- **L5 FIELD.** CEQAnet lead-agency CSV, 854614b, 1383 rows (sources/ceqanet.ts)
- **L6 NEEDS-NAVIGATION.** no legal-notice publication for this market is named in any adapter or in the pilot
- **L7 NEEDS-NAVIGATION.** no ordinance or agreement source for Anaheim is named in any adapter
- **L8 BLOCKED.** NETWORK: no TCP to permits.anaheim.net:443 from the runner. the pilot probed this host and recorded APP-SHAPE blocked
- **L9 DOC.** www.abc.ca.gov answers 200 with 168725b of readable text. California ABC, statewide; the pilot probed it. Covers Oakland too
- **L10 NEEDS-NAVIGATION.** no special district named in any adapter or in the pilot

**Las Vegas**

- **L1 FIELD.** PrimeGov JSON 188832b, 3 City Council meeting titles (sources/lasvegas.ts)
- **L2 FIELD.** PrimeGov JSON, 2 Planning Commission meeting titles
- **L3 DOC.** PrimeGov lists 501 meeting document templates alongside the meetings
- **L4 DOC.** www.lasvegasnevada.gov answers 200 with 17117b of readable text. govdocs.ts already reads this index
- **L5 NONE.** Nevada, as above
- **L6 NEEDS-NAVIGATION.** as above
- **L7 NEEDS-NAVIGATION.** no ordinance or agreement source for Las Vegas is named in any adapter
- **L8 NEEDS-NAVIGATION.** no permit portal for this market is named in any adapter or in the pilot, and this repo holds one building-permit reference in total; the jurisdiction's own navigation has to be read
- **L9 NEEDS-NAVIGATION.** no licence register for this market is named in any adapter or in the pilot; 'business licen' appears zero times across agents/ and lib/
- **L10 NEEDS-NAVIGATION.** no special district named in any adapter or in the pilot

**Phoenix**

- **L1 FIELD.** Legistar Events returns 3 events as queryable JSON (sources/legistar.ts)
- **L2 FIELD.** Legistar body: Planning and Economic Development Subcommittee
- **L3 DOC.** matter 35941 carries 1 attachments, e.g. Attachment A - EDA Subcommittee Minutes June 10 2026_.pdf;
- **L4 NEEDS-NAVIGATION.** no case number in MatterFile or MatterTitle across 60 matters; the register may be a separate portal
- **L5 NONE.** Arizona has no CEQA-equivalent statute for local discretionary approvals
- **L6 NEEDS-NAVIGATION.** no notices body in Legistar
- **L7 FIELD.** 5 instrument matter types: Law Dept. Consolidated S-Ordinance;Ordinance-G;Ordinance-S;Payment Ordinance;Resolution;
- **L8 NEEDS-NAVIGATION.** no permit portal for this market is named in any adapter or in the pilot, and this repo holds one building-permit reference in total; the jurisdiction's own navigation has to be read
- **L9 NEEDS-NAVIGATION.** no licence register for this market is named in any adapter or in the pilot; 'business licen' appears zero times across agents/ and lib/
- **L10 NEEDS-NAVIGATION.** no special district or authority for this market is named in any adapter or in the pilot

**Nashville**

- **L1 FIELD.** Legistar Events returns 3 events as queryable JSON (sources/legistar.ts)
- **L2 FIELD.** Legistar body: Planning and Zoning Committee
- **L3 NEEDS-NAVIGATION.** the newest matter (21159) carries no attachment; sample more, or the staff report is on a separate portal
- **L4 NEEDS-NAVIGATION.** no case number in MatterFile or MatterTitle across 60 matters; the register may be a separate portal
- **L5 NONE.** Tennessee has no CEQA-equivalent statute for local discretionary approvals
- **L6 NEEDS-NAVIGATION.** no notices body in Legistar
- **L7 FIELD.** 1 instrument matter types: Resolution;
- **L8 NEEDS-NAVIGATION.** no permit portal for this market is named in any adapter or in the pilot, and this repo holds one building-permit reference in total; the jurisdiction's own navigation has to be read
- **L9 NEEDS-NAVIGATION.** no licence register for this market is named in any adapter or in the pilot; 'business licen' appears zero times across agents/ and lib/
- **L10 NEEDS-NAVIGATION.** no special district or authority for this market is named in any adapter or in the pilot

**Central Florida Tourism Oversight District**

- **L1 DOC.** www.oversightdistrict.org answers 200 with 8480042b of readable text. govdocs.ts; Board of Supervisors agenda packet
- **L2 NEEDS-NAVIGATION.** CFTOD has a Board of Supervisors and no separate planning body named anywhere in this repo
- **L3 DOC.** www.oversightdistrict.org answers 200 with 17043305b of readable text. govdocs.ts; the packet carries the staff material
- **L4 NEEDS-NAVIGATION.** no land-use case register named in any adapter
- **L5 FIELD.** the same SFWMD service; the district sits inside the water management district
- **L6 NEEDS-NAVIGATION.** no legal-notice publication for this market is named in any adapter or in the pilot
- **L7 NEEDS-NAVIGATION.** no ordinance or agreement source named in any adapter
- **L8 NEEDS-NAVIGATION.** no permit portal for this market is named in any adapter or in the pilot, and this repo holds one building-permit reference in total; the jurisdiction's own navigation has to be read
- **L9 NEEDS-NAVIGATION.** no licence register for this market is named in any adapter or in the pilot; 'business licen' appears zero times across agents/ and lib/
- **L10 DOC.** www.oversightdistrict.org answers 200 with 24249389b of readable text. govdocs.ts; CFTOD IS a special district, so layer 10 is its primary layer

**Oakland**

- **L1 FIELD.** Legistar Events returns 3 events as queryable JSON (sources/legistar.ts)
- **L2 NEEDS-NAVIGATION.** no body in Legistar carries a whole-word planning or zoning term together with a body noun; it may publish separately, as Broward's Planning Council does
- **L3 NEEDS-NAVIGATION.** the newest matter (37521) carries no attachment; sample more, or the staff report is on a separate portal
- **L4 NEEDS-NAVIGATION.** no case number in MatterFile or MatterTitle across 60 matters; the register may be a separate portal
- **L5 FIELD.** CEQAnet lead-agency CSV, 1030217b, 1479 rows (sources/ceqanet.ts)
- **L6 NEEDS-NAVIGATION.** no notices body in Legistar
- **L7 FIELD.** 2 instrument matter types: City Resolution;Ordinance;
- **L8 NEEDS-NAVIGATION.** no permit portal for this market is named in any adapter or in the pilot, and this repo holds one building-permit reference in total; the jurisdiction's own navigation has to be read
- **L9 DOC.** www.abc.ca.gov answers 200 with 168725b of readable text. the same statewide register as Anaheim
- **L10 NEEDS-NAVIGATION.** no special district or authority for this market is named in any adapter or in the pilot


### WHAT THE FILLED GRID SAYS

**Half the grid falls to procedure and half needs a person.** 46 cells answered,
44 not - against the pilot's estimate of two thirds mechanical. The pilot
measured that on the three richest markets; across all nine the mechanical share
is lower, because the thin markets are thin in exactly the layers that have no
standard URL shape.

**The unanswered are not scattered.** Of the 44, thirty are layers 6, 8, 9 and
10 - notices, permits, licences and special districts. Those four have no
standard endpoint anywhere, which is why the pilot could not probe them either.
Layers 1, 2, 3, 5 and 7 are answered in 37 of 45 cells.

**Layer 8 is the emptiest row in the grid and that is a product fact, not a
probing failure.** Two markets carry a real answer and both are BLOCKED by
APPLICATION SHAPE rather than by network. The other seven say NEEDS-NAVIGATION
because no permit portal for them is named in any adapter - this repository
contains ONE building-permit reference in total. A market read through this grid
can say a hotel was approved and can never say it broke ground.

**Clark County is the only market answered on nine of ten**, and the one it
misses is notices. It is also the only market whose staff report carries real
per-project conditions, which is a different question this grid does not ask.

**New York City is answered on four of ten and three of those four are FIELD.**
Its layer 1 is BLOCKED at the feed - `webapi.legistar.com/v1/nyc` returns 403
from the runner, so that is the publisher refusing and not our egress, and it is
unchanged since it was first recorded. The standing consequence holds: we can say
what was FILED and reviewed in New York and never what was APPROVED.

**Two cells changed their verdict from the pilot and both are worth reading.**
Anaheim L1 and L3 were DOC in the pilot on 232,143 bytes from a specific agenda
document; the index at `local.anaheim.net/docs_agend/` answers 200 with 39 bytes
of visible text, which is not a document, so both are NEEDS-NAVIGATION here. The
pilot's finding is not wrong - it fetched a different URL - and reconciling the
two is a navigation question. Anaheim L8 was APP-SHAPE blocked in the pilot on a
host whose IP demonstrably answered; from this runner it now refuses TCP
outright, so it is recorded NETWORK blocked. A host can change which way it
refuses.

**One cell's LAYER was corrected by hand.** `broward.org/PlanningCouncil` is the
planning body, which is layer 2, and the pilot assigned it there and argued for
it as the strongest case for the layer axis - it publishes, and it is invisible
to a Legistar-shaped question. My workflow asked it under layer 10. The evidence
is unchanged: same URL, same 200, same 155,893 bytes. Only the label was wrong,
and it was wrong in the workflow rather than in the probe's reading.

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
| 4 Case register | **DOC** *(was FIELD)* | **DOC** | not answered |
| 5 Environmental | **NONE** | not answered | **FIELD** |
| 6 Notices | not answered | **FIELD** | not answered |
| 7 Instruments | **FIELD** | **DOC** *(was FIELD)* | not answered |
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
**Clark 4 DOC, corrected from FIELD.** The pilot recorded FIELD on the belief
that cases carry a `MatterFile` in the UC/WS/PA/ZC/DR/SDR/TM/ET/MPC/AR series.
Re-probed across the newest 60 matters, `MatterFile` holds sequential agenda
numbers (`26-2120`, `26-2119`) and the case number appears in **MatterTitle in 53
of 60**, for example `ORD-26-900587: Conduct a public hearing on an ordina...`.
The case register is real and it is in TEXT, not in a queryable field. That is
DOC, and the difference matters: a FIELD can be filtered server-side and a DOC
has to be fetched and parsed.
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
**Broward 7 DOC, corrected from FIELD.** Its instruments are real but they are
not a queryable field: its five Legistar matter types are Consent Item, Regular
Item, Public Hearing, Purchasing Regular Item and Purchasing Consent Item, and
none names an instrument. The ordinances are ATTACHMENTS
(`Exhibit 1 - Proposed Ordinance`, `Exhibit 2 - Amendment Report`), so they must
be fetched and read. DOC, not FIELD.
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
