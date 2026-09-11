# READER 3. ANAHEIM GRANICUS.

Measured 2026-09-11 by `agents/scraper/diagnostics/reader-three-probe.ts`,
NPM_EXIT=0. Nothing written. Same reporting as readers 1 and 2: records read,
facts extracted, projects moved off zero, whether any of it reaches the market
standard, and whether it emits a condition. The url question was asked first, as
instructed, and it changed the answer.

Every figure is from a read paged to exhaustion. No cap.

---

## 0. THE SHORT ANSWER

**The 40 urls are 41, and they are two different things wearing one name.** 76
records stand on 41 distinct urls: **23 are Granicus AgendaViewer pages** and
**15 are real PDFs** (11 Granicus DocumentViewer, 3 CivicPlus DocumentCenter, 1
AgendaCenter ViewFile), with 3 CEQAnet project pages making up the rest. Probed
one by one from this machine: every AgendaViewer answers 302 with a 14 byte body
into `local.anaheim.net`, which answers nothing; every PDF answers 200 with
between 213,688 and 2,506,883 bytes of `application/pdf`.

**The blocked half is City Council. All 51 of it.** That is the finding the
earlier verdict missed by looking at hosts instead of bodies. Of 79 Anaheim
records, 56 are City Council and 17 are Planning Commission; **every record on an
AgendaViewer url is a City Council item**, and City Council is not published on
the reachable host at all.

**The Planning Commission half is not blocked and never was.** All 44 of its
2025 and 2026 agendas open from this machine on `www.anaheim.net`, they carry 55
`ITEM NO.` blocks, and the existing reader reaches 51 of them for 338 facts.
**The corpus holds a document for 11 of those 44 meetings.** The other 33 have
never been captured, and they hold 30 unread items worth 188 facts.

**So reader 3 is not a reader and it is not an egress wall. It is an adapter
pointed at the wrong host for half its market.**

**It emits no condition, and none is possible from what is reachable.** 0
conditions over all 44 agendas, 0 over every document already held. The count
stays where it has been: **1,474 condition facts in the corpus, every one
Clark's.**

**Found, not asked about: every Anaheim meeting date in the corpus is a day
early**, and the shape reaches 821 records across 12 markets. Section 6.

---

## 1. THE URL CENSUS, WHICH WAS THE FIRST QUESTION

Population: `leads.market` starting with Anaheim, `status <> 'dismissed'`, paged
to exhaustion.

| | |
|---|---:|
| Anaheim records | **79** |
| on a project the register still holds | 59 |
| carrying `raw_content` | 79 |
| carrying a filing fact today | 16 |
| carrying a `primary_document_url` | 76 |
| `has_primary_document = true` | 22 |

`raw_content` length: min 207, p25 615, **median 891**, p75 2,468, max 2,922.

**76 records stand on 41 distinct urls.**

| url form | records | distinct urls | `document-shape` says |
|---|---:|---:|---|
| granicus AgendaViewer | 51 | **23** | listing |
| granicus DocumentViewer | 15 | 11 | file |
| civicplus DocumentCenter | 6 | 3 | file |
| ceqanet project page | 3 | 3 | listing |
| civicplus AgendaCenter ViewFile | 1 | 1 | file |

This is the Las Vegas shape and it is not the Las Vegas answer. Las Vegas held 45
records on 27 meeting pages and **no documents at all**. Anaheim holds 51 records
on 23 meeting pages **and** 22 records on 15 real files. `lib/document-shape` was
right about both halves; nobody had counted the halves apart.

## 2. WHAT EACH URL ANSWERS, PROBED RATHER THAN INFERRED

Manual redirect, so a redirector is visible as one. All 41 probed.

```
  22  302 -> local.anaheim.net/docs_agend/questys_pub/NNNNN/Agenda.html
          :: no answer, 0 bytes
   1  no answer at all (anaheim.granicus.com, clip_id=3398)
  15  FILE (pdf), 200, 213,688 to 2,506,883 bytes
   3  PAGE, 200, ceqanet.lci.ca.gov project pages, 1,837 to 7,619 bytes of text
```

The AgendaViewer redirect is confirmed at 22 of 23 urls rather than at the one
url the 2026-09-07 verdict rested on. The 23rd answered nothing at all, which is
a fact about this machine and is reported as one.

## 3. THE BODY, WHICH IS THE AXIS NOBODY HAD LOOKED ALONG

| | records | bodies |
|---|---:|---|
| on an AgendaViewer url (blocked) | 51 | **City Council 51** |
| whose url is a file (readable) | 22 | Planning Commission 17, City Council 5 |
| every Anaheim record | 79 | City Council 56, Planning Commission 17, unlabelled 6 |

`www.anaheim.net/AgendaCenter` lists 20 bodies. **Planning Commission is category
18. City Council is NOT LISTED.** Council publishes through Granicus into
`local.anaheim.net` and nowhere else this machine can see, which is exactly what
CLAUDE.md already says about Anaheim City Council and is now measured at the
record level rather than at the host level.

## 4. EVERY EXISTING READER, OVER WHAT THE CORPUS ALREADY HOLDS

**Over `raw_content`: records read 79, facts 42, conditions 0, projects moved off
zero 0.** The recogniser fired on 23 and yielded on 8.

**Over the 18 distinct documents this egress can fetch, per record, exactly as
the write path reads them: records read 25, records reached 16, facts 77,
conditions 0, projects moved off zero 0.**

```
  application_no 16   case_planner 16   environmental 12   site_acreage 10
  ceqa_class 7        cross_streets 6    site_address 5     action_sought 3
  resolution 2
```

77 facts on 16 records is the same 77 on the same 16 that
`capture:filings --lane anaheim` reported on 2026-09-07 and on 2026-09-02. The
document half of reader 3 is finished and has been for two runs.

**A defect in this probe, recorded because it nearly became a finding.** Its first
run called `readAnaheimFacts(text)` with no options and reported **zero** facts
over documents the write path reads 77 from. An Anaheim agenda covers several
items and the reader is handed the one item the record is,
`${title} ${action_sought}`; without it there is no item to scope to and the
reader correctly returns nothing. The probe now mirrors
`capture-filing-facts.ts:215` rather than inventing a call. A harness that calls
the code differently from the write path measures the harness.

## 5. THE HALF THAT IS REACHABLE, AND HOW LITTLE OF IT WE HOLD

`www.anaheim.net/AgendaCenter/Search`, category 18, 2025 and 2026. Every
candidate opened and checked for `PLANNING COMMISSION` in its own first page,
because **the listing is not category clean**: a Public Library Board agenda came
back under the Planning Commission category, and a date match against it is how
a wrong meeting becomes a finding.

| | |
|---|---:|
| Planning Commission agendas that open from this machine | **44** |
| the corpus already holds a document for | **11** |
| the corpus holds nothing for | **33** |
| `ITEM NO.` blocks across all 44 | **55** |
| on a meeting we already hold | 25 |
| on a meeting we hold nothing for | **30** |
| items the existing reader reaches | **51 of 55** |
| facts | **338** |
| of those, from meetings we hold nothing for | **188** |
| CONDITIONS | **0** |

Matching a meeting to what we hold needs a day either side. See section 6: the
stored date is a day early, and matching on the exact string reported 3 of 44
held when the answer is 11.

**And the gain is new records, not projects moved.** Of the 12 live Anaheim
projects carrying no fact, exactly one, **Disneyland Resort**, is named anywhere
in the 44 agendas, once. The other eleven are Council contract items
(Aramark Sports, Johnson Controls Fire Protection, Contemporary Services, Great
Scott Tree Service, Good Hope International) and are not Planning Commission
matters at all. **Projects moved off zero by reading the reachable host: 0 to 1.**
What the 30 unread items are worth is 30 new development applications with a
stated acreage, address and CEQA determination, which is a capture gain and has
to be judged as one.

## 6. FOUND, NOT ASKED ABOUT: EVERY ANAHEIM MEETING DATE IS A DAY EARLY

Matching the corpus against what Anaheim publishes, every Planning Commission
record missed its meeting by exactly one day. The city publishes the agenda for
**Monday 15 December 2025**; the record reads **2025-12-14T17:00:00Z**. All 17 PC
records sit at 17:00:00Z, and every one of them is a Sunday.

**17:00:00Z is midnight at UTC+7, which is this machine.** `agenda-portal.ts:375`
reads the date out of the Granicus row as free text and calls

```js
new Date('December 15, 2025').toISOString()
```

`new Date` parses free text, and an ISO datetime carrying no zone, in the
**runtime's local time**. At UTC+7 that is `2025-12-14T17:00:00Z`, and the date
part is what a document prints and what `bestDate` sorts on. An ISO date-only
string is safe, because `new Date('2026-07-13')` is UTC by specification, which
is why this is not everywhere.

Swept rather than assumed, by counting the stored values rather than by reading
the code (`agents/scraper/diagnostics/date-shift-census.ts`, NPM_EXIT=0):

| source | dated records | at local midnight |
|---|---:|---:|
| legistar | 510 | **507** |
| gli_serper | 140 | 107 |
| worldbank | 98 | 89 |
| agenda-portal | 118 | 73 |
| nyc-zap | 43 | **43** |
| iadb | 7 | 2 |
| nyc-ceqr, nyc-city-record, clark-tab, ceqanet, cftod-pdf, sfwmd | 206 | **0** |

**821 of 1,126 dated records.** Per market: Clark County 301 of 349, Broward
County 98 of 98, Anaheim 75 of 78, New York City 51 of 188, Phoenix 40 of 43,
Nashville 40 of 40, Las Vegas 16 of 66, San Antonio 14 of 14, Oakland 14 of 14.

Three sites carry the shape and each was read rather than inferred:
`sources/agenda-portal.ts:375` (free text), `sources/legistar.ts:235` (Legistar
serves `2026-07-13T00:00:00` with no zone), `sources/nyc-zap.ts:131` (the same
shape from the ZAP date columns).

**A 17:00:00Z value is not proof on its own** and the census says so beside the
number: a source could publish at 17:00 UTC. It is proof where the source
publishes a date and not a time, which is every adapter in the first four rows.
The one case verified against the publisher is Anaheim's, above.

**Not fixed here.** It is a one-line change in three places plus a decision about
the 821 rows already stored, and standing rule 2 says a change that moves what a
client document prints gets costed per market first. Logged as golden case
`a-meeting-date-that-is-the-machines-midnight`, guard `pending`.

## 7. THE MARKET STANDARD, AND THE ONE THING THAT WOULD MOVE IT

`npm run verify:market-standard`, NPM_EXIT=0:

```
Anaheim   14 live   11 party   2 facts   0 conditions   0 decision
          below: missing decision [no conditions published here]
```

Anaheim needs three of the four criteria, conditions not being published here.
It has parties on 11 of 14 and the reachable agendas would move the facts column
hard, since `site_acreage`, `site_address` and `cross_streets` are all
`SCHEME_FACT_KINDS`. **They would not move the decision column at all**: of the
44 agendas, **0 are titled ACTION AGENDA and 0 carry any vote language**. They
are the programme, published before the meeting.

**The decision is reachable and it is one file over.** The AgendaCenter
**Minutes** entry for a Planning Commission date is not minutes at all: it opens
with `CITY OF ANAHEIM PLANNING COMMISSION ACTION AGENDA JANUARY 13, 2025`, and
carries the roll call and the vote. **33 of the 44 dates publish one**, and all of
them open from this machine. The Anaheim reader emits none of
`commission_action`, `board_action`, `the_vote` or `nyc_approved`, so nothing in
that file reaches a document today.

So the honest ladder for Anaheim is: capture the reachable agendas (facts), read
the reachable action agendas (decision), and Anaheim clears the standard it is
measured against. Conditions stay Clark's, and no Anaheim document contains one.

## 8. WHAT I PROPOSE

**Do not build a reader.** `anaheim-agenda.ts` reaches 51 of 55 items on
documents it has never been shown. Nothing about it is the constraint.

**Repoint the Planning Commission half of the adapter at `www.anaheim.net`.** The
capture is 44 dates, 33 of them held by nothing, 30 unread items, 188 facts, and
it costs one listing fetch per year plus one PDF per meeting. It needs no runner
and no secret.

**Leave the City Council half where it is.** All 51 blocked records are Council,
Council is not on the reachable host, and the weekly workflow already reaches
`local.anaheim.net` at 200 with 232,143 bytes. That half is scheduled, not
refused, and it is the same relocation reader 2 got.

**Then read the action agenda for the decision**, which is the only criterion
between Anaheim and the standard, and which is reachable today.

**And cost the date fix before it ships.** 821 stored rows change date, in 12
markets, including every market a client document currently covers.
