# READER 2. LAS VEGAS PRIMEGOV.

Measured 2026-09-09 by `agents/scraper/diagnostics/reader-two-probe.ts`,
NPM_EXIT=0. Nothing written, nothing fetched from PrimeGov. Same reporting as
reader 1: records read, facts extracted, projects moved off zero, whether any of
it reaches the market standard, and whether it emits a condition.

---

## 0. THE SHORT ANSWER

**Reader 2 was two different things wearing one name, and only one of them needs
the runner.**

    THE READ     a field set over agenda text the corpus ALREADY HOLDS.
                 Needs no network. Measured below: it would reach 41 of 70
                 records and move 29 live projects off zero.
    THE CAPTURE  reaching PrimeGov for the staff report behind an item.
                 Needs the hosted runner. Cannot be measured from here.

**It is the largest reader gain available in this corpus and almost none of it
is in the vertical.** Of the three Las Vegas vertical projects with no fact, one
is reachable, one is press-only, and one **is not a Las Vegas project at all**.

**It emits no condition, and none is possible.** A Las Vegas agenda line states
the request and the staff recommendation. The obligations attached to an approval
are not on it.

---

## 1. WHAT IS ACTUALLY THERE

Population: `leads.market = 'Las Vegas'`, `status <> 'dismissed'`, paged to
exhaustion, no cap.

| | |
|---|---:|
| Las Vegas records | **70** |
| on a project the register still holds | 67 |
| carrying a `primary_document_url` | 45 |
| of those, url is a **FILE** | **0** |
| carrying `raw_content` | **70** |
| carrying a filing fact today | **0** |

`raw_content` length: min 130, p25 237, **median 530**, p75 897, max 2,830.

Every one of the 45 document urls is a PrimeGov
`Portal/Meeting?meetingTemplateId=N` page, which `lib/document-shape` correctly
calls a listing. That is why every count of "Las Vegas documents held" has been
zero and always will be: **the adapter never stored a document, it stored the
meeting.** `sources/lasvegas.ts` fetches the HTML agenda, splits it into items
through the shared `agenda-portal` helpers, and puts the item text in
`raw_content` with the meeting page as the url.

**So the text is here and nobody has ever run a reader over it.** That is the
same position Clark was in on 2026-09-07, and it is the first thing this pass
checked.

## 2. EVERY EXISTING READER, RUN OVER THE TEXT WE ALREADY HOLD

**Records read 70. Facts extracted 0. Conditions 0. Projects moved off zero: 0.**

    which recogniser fired:
      none      70

Not one of the five recognisers in the tree fires on a single Las Vegas item -
including `anaheim-agenda`, which was the live hypothesis: Las Vegas and Anaheim
are captured by the SAME `agenda-portal` helpers into the same item shape, so if
anything transferred it would be that one. It does not. Tested rather than
assumed, which is what the `clark-ordinance-title` claim ("the most transferable
idea in the whole reader set") failed at.

### How far Las Vegas is from the one form that yields a condition

Clark's agenda-sheet markers, counted over all 70 Las Vegas items:

| marker | hits |
|---|---:|
| `APP. NUMBER/OWNER` heading | **0 of 70** |
| `PRELIMINARY STAFF CONDITIONS` | **0 of 70** |
| `CONDITIONS OF APPROVAL` | **0 of 70** |
| a zone in parentheses, `(CR) Zone` | **0 of 70** |
| TAB / CAC | **0 of 70** |
| `STAFF RECOMMENDATION` | 1 of 70 |
| a case number like `UC-26-0219` | 1 of 70 |
| an acreage phrase | 9 of 70 |

It is not a variant of the Clark form. It is a different document.

What Las Vegas items DO carry: a case number like `24-0495-SUP1` on 14, staff
recommends on 11, ABEYANCE on 9, `APPLICANT:` on 6, GPA on 4, SUP on 3.

## 3. WHAT A LAS VEGAS FIELD SET WOULD YIELD. MEASURED, NOT BUILT.

Per-field hit rates over the 70 items, with an example value, which is the pass
every existing reader in this tree was written after. Nothing is wired to
anything and nothing is stored.

| kind | records | rate | example |
|---|---:|---:|---|
| ward | 36 | 51% | `3` |
| apn | 20 | 29% | `162-03-110-044` |
| site_address | 15 | 21% | `1127 South Casino Center Boulevard` |
| application_no | 14 | 20% | `26-0166-CLC1` |
| staff_recommendation | 11 | 16% | `APPROVAL` |
| applicant | 9 | 13% | `PANTHER ACQUISITIONS, LLC` |
| owner | 9 | 13% | `MARGEL, LLC` |
| site_acreage | 9 | 13% | `8.67` |
| held_to | 9 | 13% | `ABEYANCE` |
| floor_area | 2 | 3% | `32,303` |
| open_space | 2 | 3% | `11,308` |
| zone_change | 2 | 3% | `TOD-2` to `TOC-1` |
| **condition** | **0** | **0%** | **none, and none possible** |

    records a Las Vegas field set would reach : 41 of 70
    live projects it would move off zero      : 29

An item at its richest, verbatim from `raw_content`, with no network involved:

> 17. ABEYANCE - 25-0536-GPA1 - GENERAL PLAN AMENDMENT - PUBLIC HEARING -
> APPLICANT: PANTHER ACQUISITIONS, LLC - OWNER: MARGEL, LLC - For possible action
> on a Land Use Entitlement project request FROM: TOD-2 (TRANSIT ORIENTED
> DEVELOPMENT - LOW) TO: TOC-1 (TRANSIT ORIENTED CORRIDOR - HIGH) on 8.67 acres
> at the northeast corner of Lake East Drive and Lake Sahara Drive (APNs
> 163-08-513-003 and 004), Ward 2 (Kelley). **Staff recommends APPROVAL.**

Applicant, owner, zone change, acreage, two APNs, a location, a ward and a staff
recommendation, in one paragraph the corpus has held all along.

**`ward` at 51% is the highest-yielding field and it is the least useful one.**
A council ward is not a fact about a scheme. Stated because a per-field table
sorted by rate would put it at the top and make the reader look better than it
is: the fields that describe the development top out at 29%.

## 4. THE THREE VERTICAL PROJECTS, WHICH IS WHAT DECIDES IT

| project | records | source | document urls | what it holds |
|---|---:|---|---:|---|
| Jackson-Shaw Company hotel | 2 | `agenda-portal` | 2 listings | **the agenda text, and it is rich** |
| Top Gun Las Vegas | 9 | `gli_serper` | **0** | nine press stories |
| Las Vegas corridor anchors | 2 | `gli_serper` | **0** | two press stories |

**Jackson-Shaw is reachable today.** Its stored text already carries the
applicant/owner pair, the case number `24-0495-SUP1`, a floor area of 32,303
square feet, 11,308 square feet of outdoor seating, an address at 330 South Grand
Central Parkway and an APN. A Las Vegas field set moves it off zero with no
network at all.

**Top Gun Las Vegas is not a Las Vegas project**, and `sources/lasvegas.ts` says
so in its own header: the attraction relocated OUT of the city to unincorporated
Clark County at 4815 S Las Vegas Blvd, so it is captured through the Clark
Legistar lane and "zero city Top Gun hits is the correct result, not a failure".
All nine of its records are press. **No PrimeGov reader can ever move it**, and
ranking reader 2 as worth 22 projects counted this one among them.

**Las Vegas corridor anchors is press about the Athletics ballpark.** Two
`gli_serper` rows, no filing behind either.

So: **reader 2 is worth ONE vertical project**, exactly as reader 1 was, and 28
others outside the vertical.

## 5. THE MARKET STANDARD, AND THE CONDITION

**No.** `lib/market-standard.ts` requires four criteria per project, and the one
Las Vegas would gain - a stated fact about the scheme - is one of them. It would
still hold no condition, and the decision, its body and its date are not on an
agenda line either. Las Vegas would move from carrying nothing to carrying a
fact, and would stay below standard.

**It emits no condition.** Zero of 70 items carry `CONDITIONS OF APPROVAL` or
`PRELIMINARY STAFF CONDITIONS`, and a candidate field set has no condition
pattern because there is nothing to match. That keeps the count where it has
been all along: **1,474 condition facts in the corpus, every one Clark's.**

## 6. THE HOSTED RUNNER, AND WHAT IT MEANS FOR THE CADENCE

Re-probed from this machine 2026-09-09, unchanged since 2026-09-02:

    403  4,549 bytes  lasvegas.primegov.com/api/v2/PublicPortal/ListArchivedMeetings
    403  4,549 bytes  lasvegas.primegov.com/Portal/Meeting?meetingTemplateId=40662

Measured on the GitHub runner 2026-08-27, AS8075 Microsoft: **200, 187,325
bytes, real meeting JSON.**

**The READ needs no runner. The CAPTURE does.** Those are different jobs and only
the second is blocked:

- A Las Vegas field set over `raw_content` can be written, run and gated on this
  machine today. Its ceiling is the 70 items already captured.
- Capturing NEW items, or reaching a staff report behind an item, happens only
  when `weekly.yml` runs `scrape:government` on `ubuntu-latest`.

**What that means for the cadence, stated as consequences rather than as a
caveat:**

1. **Las Vegas item capture only advances on a Monday.** The 70 items are frozen
   at whatever the last successful capture reached; every new agenda arrives
   through the workflow or not at all.
2. **A local run will keep reporting Las Vegas `kept 0`**, which is correct and
   must not be read as a regression. Already in CLAUDE.md alongside San Antonio
   and Anaheim City Council.
3. **Nobody has confirmed the staff report is worth reaching.** PrimeGov's
   `documentList` gives a `templateId` and a `templateName` per meeting, and
   whether any of those is a per-item staff report - rather than another rendering
   of the agenda - has never been measured, because it cannot be measured from
   here. That is one probe on the runner and it should happen before any capture
   work, not after.

---

## 7. WHAT I PROPOSE

**Do not build the capture half.** It is blocked, it is unmeasured, and the one
probe that would size it has not been run.

**The read half is a real gain and it is honestly small in the vertical.** 41 of
70 records, 29 live projects off zero, one of them in the vertical. Compare the
Clark re-run of 2026-09-07: three vertical projects for the cost of a command.
This is a build, for one.

**If it is built, the field set is measured above and the false-positive risk is
named:** `ward` must not be stored as a fact about a scheme, and
`staff_recommendation` reads a single word after "Staff recommends" - it needs the
same quotation guard every other reader goes through, because "Staff recommends
APPROVAL subject to conditions" and "Staff recommends DENIAL" differ by one token
and both appear.

**And one thing to correct in the record either way:** Top Gun Las Vegas should
not be counted in any Las Vegas reader's yield again. It is a Clark County
project with nine press records and no filing, and the adapter has said so since
it was written.
