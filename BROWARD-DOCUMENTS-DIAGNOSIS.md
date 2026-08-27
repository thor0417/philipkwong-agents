# WHY BROWARD COUNTY HAS 97 RECORDS AND ZERO DOCUMENTS

Diagnosis only. Nothing built, nothing changed. Measured 2026-08-27.

The question: Broward runs on Legistar, the same platform and the same single
adapter as Clark County, which carries 245 documents against 303 records.
Broward carries 0 against 97.

**There are two causes, they are stacked, and only the second is Broward's.**

---

## CAUSE 1. BROWARD CALLS ITS DOCUMENTS "EXHIBIT", AND "EXHIBIT" IS ON THE DRAWINGS BLOCKLIST

`sources/legistar-attachments.ts` strips attachments whose NAME reads as a
drawing, because a map or elevation set extracts to a few hundred characters of
street labels and fetching it is pure cost:

    const DRAWING_NAME = /(color[_ ]?merged|\bmaps?\b|exhibit|elevation|drawing
                          |site\s*plan|landscape|render|photo|survey|plat\b|aerial)/i

Measured live against both jurisdictions, newest 60 matters fetched, **first 25
of those 60 checked for attachments in each** (the cap is stated because the
figures below are taken under it):

| | Broward | Clark |
|---|---|---|
| matters checked | 25 | 25 |
| matters with at least one attachment | **22** | 25 |
| total attachments | **42** | 49 |
| usable after the DRAWING_NAME strip | **11** | 30 |
| matching any DOC_PRIORITY pattern | **0** | 22 |

**Broward has attachments. 22 of 25 matters carry them.** The blocklist removes
31 of its 42, which is 74%, and it removes them on the word `exhibit`.

What is actually being thrown away:

    Exhibit 1 - Proposed Ordinance
    Exhibit 2 - Amendment Report
    Exhibit 3 - Business Impact Estimate
    Exhibit 2 - OESBD Memo
    Exhibit 3 - Agreement History
    Exhibit 1 - Proposed Resolution Amending the Broward County Administrative Code

Those are prose documents. They are exactly what the reader wants. Clark's
`UC-26-0303_Color_Merged.pdf` is a genuine drawing set and the blocklist is right
about it, and the blocklist was written against Clark.

**This is standing rule 8's shape for the third time this week: a label read as
the thing it names.** `exhibit` means "drawing" in Clark County and means
"attached document" in Broward County, and one regex was asked to speak for both.

And the second row matters as much as the first: of the 11 Broward attachments
that DO survive the strip, **none matches any `DOC_PRIORITY` pattern.** Broward
names nothing "staff report" or "agenda sheet". So even the survivors rank last,
and with `MAX_DOCS_PER_MATTER` at 3 they compete on an arbitrary ordering.

---

## CAUSE 2. `has_primary_document` DOES NOT MEAN THE RECORD HAS A DOCUMENT

This one is not Broward's and it is the more important of the two.

`sources/legistar.ts`, in the write:

    primary_document_url: c?.documentUrl ?? null,
    has_primary_document: !!c,

`c` is the return of `matterContacts(...)`, which is **null unless a fetched
attachment yielded a labelled contact block**. So on every Legistar
jurisdiction, `has_primary_document` records "the contact reader succeeded",
not "this record has a primary document".

A matter can have its staff report listed, fetched and parsed, and still record
`has_primary_document = false` because the document named no owner, applicant or
representative in the label format `contact-labels` recognises. The document was
read. The fact that we hold it was discarded.

**So "Broward has 0 documents" is not a true statement about Broward.** It is a
statement about how many Broward attachments contained a Clark-shaped contact
block, and the answer to that is separately zero for cause 1's reasons.

### Blast radius, swept

Every `has_primary_document` write site in the tree:

| Source | How it is set | Correct? |
|---|---|---|
| `legistar.ts` | `!!c`, the contacts result | **NO, conflated** |
| `agenda-portal.ts` | `meeting.hasPrimaryDocument` | yes |
| `govdocs.ts` | `isFile` | yes |
| `nyc-city-record.ts` | `Boolean(doc)` | yes |
| `pdf-agenda.ts` | `true` | yes |
| `ceqanet.ts`, `nyc-zap.ts`, `nyc-ceqr.ts`, `sfwmd.ts` | `false` | yes, they have none |

**One site, and it is the one covering seven jurisdictions**: Clark, Nashville,
Phoenix, Oakland, Yonkers, Westchester and Broward. The document counts for all
seven are understatements of unknown size, and the corpus figures in
READER-INVENTORY.md section 3 inherit that understatement.

The numbers that now look different in that light:

    Nashville     38 records   10 "documents"
    Phoenix       42 records    1 "document"
    Westchester    2 records    2 "documents"
    Broward       97 records    0 "documents"

Phoenix at 1 of 42 is the one to be most suspicious of. Its documents are
liquor-licence data sheets, which would carry no applicant contact block in the
Clark label format at all.

---

## WHAT I AM NOT DOING, AND WHY

The obvious move is to delete `exhibit` from `DRAWING_NAME`. **Do not, yet.**

Standing rule 2: measure before changing, and measure per market. Removing
`exhibit` admits every Broward exhibit and also admits every Clark exhibit, and
Clark is 303 of the 1,604-record corpus and the only market currently at
standard. A change that helps Broward and costs Clark a fetch budget on drawing
sets is a change that has to be costed on both, which is the `measure-change`
procedure and is a separate pass.

The shape of the fix, for when it is costed:

1. `DRAWING_NAME` should test the whole name, not a substring anywhere in it.
   `Exhibit 1 - Proposed Ordinance` and `UC-26-0303_Color_Merged.pdf` are
   distinguishable: the first has a prose noun after the exhibit number.
2. `DOC_PRIORITY` needs Broward's vocabulary: `ordinance`, `resolution`,
   `agreement`, `amendment report`, `business impact`.
3. `has_primary_document` must be set from whether a document was fetched, and
   the contact result must stop standing in for it. That is one line and it is
   the highest-value line in this document, because it is wrong on seven
   jurisdictions rather than one.

Standing rule 7 says each of these produces a golden case. Cause 2 in particular
has an obvious one: a Legistar matter with a fetched document and no contact
block must record `has_primary_document = true`.

---

## WHAT THIS DOES NOT EXPLAIN

Nothing here explains a fact rate. Even with both causes fixed, Broward would
gain documents and still have zero filing facts, because **there is no Broward
reader** and its documents are ordinances and agreements. The nearest existing
reader is `oakland-ordinance`, which is built for exactly that shape and returns
14 fact kinds against prose ordinances and agreements.

**That is the cheapest hypothesis on the table and it is untested:** point
`isOaklandDocument` at a Broward ordinance and measure. It is a measurement, not
a build, and it is the natural first entry in the scorecard once the layers are
named.
