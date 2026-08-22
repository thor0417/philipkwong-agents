# BRIEF O. THE EXPANSION, MEASURED.

Write this file to the repo before starting, so it survives a session. Brief O
has been referenced three times and never existed on disk, which is the whole
argument for writing it down.

## Standing rules

Measure before you build. A rule ships with the count behind it and the cost
per market stated. Report before you propose. Ask what a source publishes as a
FIELD before opening a PDF. Read the body, not the status code. Never
fabricate. Nothing is silently absent. Sweep for the shape before the fix is
committed. State the cap beside any figure taken from a capped read.
NPM_EXIT from the captured line on every gate.

## Item 1 is done

Miami-Dade, San Antonio, South Florida and Lake Buena Vista retired. Yonkers
held after the probe showed the feed alive. Ten markets, verify:coverage-table
green.

---

## ITEM 2. THE THREE COUNTIES

Maricopa AZ, Broward FL, LA County CA. All three confirmed Legistar, all filing
at 0 to 1 day, all a config entry rather than an adapter.

Maricopa first. It is the county layer over Phoenix, Scottsdale, Tempe and
Glendale. Then Broward, which gives us live Florida for the first time. Then
LA County.

One at a time. After each, report records fetched, records written, projects
clustered, projects naming a party, and the median lag. Through
corpus:snapshot with a label, not a one-off query.

They inherit the fixed cursor, so each needs a twelve-month backfill on first
run. Report the cost before running it.

---


### MEASURED 2026-08-22. The brief's text above is unchanged; this is what the probe found.

**One of the three premises was wrong.** Probed by body before any config row was
written:

| code | what it actually is | 12mo matters | newest | gate admits |
|---|---|---:|---|---:|
| `maricopa` | **City of Maricopa** (City Council, Planning & Zoning) | 442 | 2026-08-17 | 4 |
| `broward` | Broward County (County Commission) | 1,006 | 2026-08-19 | 92 of newest 1,000 |
| `lacounty` | LA County (Board of Supervisors) | 2,843 | 2026-09-02 | 2 of newest 1,000 |

Counts are capped where it matters: Legistar enforces `$top=1000` server-side, so
the census sees the newest 1,000 only. True twelve-month totals were paged with
`$skip`.

**Maricopa County is not on Legistar.** `maricopa` is a ~60k town in Pinal
County; nine plausible county codes return 500. NOT WIRED, by decision
2026-08-22: it goes to the 4.1 census.

**LA County NOT WIRED, by decision 2026-08-22.** Reachable, but 2 admitted per
1,000 on a Business Licence Commission docket is not the entitlement layer.
Recorded in 4.1 as reachable and low-yield so nobody proposes it again without
the number.

**Broward WIRED.** Three config rows, no adapter. Isolation proven by table: 0 to
97 records, 64 other markets identical. 1,152 fetched, 97 written, 84 projects,
7 naming a party, 78 named from the title, 0 filing facts, 3-day capture latency.

**STAY OR RETIRE, on the test the other markets face and not a tuned one.** Two
precedents exist. Miami-Dade and San Antonio were retired on FEED LIVENESS
(newest matter 2018 and 2021). Lake Buena Vista was retired on YIELD: 25 records
over the adapter's life, 6 surviving, two published in twelve months and both
dismissed.

    Broward against the liveness test : 97 of 97 live records inside twelve
                                        months, newest 3 days old. PASSES.
    Broward against the LBV yield test: 98 records, 97 surviving, 97 inside
                                        twelve months, 1 dismissed. PASSES by
                                        roughly forty times the threshold that
                                        retired Lake Buena Vista.

**VERDICT: Broward stays.** It passes both existing tests decisively and the test
is not to be tuned in either direction.

What is true and separate: Broward is an OUTLIER on two axes no market is tested
on. 8% of its projects name a party, the lowest of any market holding more than
two projects (next is Nashville at 30%). 93% are named from the title and
therefore provisional and withheld from any client document (next is Nashville
at 75%). It clusters at 0.87 projects per record against Clark 0.37, Anaheim
0.18 and New York 0.21, which is to say it barely clusters at all.

So its contribution to a document today is SIX printable projects, and one of
those is a genuine hospitality development (Weston Hospitality hotel); the rest
are a utility, an apartment block, an address-named row and two opaque entities.

The cause is the county-commission MOTION shape - "MOTION TO APPROVE Second
Amendment to Contract No..." - which defeats the clusterer and the namer
together. That is a clustering and naming defect, not a coverage one, and it is
the same family as the ORD instrument shape. Retiring Broward would hide it
rather than fix it.

---

## ITEM 3. CEQANET

Configured, captured, clustered, and not one document has ever been opened.

Field question first. Report what it publishes as a queryable field: lead
agency, applicant, consultant, document type, location. Then how many live
California projects it covers and how many gain a named party from a field
alone.

Report only. Do not build a reader.

---

## ITEM 4. SEVEN SECTIONS, SEVEN STATES

Nevada, California, Arizona, Florida, New York, Texas, New Jersey. Every
section runs across all seven. If a state has nothing for a section, say so
plainly and name what was checked.

Report all seven sections. Build nothing in item 4.

### 4.1 Platform census

Fetch each jurisdiction's agenda page and fingerprint the platform from the
markup. Report platform, reachable by config or needs an adapter, and how many
jurisdictions each new adapter would unlock across all seven states.

    Nevada       Reno, Washoe County, Henderson, North Las Vegas
    California   Los Angeles city, San Diego, Inglewood, Palm Springs,
                 Santa Clara, Riverside, Long Beach, Santa Monica, Burbank
    Arizona      Scottsdale, Tempe, Glendale, Mesa
    Florida      City of Miami, Miami Beach, Orlando, Orange County,
                 Osceola, Fort Lauderdale
    New York     anything outside NYC worth having
    Texas        Austin, Travis County, Dallas, Fort Worth, Houston
    New Jersey   Atlantic City

Anaheim is the control case. We read it through Granicus, so if the probe does
not identify Anaheim as Granicus, the probe is wrong.

Florida is the worst gap. CFTOD covers Disney's own district only, so Universal
Epic Universe, the I-Drive corridor, SeaWorld and the convention centre
district are invisible. City of Miami runs Granicus and our Granicus adapter is
hardcoded to Anaheim, which is why that decision stalled months ago.


### MEASURED 2026-08-22, entries for the census when it is run.

Recorded here so nobody proposes either again without the number.

| jurisdiction | platform | reachable | yield | decision |
|---|---|---|---|---|
| Maricopa County, AZ | NOT Legistar; nine county codes return 500 | unknown, needs the census | unmeasured | platform unknown, carry into 4.1 |
| City of Maricopa, AZ | Legistar `maricopa` | yes, by config | 442 matters / 12mo, **4 admitted** | reachable, not worth a row |
| LA County, CA | Legistar `lacounty` | yes, by config | 2,843 matters / 12mo, **2 admitted of newest 1,000** | reachable, LOW YIELD, not wired |
| Broward County, FL | Legistar `broward` | yes, by config | 1,006 / 12mo, 92 admitted | WIRED 2026-08-22 |

LA County's Legistar instance carries the Board of Supervisors alongside 110
bodies, but the matters that reach it are Business Licence Commission and
administrative items rather than entitlement. Reachable is not the same as
useful, and the census should record both.

### 4.2 Environmental layer

Environmental review names the developer, the consultant and the program before
any construction filing exists.

Per state report: what exists by name, whether it publishes a searchable
database or documents only, what it publishes as a queryable FIELD, whether it
needs authentication, and how many of our live projects in that state it would
reach.

Known starting points, and I expect more to be found:

    California   CEQAnet
    New York     CEQR for the city, SEQR and DEC for the state
    Florida      FDEP, the water management districts, and whatever replaced
                 Development of Regional Impact review

Nevada, Arizona, Texas and New Jersey are unknown to me. Find out. A blank is
not an answer; "this state has no equivalent, I checked X and Y" is.

NEPA applies to all seven and matters most in Nevada, where Strip-adjacent land
is often BLM. Report whether NEPA documents are reachable as a field-published
source, per state.


### MEASURED 2026-08-22. CEQAnet answered the field question, and it corrects the premise above.

**"Environmental review names the developer, the consultant and the program" is
NOT true of CEQAnet, and the other six states should be measured against what it
proved rather than against the assumption.**

CEQAnet publishes a full CSV export at `/Search?Sch={sch}&OutputFormat=CSV`,
**55 named fields**, so no document needs opening:

    lead agency      YES   Lead Agency Name / Title / Acronym
    document type    YES   NOD, NOE, MND, EIR, plus received and posted dates
    location         YES   Cities, Counties, Cross Streets, Zip, Total Acres,
                           PARCEL NUMBER, coordinates, highways, waterways
    decision         YES   NOD Approved By Lead Agency, Approved Date,
                           Significant Environmental Impact, NOC Local Action
    applicant        NO    no such field exists
    consultant       NO    no such field exists

There are seven contact fields - full name, authority, job title, email,
address, phone - and on every record checked they resolve to the LEAD AGENCY'S
CASE PLANNER, not the developer: Thomas Gorham, Contract Planner, City of
Anaheim; Jacob Wielenga, Associate Planner, City of La Habra; Lisandro Orozco,
Senior Planner, City of Anaheim. That is the case_planner distinction
readers/core.ts already draws so no entry can print staff as a party.

Reach: 28 live California projects; CEQAnet attaches to 4 of them; **0 would gain
a named PARTY from a field alone.**

What it WOULD give is acreage, cross streets and a PARCEL NUMBER as fields, which
is the input 4.7 needs, plus an approval decision and date.

THE QUESTION FOR THE OTHER SIX STATES therefore is not "does the environmental
layer name the developer" but "does it name anyone who is not the agency's own
staff", and it has to be asked per source rather than assumed from the category.

### 4.3 Corporate registry

This is the party layer we do not have. Every applicant is an SPV named per
parcel, which is why the applicant axis carries nothing across markets. The
registries publish the officers behind those entities, and that turns
"Tropicana Land, LLC" into human names.

We proved this works in BC with OrgBook, where it resolved eight name strings
to four registered companies through rename history alone.

Per state report: the registry by name, what it publishes (officers, directors,
registered agent, addresses), whether it is queryable by API, by URL pattern or
only through a form, whether it needs a key, a captcha or payment, and how many
of our live applicant entities in that state would resolve.

Florida's Sunbiz publishes officers and registered agents free. Nevada's
Secretary of State publishes officers. The other five are unknown.

### 4.4 Manual assist lane

New York needs a person to supply a ULURP number before the CPC report route
opens. Philip did that by hand and nothing recorded it. Mexico will be the same
shape.

Report every route in the system that is one identifier away from opening,
where the identifier exists inside a document but not as a published field.
Which state and source each sits in, and how many projects each would unlock.

Then propose how a hand-supplied identifier is stored and reused, so it is
entered once rather than every time.

### 4.5 Specialist regulators

Per state, report what licensing body sits underneath a hospitality project:
gaming, liquor, hotel licensing.

The Nevada Gaming Control Board and the New York State Gaming Commission
specifically, since Bally's Bronx depends on the latter.

Field question first. And anything built here carries an instrument rule from
the start: a gaming or liquor licence filed against a street address is not a
development. Twelve of those are already in the register from Las Vegas and the
shape is logged.

### 4.6 Federal sources, which cover all seven at once

FAA Form 7460 determinations. Heart Hotel's conditions require one and the FAA
publishes them searchably with the applicant named.

Army Corps permits for anything touching water.

NEPA as a national source, cross-referenced with 4.2.

Report what each publishes as a field and how many live projects it reaches.

### 4.7 Property records

Who owns the parcel and what it last sold for. This is the axis that does not
change when the SPV does, and it is how the LVXP ownership was found by hand.

We already hold APNs on Clark County projects.

Per state report: whether assessor data is queryable, what it publishes, and
how many of our projects carry a parcel number we could look up.

---

## What comes back

Item 2 confirmed one county at a time. Item 3 as a report. Item 4 as seven
reports, each covering all seven states with nothing skipped.

Then I decide what gets wired.
