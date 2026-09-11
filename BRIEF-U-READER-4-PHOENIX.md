# READER 4. PHOENIX.

Measured 2026-09-11 by `agents/scraper/diagnostics/reader-four-probe.ts`,
NPM_EXIT=0. Nothing written. Same reporting as readers 1, 2 and 3: records read,
facts extracted, projects moved off zero, whether any of it reaches the market
standard, and whether it emits a condition.

---

## 0. THE SHORT ANSWER

**Reader 4 stays closed and the reason it was closed twice was wrong.**

Records read 43, documents read 18, facts extracted **0**, conditions **0**,
projects moved off zero **0**. No reader is worth building here and none of the
five in the tree fires on a single Phoenix document.

**But "zero in the vertical" was a fact about our slice, not about Phoenix.** The
register holds 20 live Phoenix projects named `Cambria Hotel Downtown Phoenix`,
`Aloft Hotel Phoenix Airport`, `AC Hotel Biltmore`, `Fire N Ice Hotel`,
`Hotel Embarque`. Every one of them is a **liquor licence**, which is why Brief
Q's judge bucketed them as instruments and why the bucket was right. Meanwhile
the newest 1,000 Phoenix matters hold **49 entitlement matters**, and opening
every one of them found **three real hospitality entitlements**, none of which is
in the corpus:

```
  General Plan Amendment ... to facilitate hotel and higher density attached
    townhouses, condos, or apartments                     Desert View Village
  Z-87-E-03-2  Plaza Companies Hospitality PUD            Desert View Village
  Rezoning ... Proposal: Grocery store with banquet hall  16th St & Portland
```

**So Phoenix is not empty. It is inverted.** We admit the liquor licences because
the hotel's name is in the title, and we never see the rezonings because a
Phoenix rezoning title is a case number and a cross street.

**The constraint is the GATE, not a reader.** Judged with the same
`governmentGate` the capture lane uses, over the same 49 matters: **3 admitted on
the title, 21 admitted once the body is read, 18 reachable only through the
body.** That is the whole of reader 4's answer and it is a gate change, which
standing rule 2 says gets costed per market before it ships.

---

## 1. WHAT WE HOLD

| | |
|---|---:|
| Phoenix records, undismissed | **43** |
| including dismissed | 56 |
| on a project the register still holds | 36 |
| carrying a filing fact today | **0** |
| carrying a `primary_document_url` | 22 |
| `has_primary_document = true` | 22 |
| naming a party | 36 |
| naming a contact | **0** |

Sources: `legistar`, `gli_serper`. Source types: Council Agenda, and none.

**22 records stand on 18 distinct urls, every one a real PDF on
`phoenix.legistar1.com`, and every one answers 200.** There is no egress question
here and no listing page mistaken for a document: the Anaheim shape does not
apply, and that was worth checking rather than assuming.

## 2. WHAT THE DOCUMENTS ARE, READ RATHER THAN REPEATED

18 read, min 578 chars, **median 825**, max **281,752**.

```
  facts extracted 0     CONDITIONS 0     which recogniser fired: none 18
```

The median is a liquor licence data sheet, exactly as the 2026-09-02 pass said:

> `Liquor License Data: HOTEL EMBARQUE ... Bar 6 2 1 Liquor Store 9 4 2 ...`
> `Crime Data Description Average 1 Mile ... Property Crimes 64.21 39.72 49.15`

**The maximum is not.** One of the 18 is the **Downtown Phoenix Entertainment
District Implementation Plan**, 281,752 characters, and calling the set "22
liquor licence data sheets" was true of the median and wrong about the set. It is
a policy document rather than a filing about a project, so no reader should read
it as one, but it should not have been counted as a licence sheet either.

## 3. THE REGISTER, AND WHY THE BUCKET WAS RIGHT

20 live Phoenix projects, every one carrying 0 facts. Their names read like the
vertical - eight hotels, an arena, a coliseum, two museums, a sports grill - and
every one of them is a **liquor licence matter**: `Liquor License - Cambria Hotel
Downtown Phoenix/Palette - District 7`. The project is the licence, not the
hotel.

That is worth stating in both directions. A liquor licence for a named new hotel
IS a signal that the hotel is nearly open, so these rows are not junk; they are
just very late, and they are not entitlement intelligence, which is what the
register is for.

## 4. WHAT THE FEED ACTUALLY CARRIES

`webapi.legistar.com/v1/phoenix`, 28 bodies published, of which 8 are
entitlement-shaped and **Planning Commission is active**. The newest 1,000
matters:

| type | count |
|---|---:|
| Ordinance-S | 403 |
| **License - Liquor** | **134** |
| Payment Ordinance | 95 |
| License - Special Event | 52 |
| Information Only | 51 |
| Law Dept. Consolidated S-Ordinance | 44 |
| Ordinance-G | 43 |

**19 name a hospitality or entertainment venue in the title and 12 of those 19
are liquor licences.** 49 are entitlement-shaped.

## 5. THE 49, OPENED

Every one, with no cap. **Standing rule 13 earned its place in this pass**: the
first run capped the read at 40 of 49 and reported 8 venue hits, all eight false,
and the conclusion that there is nothing in Phoenix. **All three real ones were
in the last nine.** The cap was removed rather than stated, because the figure is
a pass/fail rather than a display.

10 matters name a venue word in the body. **Seven are false and the context is
printed for each**, because a regex hit is not a venue:

| what matched | what it actually was |
|---|---|
| convention | "superior to that produced by **convention**al zoning districts" |
| restaurants | "the applicant had listed potential **restaurants** they had not yet heard from" |
| Restaurant | a parking ratio table: "**Restaurant**: 1 space per 50 square feet" |
| Golf course | a SURROUNDING land use: "Northwest **Golf course** S-1 DRSP" |
| BAR | "A HALF-INCH RE**BAR** WITH THE RED PLASTIC CAP STAMPED LS 79657" |
| Golf Course x2 | the zoning district being rezoned FROM: "Request From: GC (**Golf Course** District)" |
| restaurant | adjacent uses: "Commercial uses (**restaurant**, barber shop, retail...)" |

**Three are real**, quoted in section 0. Checked against the corpus by name and
case number: `Z-87-E-03`, `Plaza Companies`, `Desert View Village`,
`Hospitality PUD`, `banquet hall` return **0 records each**. They never arrived.

Phoenix holds 7 rezoning or General Plan titles among its 13 **dismissed** rows,
so the gate has seen some of this shape and refused it. The three that matter
were never captured at all.

## 6. THE GATE, ON THE TITLE AND ON THE BODY

Judged with `governmentGate`, the same function the capture lane calls, over the
same 49 matters:

| | |
|---|---:|
| admitted on the TITLE alone | **3** |
| admitted once the BODY is read | **21** |
| reachable ONLY through the body | **18** |

**Reading the body would admit 21 matters to reach 3 real ones.** The 18 extra
are the same false positives section 5 names: parking ratios, adjacent land uses
and a zoning district code. That is a precision cost, it is exactly the shape of
the Broward finding where a Clark field set fired on 73% of documents and
extracted sentence fragments, and it is why this is a proposal rather than a
change.

## 7. THE MARKET STANDARD, AND CONDITIONS

`npm run verify:market-standard`: **Phoenix 20 live, 20 party, 0 facts, 0
conditions, 0 decision - below: missing facts, decision.**

No reader can move it, because the documents Phoenix publishes to the lane we
read state no scheme facts at all. A body-read gate change could, by admitting
the three entitlements, which carry an acreage, a location and a staff report.

**It emits no condition and none is possible from what is reachable.** 0 across
all 18 documents. The corpus count stays at 1,474, every one Clark's.

## 8. WHAT I PROPOSE

**Do not build reader 4.** Nothing has changed about that: there is no document
in the Phoenix lane for a reader to read.

**Cost a body-read gate for Legistar markets, and cost it per market.** The
measurement is `npm run gate:measure` over the labelled corpus with the body
included, plus the per-market admitted count, because a rule that helps Phoenix
and floods Broward has already happened twice. Phoenix's own numbers are 3 real
in 49, and 21 admitted to get them.

**And record what the liquor licences are.** 20 of Phoenix's 20 live projects are
licences. They are a late signal rather than junk, and whether the register
should hold them at all is a question for the cleanout rather than for a reader.
