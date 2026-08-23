# BRIEF Q. DEPTH, AND WHAT WE ACTUALLY HOLD.

Write this file to the repo before starting.

## Why this and not the census

Brief O's item 4 found twenty-one jurisdictions reachable through two adapter
builds and five config rows. None of that is being wired yet, and the reason is
the judgement of 2026-08-22: of 108 new projects the backfill produced, 18 were
hospitality developments. Seventeen percent. More markets multiplies that ratio
rather than improving it.

The same report found something better. 123 live records carry a ULURP-shaped
number in their text and 105 carry a CEQR-shaped number. Those are identifiers
that open document routes on projects we ALREADY HOLD, and the documents they
open carry conditions, decisions and named parties.

This pass makes existing entries deeper. Nothing here adds a market.

## Standing rules

Measure before you build. A rule ships with the count behind it and the cost
per market stated. Report before you propose. Ask what a source publishes as a
FIELD before opening a PDF. Read the body, not the status code. Never
fabricate. Nothing is silently absent. Sweep for the shape before the fix is
committed. State the cap beside any figure taken from a capped read. NPM_EXIT
from the captured line on every gate.

---

## ITEM 1. WHAT WE ACTUALLY HOLD, AND HOW GOOD IT IS

This runs first and everything else waits on it. I have 424 projects and no
idea which of them are worth anything.

Judge every live project, not a cohort. Use the same buckets as the 2026-08-22
judgement so the numbers are comparable:

  - a hospitality or entertainment DEVELOPMENT
  - a development, but outside the vertical
  - an instrument rather than a project: a licence against an address, a sign
    waiver, an extension of time, a bond hearing, a plan amendment
  - municipal housekeeping that cleared the gate on a word

Buckets are mutually exclusive and assigned on the primary character of the
filing.

For each bucket report, per market: the count, how many carry a named private
party, how many carry a representative, how many carry a stated fact, how many
carry a condition of approval, and how many carry a contact detail.

Then rank the hospitality developments by what a reader meets on the page,
using the depth measure from 2026-08-20 rather than significance. Report the
top thirty by name with their market, stage, party, record count and depth
score.

Then answer three things plainly:

  - how many projects could carry a referral brief at Heart Hotel quality
    today, and name them
  - how many are one document away from that, and name what document
  - how many should not be in the register at all

Write the result to disk as a file I can open. This is the question I have been
unable to answer for a week and the register cannot answer it for me.

---

## ITEM 2. THE IDENTIFIERS ALREADY IN THE CORPUS

Report before proposing anything.

For the 123 ULURP-shaped and 105 CEQR-shaped numbers found in live record text:

- how many are distinct, and how many projects they sit on
- how many are already stored as a field somewhere, against how many exist only
  in prose
- for the ULURP numbers, how many return a CPC report at the published URL. The
  earlier measurement reached 13 of 28 and said the remainder are applications
  the Commission has not voted on yet. Re-measure against the larger set.
- what each returned report carries: named applicant, decision, recorded vote,
  obligation clauses

Then report how many live New York projects would gain a decision, a party or a
condition if every reachable identifier were followed.

That number decides whether this pass is worth finishing. If it is under ten
projects, say so and stop.

---

## ITEM 3. EXTRACTION FROM WHAT THE IDENTIFIER OPENS

Only if item 2 clears its own bar.

The CPC reader already exists and reads applicant, decision and vote. Conditions
were deliberately not built, because a CPC report is a legal resolution and the
Clark County reader is an administrative checklist, and a second reader keyed on
RESOLVED was refused as a New York special case.

Revisit that with the larger number in hand. Report:

- how many of the reachable reports carry obligation clauses at all
- whether a conditions reader for legal resolutions would reach anything
  outside New York, now or plausibly
- the cost per document, measured, not estimated

If it is still one jurisdiction, it stays refused and you say so.

---

## ITEM 4. THE MANUAL IDENTIFIER STORE

Proposed in Brief O item 4.4 and not built.

A hand-supplied identifier is curation, and the membership cascade proved what
happens to curation with no home.

Build it: a typed `manual_identifiers` map on the project, keys ulurp, sch,
sunbiz, apn. Written only by hand, never by a scrape path. Read by the reader
that needs it. Same column discipline as status.

Report first what writes it and what reads it, then build. Print any migration.

---

## ITEM 5. CEQANET, THE CHEAPEST GAIN IN THE REPORT

California holds 0 of 33 projects with a parcel number. CEQAnet publishes
Location Parcel Number and Location Total Acres as fields, on the CSV route at
ceqanet.lci.ca.gov, no auth, 55 fields.

It attaches to 4 of 28 live California projects today.

Report:
- how many of the 28 have an SCH number reachable from their own text
- what those 55 fields would add per project, named
- whether the developer in the title prose is extractable without a name rule

Then propose. Do not build a reader before I have seen the reach.

---

## What comes back

Item 1 as a file on disk plus the three plain answers. Then items 2 through 5
in order, each confirmed before the next.

Nothing in this brief adds a market.
