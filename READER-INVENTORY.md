# THE READER INVENTORY

Part 2C. Measured 2026-08-27 against the live corpus and the source tree.

Every reader, what document shape it takes, what fact kinds it emits, and what
it is wired to. Then the gap: what we hold and cannot read.

Corpus reads below are PAGED, not capped. PostgREST returns 1,000 rows by
default and this repository has been bitten by that silently before, so the
market breakdown pages through all 1,604 admitted leads and every per-market
figure is a `count=exact` with a filter rather than a row read.

---

## 1. THE INVENTORY

Seven files in `agents/scraper/readers/`. One of them is not a reader.

| File | Lines | Document shape it takes | Fact kinds | Wired to |
|---|---|---|---|---|
| `core.ts` | 247 | none, this is the shape and the guard | defines all 65 | every reader |
| `clark-agenda-sheet.ts` | 462 | Clark County labelled agenda sheet, PDF | 28 | `capture:filings --lane clark` |
| `nyc-records.ts` | 323 | ZAP / CEQR / City Record captured `raw_content` header | 32 | `capture:filings --lane nyc`, `verify-golden` |
| `anaheim-agenda.ts` | 247 | Anaheim PC and CC action agenda | 9 | `capture:filings --lane anaheim` |
| `oakland-ordinance.ts` | 164 | Oakland ordinance and agenda report, prose PDF | 14 | `capture:filings --lane oakland` |
| `cpc-report.ts` | 179 | NYC City Planning Commission report, PDF | 2 | `capture:cpc` |
| `clark-ordinance-title.ts` | 123 | **a title string, no document at all** | 5 | `capture:filings` |

`core.ts` declares 65 `FilingFactKind` members and every one of them is emitted
by some reader. No reader emits a kind the union does not declare. The
vocabulary and the readers are in sync, which is worth stating because it is the
one part of this inventory with nothing wrong with it.

### The two readers that are not like the others

**`clark-ordinance-title.ts` reads a title, not a document.** It exists because
Clark's 197 land-use cases publish a staff report 100% of the time and carry
2,802 facts, while its ORD and AG instruments publish a document 13% of the time
and carry zero. The facts are in the title and the title is already stored, so
65 of 112 ordinance and agreement titles yield a fact with no fetch at all. It
emits `counterparty`, `cross_streets`, `project_type`, `site_acreage` and `town`.

This is the most transferable idea in the whole reader set and nothing else uses
it. Every market that files instruments with descriptive titles is a candidate,
and none has been tried.

**`cpc-report.ts` deliberately reads almost nothing.** Two kinds,
`commission_action` and `the_vote`. Its header records the measurement behind
that restraint: the Clark conditions extractor run over three real CPC reports
returned 0, 5 and 0 conditions, and the 5 were an accident of one report
containing a literal `CONDITIONS:` line. Clark publishes an administrative
checklist; New York publishes prose. A reader that borrowed the other's
vocabulary would have produced confident nonsense.

---

## 2. WHAT THEY ARE WIRED TO, WHICH IS THE FINDING

**No live capture lane invokes any reader.**

    grep for readers/ and filing-facts across
      orchestrator.ts  government.ts  gli.ts  opportunity.ts
    -> NONE. No live lane imports a reader.

Every reader is reachable from exactly two places, and both are hand-run
migrations:

    npm run capture:filings     migrations/capture-filing-facts.ts   (migration 035)
    npm run capture:cpc         migrations/capture-cpc-reports.ts

So a capture run fetches records, clusters them into projects and writes them,
and produces **no filing facts whatsoever**. Facts enter the corpus only when a
person remembers to run a migration afterwards.

**This is a defect in the weekly cadence proposed in Brief S item 5, and I am
correcting that proposal here.** The cycle I wrote has capture at steps 1 to 3
and goes straight to health at step 4. A weekly run built that way would capture
new Clark County agenda sheets every Monday and read none of them, so every
document generated after the first would carry new records with no conditions,
no acreage, no hearing dates and no counterparties. `capture:filings` has to be
step 3b, before clustering settles and well before anything is generated.

---

## 3. THE GAP, MEASURED

1,604 admitted leads. 309 carry a primary document. 417 carry filing facts.

Only four markets have any facts at all, and they are exactly the four markets
with a reader:

| Market | Admitted | With a document | With facts | Fact rate |
|---|---|---|---|---|
| Clark County | 303 | 245 | 221 | 73% |
| New York City | 187 | 5 | 175 | 94% |
| Anaheim | 78 | 21 | 16 | 21% |
| Oakland | 14 | 11 | 5 | 36% |

New York's 94% off five documents is the `nyc-records` re-read of captured text
doing its job: New York has no documents and the facts are in the header our own
adapters wrote.

### Documents we hold and cannot read

**27 documents, four markets, no reader for any of them.**

| Market | Admitted | Documents held | Facts | What the document is |
|---|---|---|---|---|
| Central Florida Tourism Oversight District | 14 | **14** | 0 | CFTOD board agenda packets, already fetched and paged |
| Nashville | 38 | **10** | 0 | Metro grant and agenda attachments via Legistar |
| Westchester County | 2 | **2** | 0 | Legistar attachment |
| Phoenix | 1 | **1** | 0 | liquor-licence data sheet |

CFTOD is the sharpest of these. `adapter:cftod-pdf` fetched 29 and kept 29 on its
last run, and `source_health` records individual packets being read at 533, 406,
341 and 311 pages for 4, 8, 7 and 10 kept records. We are paging hundreds of
pages of Disney-district board packets, storing the documents, and extracting no
facts from any of them, because nobody has written the reader.

### Markets with records and no documents at all

| Market | Admitted | Documents | Why |
|---|---|---|---|
| Las Vegas | 70 | 0 | Cloudflare, see BRIEF-S-ITEM-4-EGRESS.md |
| Broward County | 97 | 0 | Legistar attachments not fetched |
| San Antonio | 15 | 0 | retired market, dead Legistar feed |
| Miami-Dade County | 6 | 0 | retired market, dead feed |

Broward is the largest unexamined number in this table. 97 admitted records,
zero documents, no reader, and no diagnosis on file for why its Legistar
attachments are not being fetched when Clark's are.

### And the 632, which is not what it looked like

**632 admitted leads carry a null market**, 39% of the corpus. My first reading
of that number was that it caps what migration 044 can ever report. **Measured,
it does not, and the correction matters more than the original claim.**

Broken down by source, paged, all 632 read:

    tedeu        261     canadabuys  38     iadb          12     ungm      2
    worldbank    148     tenderned   25     adb           10     others    6
    gli_serper    78     uktenders   14     intake-agent   9     ceqanet   1
                         adzuna      13     austender     13

Their locations are Netherlands, Kenya, the Kyrgyz Republic, Armenia, Rwanda,
Zambia, Albania, El Salvador, Somalia. These are the EU, World Bank and
multilateral TENDER lanes, which are global by design and were never going to
carry a US market.

**Exactly one of the 632 comes from a government-lane adapter**, a single
CEQAnet record. The per-market health verdict that 044 enables is a
government-lane question, so 044's usefulness is essentially unaffected. The
honest figure is 1, not 632.

Three real things do sit inside that number:

- **78 `gli_serper` records with no market**, which is the intelligence lane
  aiming outside the covered markets. Consistent with the standing measurement
  that only 12% of press records touch a covered market.
- **106 leads carry neither a market nor a location.** Unplaceable by any means.
- **18 leads come from `adzuna`, `reed`, `jooble` and `careerjet`**, which are
  the RETIRED `agents/lead-scraper` lane. Records from a retired lane are still
  admitted and still counted in every corpus total.

And only **16 of 632** attach to a project at all, which is the more useful way
to say it: these rows are tender noise sitting in the same table as the register,
not a hole in market attribution.

---

## 4. WHAT IT COSTS TO BRING A MARKET TO STANDARD

Which is the question this inventory exists to turn into a lookup.

The answer has three tiers, and they differ by roughly an order of magnitude
each.

**Tier 1, no reader needed: reuse a title reader.** If the market files
instruments with descriptive titles, `clark-ordinance-title` is the template and
the work is a vocabulary pass, not a parser. No fetch, no PDF, no document.
Cheapest possible route and it has never been attempted outside Clark.

**Tier 2, a reader against a form.** The market publishes one repeating
structured document, as Clark does. `clark-agenda-sheet` is 462 lines and
returns 28 kinds at a 73% fact rate. This is the expensive-but-known route, and
its precondition is that the publisher has a form at all. Measured across 155
readable documents, Clark was the only one of seven jurisdictions that did.

**Tier 3, a reader against prose.** Anaheim and Oakland. 164 to 247 lines for 9
to 14 kinds, and both headers record the measurement that had to come first:
Anaheim yields CEQA at 90% and acreage at 90% but zero rooms, seats, parking or
units, and Oakland answers what was agreed and for how much but never how big
the building is. **The measurement pass is the majority of the cost.** Both
readers refuse specific measured false positives, and Anaheim's are instructive:
"street address" hits 100% of its agendas and the address is the council chamber
at 200 South Anaheim Boulevard, and "N feet" hits 40% and is a distance to a
cross street. A reader written without measuring first would have put city hall's
address under every Anaheim project and printed a 1,075-foot building.

**So the honest cost model is: measure the corpus of documents first, and only
then decide which tier applies.** Every existing reader was written that way and
every one of them documents the false positives the measurement caught. None of
them was written from a guess about what the publisher might print.

---

## 5. FOUND, NOT ASKED FOR

1. **No live lane calls a reader.** Facts are a hand-run migration. Any hosted
   cadence that omits `capture:filings` produces documents whose new records
   carry no facts, and nothing would report that as a failure.
2. **CFTOD: 14 of 14 records carry a document and none is read.** We are paging
   500-page board packets for the Disney district and extracting nothing.
3. **632 of 1,604 admitted leads have a null market**, 39% of the corpus, and
   631 of them are global tender and intelligence lanes that were never going to
   carry a US market. Only one is a government-lane record. 044 is not capped by
   this. 18 of the 632 come from the RETIRED `agents/lead-scraper` lane and are
   still counted in every corpus total.
4. **Broward County has 97 records and zero documents** with no diagnosis on
   file, while Clark's Legistar attachments fetch fine. Same platform, different
   outcome, unexamined.
5. **`clark-ordinance-title` is the cheapest reader in the set and has never
   been generalised.** It reads stored text, needs no fetch, and yields facts on
   58% of the instruments it sees.
6. **`market-checklist.md` does not exist in this repository.** The file the
   brief describes is `MARKET-CHECKLIST.md` in the separate
   `bc-construction-pipeline` repository, it is a four-rule document from the
   Squamish work rather than a grid, it has no markets as rows, no layers as
   columns and no question marks in it, and the "ten universal layers" are not
   defined in either repository. See section 6.

---

## 6. THE SCORECARD CANNOT BE FILLED YET, AND WHY

Part 2A says `market-checklist.md` "has a row per market and a column per layer,
and most cells are a question mark", and asks for every cell to be answered
FIELD, DOC, BLOCKED or NONE.

Searched both repositories. What exists is
`OneDrive/Documents/bc-construction-pipeline/MARKET-CHECKLIST.md`, 124 lines,
titled OPENING A NEW MARKET. It holds four rules that came out of Squamish, each
with a golden case: a relevance ranker's first result is not a match, a permit
field may hold several parties separated by a line break, a typo in the record is
the record, and a list of Squamish-specific measurements that must not be carried
to another market. It is a good document. It is not a grid, it contains no
markets as rows, no layers as columns, and no question marks, and it is about
the BC construction vertical rather than hospitality.

The four ANSWERS are specified in the brief. **The ten LAYERS are not defined
anywhere in either repository.** Without them the measurement pass has no axis,
and inventing ten plausible ones would produce a filled grid measuring something
Philip did not ask about, at the cost of a full pass across thirteen markets.

This section is therefore a report and not a refusal. Section 4 above is most of
the raw material the grid would need, and the moment the ten layers are named the
pass can run against the markets in section 3.
