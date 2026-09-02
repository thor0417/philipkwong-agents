# BRIEF U ITEM 4. THE READERS THAT ADD PROJECTS.

Measured 2026-09-02. Report before proposal, per the brief.

**The short answer: all four ranked readers are refused on evidence. Three were
refused before building; the fourth was built, run, and moved no project.** The ranking they were
drawn from counted PROJECTS. Measured against projects that are the register's
subject and carry no fact today, the whole of item 4 is worth eleven, and the
top-ranked reader is worth none.

Every figure below is from a read paged to exhaustion, with the cap stated where
one applies. Buckets are Brief Q's cached judgement (`holdings-labels.jsonl`,
judge claude-sonnet-5, rubric q1-v1), so they are comparable with item 5.

---

## 1. THE RANKING, RE-MEASURED

| reader | brief said | live projects | in the vertical | already off zero | REAL GAP |
|---|---:|---:|---:|---:|---:|
| 1. Legistar PDF, Broward | 19, all five | 84 | **0** | 0 | **0** |
| 1. Legistar PDF, Phoenix | in the 19 | 20 | **0** | 0 | **0** |
| 1. Legistar PDF, Nashville | in the 19 | 23 | 3 | 0 | **3** |
| 1. Legistar PDF, Oakland | in the 19 | 10 | 1 | 0 | **1** |
| 1. Legistar PDF, Westchester | in the 19 | 1 | 0 | 0 | **0** |
| 2. Las Vegas PrimeGov | 22 | 32 | 3 | 0 | **3** |
| 3. Anaheim Granicus | 9 | 19 | 4 | 1 | **3** |
| 4. Phoenix | 20 | 20 | **0** | 0 | **0** |
| Clark County, for contrast | not ranked | 122 | 16 | 16 | **0** |

27 live projects are newer than the Brief Q judgement and carry no label - Clark
11, Las Vegas 8, Anaheim 5, Nashville 3 - so eleven is a floor rather than a
ceiling. It is not a large floor.

**Clark's gap is zero.** All sixteen of its vertical projects already carry
facts. That is why Clark looks finished and nothing else does, and it is worth
saying because the four readers were ranked to close a gap Clark does not have.

---

## 2. READER 1. REFUSED, AND THE DOCUMENTS ARE NOT THE PROBLEM

The prerequisite ran first. `repair:legistar-docs` re-read every stored Legistar
matter url, because the adapter fix in 74bc134 only corrects rows inside the
incremental bound and a forced twelve-month backfill matched 23 Broward matters
against 97 held. 83 records gained a document, 74 of them Broward, 41 gained a
contact. Broward went from 12 documents to 86 against 97 records.

Then every held document was fetched and run through all three existing field
sets, guarded exactly as the write path guards them. Clark excluded from the
fetch: already read, yield on file at 73%.

| jurisdiction | docs | with text | scans | median chars | reached | facts | projects moved |
|---|---:|---:|---:|---:|---:|---:|---:|
| Broward County | 86 | 86 | 0 | 14,366 | 68 | 183 | **4** |
| Phoenix | 22 | 22 | 0 | **825** | **0** | **0** | **0** |
| Nashville | 21 | 17 | **4** | 8,377 | 5 | 6 | **3** |
| Oakland | 14 | 5 | **9** | 28,981 | 4 | 12 | **2** |
| Westchester County | 2 | 2 | 0 | 13,162 | 0 | 0 | **0** |

**Broward is rich and empty at the same time.** 86 documents, all readable,
183 extractable facts including 23 conditions - and they attach to twelve live
projects, of which four would move. Broward holds 84 live projects and **not one
is a hospitality or entertainment development**; 73 are municipal housekeeping.
Three documents read end to end: an elevator and escalator maintenance contract,
a purchasing award letter to a vendor, and a Performing Arts Center Authority
budget resolution.

**Every project reader 1 would move off zero, with its bucket:**

    development-other   Costco Wholesale                                  Oakland
    development-other   SISTRUNK APARTMENTS, LLC                          Broward
    housekeeping        an application for a Community Support grant      Nashville
    housekeeping        2026 Miscellaneous Planning Code Amendments       Oakland
    instrument          2565 Park Plaza museum                            Nashville
    instrument          24 Street                                         Broward
    instrument          MOTION TO ADOPT Resolution, the title of which... Broward
    instrument          MOTION TO APPROVE plat entitled Park Road Rede... Broward
    UNLABELLED          an application for a Hazard Mitigation Grant...   Nashville

Nine projects. A Costco, an apartment LLC, two grants, a code amendment, a plat
and a street. **None is the subject.**

### The false positive that would have shipped

Standing rule 2's whole point. The CLARK AGENDA SHEET reader, pointed at
Broward, fires `land_use_plan` on **63 of 86 documents, 73%**, and what it
extracts is sentence fragments:

    [land_use_plan] TEXT                    <- LAND USE PLAN TEXT
    [land_use_plan] amendment is required, the 62
    [land_use_plan] OF THE BROWARD COUNTY COMPREHENSIVE PLAN WITHIN 3

The PROSE field set on the same documents is clean:

    [site_acreage]  289.9                   <- Approximately 289.9 acres
    [floor_area]    6,000,000               <- 6,000,000 square feet
    [site_acreage]  2,190                   <- 2,190 acres

So if a Broward lane is ever built it routes to the prose set and never to the
Clark form reader. Recorded here because the measurement is the expensive part
and it has now been paid for.

### And the title reader does not transfer

`clark-ordinance-title` is called "the most transferable idea in the whole
reader set" in READER-INVENTORY.md and has never been tested outside Clark.
Measured against every non-Clark Legistar document and title in the corpus: it
yields **zero** facts in every jurisdiction. The claim does not hold.

---

## 3. READER 4, PHOENIX. REFUSED TWICE OVER

22 documents, every one readable, **median 825 characters**, and not one of the
three field sets reaches any of them. They are the liquor-licence data sheets
the Broward diagnosis predicted, and the diagnosis's other prediction is
confirmed by the adjacent column: Phoenix carries 37 contacts and **1** contact
block, so the parties come from the record text and the documents name nobody.

Separately, Phoenix holds 20 live projects: **0 in the vertical, 18 instruments,
2 developments outside it.**

There is nothing to read and nothing worth moving. Reader 4 is closed.

---

## 4. READER 2, LAS VEGAS. BLOCKED, AND THE PROJECTS HAVE NO DOCUMENTS EITHER

Probed from this machine 2026-09-02, both the API and the portal:

    lasvegas.primegov.com/api/v2/PublicPortal/ListArchivedMeetings  403, 4,548 bytes
    lasvegas.primegov.com/Portal/Meeting?meetingTemplateId=...      403, 4,548 bytes

Cloudflare, exactly as BRIEF-S-ITEM-4-EGRESS.md recorded, and the same 4,548
bytes it recorded. It needs the hosted runner and the brief is right about that.

But the more useful finding is one level in. Las Vegas's three vertical projects
with no fact are **Top Gun Las Vegas**, **Las Vegas corridor anchors** and
**Jackson-Shaw Company hotel**, and every one of them carries **no document at
all**: seven `gli_serper` press records between them, plus two `agenda-portal`
abeyance items. So reader 2 is not a reader over documents we hold. It is a
capture that has to reach a blocked host first and find documents that are not
in the corpus yet.

---

## 5. READER 3, ANAHEIM. THE BEST OF THE FOUR. IT WAS RUN AND IT MOVED NOTHING

**Anaheim is half reachable from this machine, and the half matters.** Probed
2026-09-02, and consistent with the egress work:

    anaheim.granicus.com        reachable. Served a 223,046-byte PDF, magic %PDF-1.7
    www.anaheim.net             reachable. AgendaCenter answers 200, 414,410 bytes
    local.anaheim.net           fetch failed, every attempt
    records.anaheim.net         fetch failed, every attempt

BRIEF-S-ITEM-4-EGRESS.md already measured why: the two city-owned hosts drop
packets to this egress and answer 200 from Google Cloud us-west1. It also
records the finding this confirms - the Anaheim loss is not Anaheim, it is
Anaheim CITY COUNCIL specifically, because the Planning Commission half arrives
over Granicus and has all along.

So: **the Planning Commission half of reader 3 can be done here today. The City
Council half needs the runner.** The brief's "2 and 3 need the hosted runner" is
right for reader 2, right for half of reader 3, and wrong for the other half.

Anaheim already has a working reader - `anaheim-agenda.ts`, 9 fact kinds, wired
to `capture:filings --lane anaheim` - and 21 of its 75 records carried a document
while 54 did not. The 54 are stale captures: the current adapter sets
`hasPrimaryDocument: true` on every lead it derives. So the work looked like a
re-run and the existing reader, not new code.

### IT WAS RUN. IT MOVED NOTHING, AND THAT IS THE RESULT

`npm run scrape:government -- --source=anaheim-agendas`, NPM_EXIT=0. 53
Council/Planning meetings listed, **15 records written, 18 primary documents, 14
joined an existing project, 1 to the Inbox**. Then
`capture:filings --lane anaheim`, NPM_EXIT=0, over 73 records in scope:

    forms   no-document 51, anaheim-agenda 16, form-not-supported 5,
            anaheim-item-not-on-agenda 1
    result  16 records with facts (22%), 77 facts

    per field, over the 17 records the reader reads
      application_no  94%    ceqa_class      41%
      case_planner    94%    cross_streets   35%
      environmental   71%    site_address    29%
      site_acreage    59%    action_sought   18%

**Sixteen records with facts before, sixteen after. The vertical gap is still
three. No project moved off zero.**

The re-run adds new records; it does not repair old ones. A record is upserted on
its url, and the 51 document-less rows are captures whose url the current listing
does not reproduce - the adapter lists meetings from 2025 onward and re-derives
item urls from agenda text that has since changed. The Legistar half of this
needed a purpose-built repair pass for exactly the same reason, and Anaheim would
need its own.

And the repair would not reach the three projects anyway:

    GardenWalk Hotel II            3 agenda records, no document on any of them
    515 W. Katella Avenue resort   1 agenda record, no document
    Disneyland Resort              1 document, and it is the Spanish agenda

Where Anaheim's records DO sit is worth recording, because it locates the gap:

    record url host          records   with a document
    anaheim.granicus.com          66                15
    www.anaheim.net                7                 7

So the 51 are Granicus-hosted, and Granicus is reachable from here. This is not
an egress gap. It is a re-derivation gap on our side, and it is worth at most
three projects.

### And a trap underneath it

Of Anaheim's three vertical projects with no fact:

- **GardenWalk Hotel II** - 3 agenda records, **no document on any of them**.
- **515 W. Katella Avenue resort** - 1 agenda record, **no document**.
- **Disneyland Resort** - 5 records, one document, and that document is the
  **Spanish-language agenda**: 10 pages, 31,912 characters, titled
  `8. Determinar que, sobre la base de la evidencia presentada`. The English
  record for the same item carries no document.

`agenda-portal.ts` holds the Spanish duplicate back and stores it only when
nothing else resolves, which is a deliberate and documented fallback. The reader
refuses a Spanish agenda outright, which is also correct. Together they produce
a record that holds a document, counts as covered, and can never yield a fact.
Golden case `the-only-document-we-hold-is-the-one-the-reader-must-refuse`.

---

## 6. FOUND, NOT ASKED ABOUT

1. **13 of 37 non-Clark Legistar documents outside Broward and Phoenix are
   image-only scans with ZERO extractable characters** - 9 of Oakland's 14, 4 of
   Nashville's 21. Zero parse failures, zero fetch failures: `pdf-parse` returns
   cleanly and the pages are empty. 3 pages / 0 chars at 407,332 bytes. 35 pages
   / 0 chars at 2,687,216 bytes. **Oakland's document ceiling is 5 of 14 and the
   publisher sets it by scanning paper.** OCR is the only route and no reader can
   move it. READER-INVENTORY.md ranks build work on a count that includes all 13.
   Golden case `a-scanned-page-counted-as-a-document-we-hold`.

2. **86 Broward documents attach to 12 live projects.** The ratio, not the count,
   is what bounds a reader, and nothing reports it.

3. **`report-entry` cites `primary_document_url` as the document and never
   consults `has_primary_document`.** Measured over 1,649 undismissed rows: 720
   carry a document url, the 443 with the flag true are all fetched files, and
   none of the other 277 is. The two agree exactly - by accident of how each
   adapter writes them, and nothing requires it. Folded into the existing pending
   case rather than opened as a new one.

4. **NYC City Record's documents are `.docx`**, probed at 42,028 bytes with magic
   `PK`. `fetchPdfPages` is the only document reader in the tree, so those five
   records hold a document nothing here can open.

---

## 7. WHAT I PROPOSE

**Refuse readers 1, 2 and 4.** Each on measurement, each recorded above.

**Reader 3 was done and is also refused.** The re-run cost a full Anaheim pass
and moved no project off zero. What remains for Anaheim is an
Anaheim-specific document repair pass, worth at most three projects, and two of
those three need a document that has never been captured rather than one we hold.
It is the best of the four and it is still not worth doing before item 5.

**Run item 5 before any further reader work.** Item 5 tombstones 116 of 340 live
projects and 73 of them are the Broward housekeeping that reader 1's largest
share targets. Building a reader for them and then removing them is work in both
directions.

**The eleven are not a reader problem.** Three need a fetch from a blocked host,
three need a fetch Anaheim can serve today, two are scans that need OCR, one is
a Spanish document we chose over the English one, and two are press records with
no filing behind them at all. Not one of the eleven is waiting on a parser.
