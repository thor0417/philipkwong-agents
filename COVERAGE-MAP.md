# Coverage map: what each jurisdiction gives us, and what it never will

Measured 2026-08-17 over 155 readable documents in seven jurisdictions and 151
stored New York records. Every number here came from
`agents/scraper/diagnostics/` and can be re-run.

**Read this before proposing work on a market.** Three of these are worked on
repeatedly because their record counts look reasonable. Their record counts are
reasonable. What is behind the records is not.

---

## The one number that matters per market

"Gains a verified fact" is the share of that market's live projects that would
gain at least one fact a client document could print, from text or documents we
already hold. No new fetch, no new source.

| market | live projects | gains a verified fact | what it gives |
|---|---:|---:|---|
| **New York City** | 93 | **91 (98%)** | the procedural state: filed, certified, approved, milestones, hearings, ULURP and CEQR numbers, agency, borough, district |
| **Oakland** | 5 | **4 (80%)** | the deal: purchase price, named agreement, counterparty, closing date, address, acreage, EIR |
| **Clark County** | 27 | **11 (41%)** | the site and the calendar: APN, land use plan, acreage, zone, storeys, height, floor area by use, parking, conditions of approval, town board, commission action |
| **Anaheim** | 19 | **5 (26%)** | the item: application number, acreage, cross street, CEQA class, case planner |
| Westchester County | 1 | measured, no reader | bond amount and project cost in 6 of 7 documents |
| CFTOD | 1 | measured, no reader | 908,921 characters of comprehensive plan, policy not project |
| **Nashville** | 9 | **0** | see below |
| **Phoenix** | 8 | **0** | see below |
| Miami-Dade | 3 | **0** | dead feed |
| San Antonio | 3 | **0** | dead feed |

---

## The three that are thin. Stop working on them.

### Nashville — 9 projects, 29% of matters have any attachment

- **5 of 17 Legistar matters carry an attachment at all.** The other 12 have none:
  the endpoint returns an empty array, not an error.
- The 7 attachments that exist are 3 unnamed, 2 agreements, 2 exhibits. Of the 5
  that are readable, the content is **grant summary sheets**: "Centennial Park
  Revitalization Plan 2026. This in-kind grant from Centennial Park Conservancy
  provides for an update to the Centennial Park Revitalization Plan. The value of
  the in-kind grant is $82,135.00."
- 2 of 7 are image scans with no text layer.
- Vocabulary: **no party label of any kind.** The only labels in the whole
  Nashville corpus are `Attn:` and `Title:`, both reading "Chief Executive
  Officer".
- What Nashville does give: `Matters/{id}/Sponsors` is populated on 17 of 17
  records, and every sponsor is a Metro Council member. That is who in government
  moved the item and never who is behind the project — see GLI-ROADMAP 1I.

**Verdict: a document reader gains Nashville nothing.** The stadium district is
real and our coverage of it is nine records of Metro Council procedure. Closing
this needs a different source, not a better parser.

### Phoenix — 8 projects, attachments that are not about the project

- 9 of 17 matters carry an attachment; **8 of the 17 fetched are image scans with
  no text layer.**
- The 9 readable ones have a **median of 680 characters** — the smallest in the
  corpus by a factor of seven.
- What they contain, in full, is the whole finding. Attachment A is a liquor
  licence and crime data sheet:

  ```
  Liquor License Data: FIRE N ICE HOTEL
  Liquor License Description Series 1 Mile 1/2 Mile
  Beer and Wine Bar 7 1 0
  Crime Data ... Property Crimes 64.21 1.41 6.36
  Census 2020 Data 1/2 Mile Radius ...
  ```

  Attachment B is a location map, 135 characters of street labels.
- Vocabulary: one label in the entire corpus, `Liquor License Data:`. No party,
  no address, no acreage, no dollar amount, no date.

**Verdict: Phoenix publishes attachments and none of them is about the
development.** OCR would surface more liquor licence statistics.

### Miami-Dade and San Antonio — dead feeds, already declared

- **Miami-Dade**: newest matter 2018-06-15, 0 in the last twelve months, 0 of 6
  matters carry an attachment. Declared in `lib/dead-feeds`.
- **San Antonio**: newest matter 2021-09-24, 0 in the last twelve months. 6 of 12
  matters list an attachment and **every attachment URL returns HTTP 404** — the
  files are gone from Granicus, not merely old.

**Verdict: both are correctly excluded from client documents already.** Nothing
to build. Reopening either is a new-source question, not a parsing one.

---

## New York, and the claim this corrects

The coverage notes have said since the Council's Legistar started answering 403:

> we can say what was filed and reviewed in New York, never what was approved

**The second half is wrong and has been since ZAP was added.** ZAP carries an
`Approved` date on 51% of its records and a `Project status` on 100%. 15 of 93
New York projects gain a stated approval date from text already captured.

The Council feed is still dead and everything that depended on it still is. The
*land use* approval was never in the Council feed; it was in a column nobody
read.

---

## What no jurisdiction gives

**A design team.** Across 155 readable documents, four windows put a role word
next to a named firm. Two are a construction contract template that reads
"Engineer/Architect (insert company name)". One is CFTOD naming its own
engineering department. **One** is a real outside architect, in a Clark County
justification letter. Dropped as a capability; it is not one.

**A party role outside Clark County.** Clark labels `APPLICANT`, `OWNER` and
`CONTACT` on 38% of its documents. Anaheim, Oakland, Nashville, Phoenix,
Westchester and New York label a party role on **0%**. Where an entity appears at
all it appears without a stated role, and inferring one is what standing rule 1
forbids.

**A programme from a filing, except in Clark.** Room counts appear in 1 of 18
Clark agenda sheets, 3 of 151 New York records, and 0 documents in Oakland,
Anaheim, Phoenix, Nashville and Westchester. Filings close the site gap and the
calendar gap. Press remains the only source for how many rooms.
