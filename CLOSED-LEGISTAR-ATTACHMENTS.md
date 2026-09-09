# TWO CLOSED QUESTIONS ABOUT LEGISTAR ATTACHMENTS.

Measured 2026-09-09 by `agents/scraper/diagnostics/attachment-text-and-conditions.ts --fetch`,
NPM_EXIT=0. Every attachment fetched, nothing capped, nothing written.

**POPULATION, stated once and used throughout:** `leads.source = 'legistar'`,
`status <> 'dismissed'`, and `primary_document_url` classified as a **file**
rather than a listing by `lib/document-shape`. Paged to exhaustion.

    attachments, all jurisdictions   444
    Clark County                     298
    every other jurisdiction         146

Clark is excluded from the fetch: it is already read, its yield is on file, and
re-fetching 298 documents to confirm a number this repo already holds is cost
with no answer attached. **143 of the 146 non-Clark attachments were fetched.**
Three failed, and that is a finding of its own (section 3).

---

## 1. CLOSED: LEGISTAR ATTACHMENTS DO NOT CARRY CONDITIONS ANYWHERE

This was an assumption for two weeks - that a generic Legistar attachment reader
would eventually reach conditions of approval the way Clark's does. It is now
measured and it is false.

**143 non-Clark attachments fetched and run through every existing field set,
each behind its own recogniser and through the same all-or-nothing guard the
write path applies. Conditions extracted: ZERO.**

    documents yielding a condition : 0 of 143
    condition facts in total       : 0

And what they DID reach, which is the other half of why this is closed:

| jurisdiction | fetched | reached by a reader | facts | reader that fired |
|---|---:|---:|---:|---|
| Broward County | 85 | 2 | 4 | oakland-ordinance |
| Oakland | 14 | 2 | 7 | oakland-ordinance |
| Nashville | 20 | 0 | 0 | - |
| Phoenix | 22 | 0 | 0 | - |
| Westchester County | 2 | 0 | 0 | - |

**Clark's conditions do not come from this lane.** The corpus holds **1,474**
condition facts and every one is Clark's, produced by `clark-agenda-sheet` - a
reader written against ONE county's administrative form which happens to be
delivered as a Legistar attachment. The delivery mechanism is not the source of
the facts. A lane that fetched every attachment in every jurisdiction would find
none of them, because no other jurisdiction publishes the form.

### A number from the earlier pass does not reproduce, and the reason matters

`BRIEF-U-ITEM-4-READERS.md` recorded "Broward 86 documents, 183 extractable
facts including 23 conditions". Against the same documents today, Broward
reaches **2 documents and 4 facts**.

The difference is the RECOGNISER. That pass ran the Clark field set directly at
Broward text and reported what the patterns matched - which is how it also found
`land_use_plan` firing on 63 of 86 with sentence fragments, and recorded that as
"the false positive that would have shipped". This pass runs
`isClarkAgendaSheet` FIRST, as the write path does, and Broward's documents are
not Clark agenda sheets, so the reader never runs at all.

Both numbers are correct answers to different questions. **The one that decides
whether to build a lane is this one**, because it is what the write path would
actually store.

---

## 2. CLOSED: THE SCANS ARE A SCANNED-DOCUMENT PROBLEM, NOT A READER PROBLEM

**12 of 143 fetched non-Clark attachments carry no drawable text.**

| jurisdiction | fetched | with text | NO TEXT | median chars |
|---|---:|---:|---:|---:|
| Oakland | 14 | 5 | **9** | **6** |
| Nashville | 20 | 17 | **3** | 7,797 |
| Broward County | 85 | 85 | 0 | 12,366 |
| Phoenix | 22 | 22 | 0 | 825 |
| Westchester County | 2 | 2 | 0 | 13,162 |
| **all** | **143** | **131** | **12** | |
| of which on a project the register still holds | 62 | 51 | 11 | |

**THE THRESHOLD DOES NO WORK, WHICH IS THE STRONGEST FORM THIS ANSWER COULD
TAKE.** The line was set at 200 characters. The twelve documents below it run
from **1 to 34 characters** across 2 to 35 pages. The next document up is
**576**. There is nothing between 34 and 576, so any threshold in that range
gives the same twelve. This is not a judgement call about where to draw a line;
it is two populations with a gap between them.

The twelve, in full:

    1 char  /  2 pages  Oakland    MOU Between OPD And Santa Clara Police
    2 chars/  3 pages  Oakland    Transient Occupancy Tax Sharing Agreement
    2 chars/  3 pages  Oakland    Atthowe Fine Arts Services Contract
    2 chars/  3 pages  Oakland    Fire Alarm Building / Museum Of Jazz And Art
    3 chars/  4 pages  Oakland    Construction Contract Award To S.J.
    3 chars/  4 pages  Oakland    Sale Of 319 Chester Street
    3 chars/  4 pages  Oakland    Costco Exclusive Negotiation Agreement
    6 chars/  7 pages  Oakland    Second Amendment To Coliseum Complex
   34 chars/ 35 pages  Oakland    General Plan Extension For Open Space
    8 chars/  9 pages  Nashville  An ordinance approving an agreement between...
   20 chars/ 21 pages  Nashville  A resolution approving an intergovernmental...
   20 chars/ 21 pages  Nashville  A resolution approving an intergovernmental...

**OAKLAND'S CEILING IS 5 OF 14 AND ITS PUBLISHER SETS IT.** Nine of its fourteen
attachments are paper that was scanned, and one of the nine is the **Museum Of
Jazz And Art** document - the single Oakland project in the reader gap. So
Oakland's one gap project cannot be moved by any parser at all.

**OCR IS ITS OWN BUILD AND IT IS NOT STARTED.** It is not a reader change: no
field set, no recogniser and no guard in this tree touches a page with no text
layer. Recorded here so the next ranking does not count these twelve as
documents a reader could reach. Golden case
`a-scanned-page-counted-as-a-document-we-hold` already carries the shape; this
is the corpus-wide number for it.

### THE FIGURES I WAS GIVEN DO NOT REPRODUCE, AND I AM NOT RECORDING THEM

The instruction was to log "63 of 82 attachments carry no drawable text,
Nashville 22 of 23". Against the population defined at the top of this file the
answer is **12 of 143, Nashville 3 of 20** - and Nashville's median is 7,797
characters, so 17 of its 20 attachments are plainly readable.

I cannot source 63 of 82 from this corpus. Candidate populations, all counted:

| population | attachments | Nashville |
|---|---:|---:|
| non-Clark, url is a file, undismissed | 146 | 21 |
| the same, fetched successfully | 143 | 20 |
| the same, on a project the register still holds | 62 | 20 |
| attachments LISTED by the 2026-09-07 government run | 79 | 2 |

None of them is 82, and none makes Nashville 23. **A figure I cannot source is
not one I will write down**, so the measured numbers stand above and the
instructed ones are recorded here only as unreconciled. If 63 of 82 came from a
run or a report I have not seen, point me at it and I will reconcile the two
rather than pick one.

---

## 3. FOUND WHILE MEASURING: THREE STORED DOCUMENT URLS ARE GONE

Three fetches failed, all HTTP 404 against the publisher:

    broward.legistar1.com/broward/attachments/986119ba-....pdf
    broward.legistar1.com/broward/attachments/58f18e89-....pdf
    nashville.legistar1.com/nashville/attachments/2641250e-....PDF

Those rows carry `has_primary_document = true` and a `primary_document_url` that
no longer resolves. Every count of "documents we hold" includes them.

The Nashville one matters more than the other two: **`2641250e` is 1222
Demonbreun Street**, one of the three projects reader 1 was measured against on
2026-09-07, and it was recorded then as an image-only scan of 8 pages / 7
characters. Today the same url 404s. So either the publisher pulled it in two
days or the earlier read came from a cached copy - and nothing in the corpus
records which, because a document url is stored without a fetch date or a last
seen status.

Not fixed. It is a third question and it is smaller than either of the two above.
