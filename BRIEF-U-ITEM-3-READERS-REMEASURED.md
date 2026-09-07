# BRIEF U ITEM 3. THE FOUR READERS, RE-MEASURED AFTER THE CLEANOUT.

Measured 2026-09-07, against the corpus as it stands after 88 tombstones. The
earlier pass is `BRIEF-U-ITEM-4-READERS.md`, measured 2026-09-02; this replaces
its numerator and its denominator and **corrects one of its conclusions**.

Every figure is from a read paged to exhaustion. No cap.

---

## 0. THE SHORT ANSWER

**Re-running the reader that already exists closed more of the gap than any of
the four would have.** `capture:filings --lane clark` moved three vertical
projects off zero for the cost of a re-run, because the Clark reader had never
been run over the records captured on 2026-09-02.

**The gap is now 15 projects, and 12 of them are not waiting on a parser.** Two
are image-only scans, five hold no document at all, three hold a url that is a
listing page rather than a document, and two are press records with no filing
behind them.

**Exactly one project in the whole corpus is waiting on a reader being written.**

**Readers 2 and 3 are not refused. They are relocated.** Both need the hosted
runner, both hosts already answer 200 there, and the weekly workflow built in
item 5 IS a hosted runner. That changes them from blocked to scheduled.

---

## 1. THE DENOMINATOR MOVED, WHICH IS WHY THIS WAS RE-RUN

| | before the cleanout | after |
|---|---:|---:|
| live projects | 354 | **272** |
| hospitality developments | 49 | **44** |
| build no entry at all | 77 | **0** |
| vertical projects carrying a fact | 26 | **29** |
| **the real gap** | 18 | **15** |

The three that closed are Clark County's, and they closed on a re-run rather
than on new code. See section 2.

## 2. THE GAP, PER MARKET, AFTER THE CLEANOUT AND AFTER THE RE-RUN

| market | live | vertical | vert. with a fact | REAL GAP | docs held | url is a file |
|---|---:|---:|---:|---:|---:|---:|
| Clark County | 120 | 20 | **20** | **0** | 313 | 313 |
| New York City | 40 | 8 | 8 | **0** | 72 | 2 |
| Anaheim | 14 | 4 | 1 | 3 | 51 | 18 |
| Las Vegas | 24 | 3 | 0 | 3 | 31 | **0** |
| Nashville | 22 | 3 | 0 | 3 | 20 | 20 |
| (no market) | 6 | 2 | 0 | 2 | 0 | 0 |
| Oakland | 8 | 1 | 0 | 1 | 11 | 11 |
| Downtown Brooklyn | 1 | 1 | 0 | 1 | 0 | 0 |
| Los Angeles | 1 | 1 | 0 | 1 | 0 | 0 |
| Missoula | 1 | 1 | 0 | 1 | 0 | 0 |
| Broward County | 12 | **0** | 0 | **0** | 11 | 11 |
| Phoenix | 20 | **0** | 0 | **0** | 19 | 19 |
| **all** | **272** | **44** | **29** | **15** | | |

**"url is a file" is an upper bound on what any reader could read, not a count
of readable documents.** `lib/document-shape` answers "is this a fetched file or
a page that lists files"; it cannot see whether the file has a text layer, and 13
of 37 non-Clark Legistar documents measured on 2026-09-02 are image-only scans
with zero extractable characters. Golden case
`a-scanned-page-counted-as-a-document-we-hold`.

**A correction to my own first cut of this table.** It counted a project's
"docs" as records carrying a `primary_document_url`, which made Anaheim's three
gap projects look as though they held five, three and one document. They hold
Granicus `AgendaViewer.php` urls, which `has_primary_document` already says false
about. The column above is the honest one.

---

## 3. READER 1. THE LEGISTAR ATTACHMENT PDF READER.

**Records read, facts extracted, projects moved off zero: 3, 0, 0.**

The 2026-09-02 pass fetched every non-Clark Legistar document in the corpus and
ran all three field sets over them - Broward 86 documents / 183 facts, Nashville
21 / 6, Oakland 14 / 12, Phoenix 22 / 0, Westchester 2 / 0. That measurement
stands and was not repeated. What was re-measured is what is **left to move**,
because the cleanout removed 72 Broward projects and the reader's largest share
of documents attached to them.

After the cleanout, exactly **three** vertical projects sit in a Legistar
jurisdiction with no lane and hold a document that is a real file. All three were
fetched and run through every existing field set, guarded exactly as the write
path guards them:

| project | market | pages | extractable characters | recognised by | facts |
|---|---|---:|---:|---|---:|
| Nashville Riverfront Amphitheater | Nashville | 62 | **147,784** | none | 0 |
| 1222 Demonbreun Street | Nashville | 8 | **7** | none | 0 |
| Museum Of Jazz & Art | Oakland | 3 | **2** | none | 0 |

**Two of the three are image-only scans.** Eight pages yielding seven characters
and three pages yielding two. No parser reaches those; OCR is the only route and
it is not a reader.

**The third is a 147,784-character document that no existing field set
recognises.** It is a real, readable, 62-page Nashville ordinance package. Moving
it means writing a Nashville reader from scratch, measured against one document.

**The fourth Nashville gap project, the KKR stadium venture, holds no document at
all.** Two press records and nothing filed.

**VERDICT: refused, and now for a sharper reason than before.** Reader 1 is worth
**one project**, and that project needs new code written against a single
document. It emits no condition and would emit none: only Clark's agenda sheet
publishes a per-project condition, confirmed again below.

### And the thing that DID work

`npm run capture:filings -- --lane clark --write`, **NPM_EXIT=0**:

```
lane     records   with facts   facts   forms
clark        341    256 (75%)    3818   clark-agenda-sheet 194, form-not-supported 84,
                                        clark-ordinance-title 62, unreadable-scan 1
```

The corpus held facts on 221 Clark records and the reader reads 256. The
difference is records captured on 2026-09-02 that the reader had never been run
over. Writing it **moved Clark's gap from 3 to 0**: V L V 1 resort, Grand Flamingo
Capital Management and S4A004 hotel all now carry facts.

That is the whole of item 3's gain, and it came from a command rather than a
build.

---

## 4. READER 2. LAS VEGAS PRIMEGOV. NOT REFUSED - RELOCATED.

**Records read, facts extracted, projects moved off zero: 0, 0, 0, from here.**

Re-probed 2026-09-07 from this machine:

```
403  4,549 bytes  lasvegas.primegov.com/api/v2/PublicPortal/ListArchivedMeetings?year=2025
403  4,549 bytes  lasvegas.primegov.com/Portal/Meeting?meetingTemplateId=40662
```

The same Cloudflare block and the same byte count recorded on 2026-09-02 and in
`BRIEF-S-ITEM-4-EGRESS.md`. Unchanged.

**Las Vegas holds 31 document urls and ZERO of them is a file.** Every one is a
PrimeGov `Portal/Meeting` page. So this is not a reader over documents we hold:
it is a capture that has to reach a blocked host first.

Its three gap projects are **Top Gun Las Vegas** (9 records, no document),
**Las Vegas corridor anchors** (2 records, no document) and **Jackson-Shaw
Company hotel** (2 records, both portal pages).

### It only runs on the hosted runner, and that is now a scheduled thing

`BRIEF-S-ITEM-4-EGRESS.md` section 8, measured on the GitHub runner 2026-08-27,
**AS8075 Microsoft Corporation**:

| target | code | bytes | body |
|---|---:|---:|---|
| Las Vegas PrimeGov | **200** | 187,325 | real meeting JSON |

**What that means for the cadence.** The weekly workflow built in item 5 runs
`npm run scrape:government` on `ubuntu-latest`. Las Vegas is in the government
lane's adapter table already. So the first scheduled Monday run captures Las
Vegas without anything further being built, and this machine will never see it.
Two consequences worth stating rather than discovering:

1. **Las Vegas records will appear in the corpus that no local run can reproduce.**
   A developer re-running the lane here will get `403` and `kept 0`, and the
   per-market health row will read `silent` for Las Vegas on that run. That is
   correct and it will look like a regression.
2. **The cadence is now the only path to three of the thirteen markets.** Las
   Vegas, San Antonio and Anaheim City Council are runner-only. A week the
   workflow does not run is a week those three are not read at all.

---

## 5. READER 3. ANAHEIM GRANICUS. THE PRIOR CONCLUSION WAS WRONG.

**Records read, facts extracted, projects moved off zero: 73, 77, 0.**

`npm run capture:filings -- --lane anaheim`, **NPM_EXIT=0**:

```
lane        records   with facts   facts   forms
anaheim          73     16 (22%)      77   no-document 51, anaheim-agenda 16,
                                           form-not-supported 5, anaheim-item-not-on-agenda 1
```

Sixteen records with facts before, sixteen after. Identical to the 2026-09-02
run. **No project moved off zero**, and the three that would have to move are
Disneyland Resort, GardenWalk Hotel II and 515 W. Katella Avenue resort.

### THE CORRECTION

`BRIEF-U-ITEM-4-READERS.md` concluded:

> So the 51 are Granicus-hosted, and Granicus is reachable from here. **This is
> not an egress gap.** It is a re-derivation gap on our side.

**That is wrong, and the redirect is why.** Probed 2026-09-07:

```
$ curl -I "https://anaheim.granicus.com/AgendaViewer.php?view_id=2&clip_id=3570"
HTTP/1.1 302 Found
Location: https://local.anaheim.net/docs_agend/questys_pub/48837/Agenda.html
```

**The Granicus AgendaViewer is a redirector, not a host.** It answers 302 with a
14-byte body and points at `local.anaheim.net`, which drops packets to this
egress on both ports with no RST. The earlier probe measured a Granicus
`DocumentViewer.php?file=...pdf` url - which genuinely is Granicus-served, 223,046
bytes - and generalised from it to the AgendaViewer urls, which are not.

So the 51 document-less Anaheim records are **an egress gap after all**, and they
are the same egress gap as Las Vegas. Confirmed today from here:

```
302     14 bytes  anaheim.granicus.com/AgendaViewer.php   -> local.anaheim.net
200 416,425 bytes  www.anaheim.net/AgendaCenter
000      0 bytes  local.anaheim.net
000      0 bytes  records.anaheim.net
```

And on the runner, `BRIEF-S-ITEM-4-EGRESS.md` section 8:

| target | code | bytes | body |
|---|---:|---:|---|
| `local.anaheim.net` City Council agenda | **200** | 232,143 | the real agenda |

**VERDICT: reader 3 needs no new reader.** `anaheim-agenda.ts` exists, reads 9
fact kinds and fires on 94% of the records it can see. What it needs is the
document, and the document is one redirect away on a host only the runner
reaches. It is the same relocation as reader 2 and it costs no new code:
following the 302 is what an adapter fetch already does when it can reach the
target.

---

## 6. READER 4. PHOENIX. CLOSED, AND NOW CONCLUSIVELY.

**Records read, facts extracted, projects moved off zero: 0, 0, 0.**

Phoenix holds **20 live projects and ZERO in the vertical**. There is no gap to
close. The 2026-09-02 measurement already found its 22 documents to be liquor
licence data sheets at a median of 825 characters that no field set reaches; the
cleanout has now removed the question entirely, because nothing Phoenix holds is
the register's subject.

Broward is in the same position after the cleanout: **12 live projects, zero in
the vertical, gap zero.**

---

## 7. CONDITIONS. STILL ONE JURISDICTION, AND THE CLAIM IS RE-COUNTED.

Brief U: "None of these emits a condition today; say so plainly if that changes."
**It has not changed.** Counted from stored facts over every record attached to a
live project, not asserted:

| source | records | condition facts |
|---|---:|---:|
| legistar | 374 | **1,257** |
| agenda-portal | 79 | 0 |
| gli_serper | 63 | 0 |
| clark-tab | 41 | 0 |
| nyc-city-record | 29 | 0 |
| nyc-ceqr | 26 | 0 |
| nyc-zap | 17 | 0 |
| cftod-pdf | 13 | 0 |
| ceqanet | 4 | 0 |
| govdoc | 1 | 0 |

Every one of the 1,257 is Clark County's, through `clark-agenda-sheet`. No other
jurisdiction in this corpus publishes a per-project condition, so no reader built
for one could emit one.

---

## 8. WHAT I PROPOSE

1. **Nothing is built for readers 1 and 4.** Reader 1 is worth one project and
   needs new code against one document; reader 4 has no subject left.
2. **Readers 2 and 3 ship by running the cadence.** Both need the hosted runner,
   both hosts answer 200 there, and item 5's workflow already calls the
   government lane on `ubuntu-latest`. The first scheduled Monday run is the
   measurement, and item 4's fresh run from this machine will NOT show it.
3. **Record that three markets are runner-only.** Las Vegas, San Antonio and
   Anaheim City Council cannot be captured from a developer machine at all. A
   local run reporting `kept 0` for them is correct and must not be read as a
   regression - the same rule the scorecard applies to a BLOCKED cell and the
   same rule that moved `verify:staleness` off the pre-push hook.
4. **The next reader worth building is not on this list.** 15 gap projects, and
   the largest single cause is a document we never captured rather than one we
   cannot parse.
