# GLI INTELLIGENCE SYSTEM: OUTSTANDING WORK AND THE COMPLETE MODEL
## Every known gap, what closes it, and the order. This is the master roadmap; briefs get written from it one at a time.
### Status date: July 24, 2026. Keep this file current as items close.

---

## WHERE THE SYSTEM STANDS
Three live streams (opportunity 30, government 297, intelligence 336), six government capture lanes (Legistar, document sources, CFTOD PDF interiors, Anaheim Granicus, Las Vegas PrimeGov, CEQA, SFWMD), a 96 percent precision gate, player extraction, verified URLs everywhere, styled XLSX and branded PDF exports, and a first partner brief drafted from primary sources. Two of three validation targets surfaced by name with applicants extracted; the third has a tripwire on its parcel. The system works. What remains is coverage, curation, structure, and automation.

## THE COMPLETE MODEL, DEFINED
The finished blueprint for any jurisdiction, any country, is eight layers. A market is "covered" when each layer is either wired or consciously marked out of scope:
1. Legislative record (council and commission agendas)
2. Entitlement filings (permits, rezonings, plan amendments)
3. Environmental review (CEQA, SEQR, NEPA, SEMARNAT, national EIA regimes)
4. Water and utility permits (SFWMD-class districts)
5. Aviation filings (FAA OE/AAA and equivalents, for anything tall)
6. Special regulators (gaming boards, ride safety, liquor licensing)
7. Capital plans and budgets (5-10 year CIPs, comprehensive plans)
8. Bond issuances (EMMA/MSRB official statements)
Layers 1-4 are partially wired today. Layers 5-8 are identified, not built.

---

## TRACK 1: CAPTURE GAPS (close these to stop missing things)

### 1A. Clark County body coverage audit (SMALL, fold into next run)
Verify the Clark Legistar pull enumerates ALL bodies, especially the Winchester and Paradise Town Advisory Boards, where Strip-adjacent items (including anything at 4815 Russell Road) get their first public airing. If TABs are missing from the pull, widen it. Evidence: body list from the API, TAB items in the capture.

### 1B. Anchor watch terms (SMALL, config only)
Add watch terms for the two anchors beside the Top Gun parcel: the Athletics ballpark and the planned NBA arena, plus their known entity names once found. Same corridor, same buyers of GLI-class services.

### 1C. Anaheim Planning Commission (MEDIUM)
Council is covered via Granicus; Planning lives in the Questys document system. Map it, build the adapter or record it manual-tier honestly. Zoning items surface here before council.

### 1D. Intelligence lane miss diagnosis (SMALL, diagnose only, already drafted)
The Top Gun relocation ran in four major outlets on July 21 and Tier 3 missed it. Trace one article's disposition through the pipeline: never fetched by the queries, dropped by recency, or killed by the LLM keep gate. Report which, and what change would have caught it. Fix in a separate deliberate pass.

### 1E. Nevada special regulators (SMALL, likely manual-tier)
Gaming Control Board agendas and state ride-safety permitting. Probe access, wire if fetchable, otherwise record as manual-tier watch sources with query instructions.

### 1F. FAA OE/AAA (BLOCKED, standing manual-tier)
JS application, POST-only API, no automation path found. Keep as a documented manual check: search the Las Vegas area for new 7460 filings monthly, especially near Harry Reid, until an automation path appears.

### 1G. Legacy row purity purge (SMALL, needs explicit authorization)
Roughly 76 government rows predate the strict two-tier gate. Re-gate them: rows failing the current gate move to Archive or are listed for dismissal. Requires the deletion-authorization pattern: list first, act second, reconcile counts.

### 1H. Geography resolution: a place name is not a country code (SMALL, measured 2026-08-16)

**The shape: a place named in the text read as the project's own country.**

**The instance.** "Third Regional Development Project" is three World Bank
tenders for museum work at Stepantsminda and Mtskheta, both in the Republic of
Georgia. Every record's `location` field says exactly `Georgia`. The project is
filed as **country=United States, region_state=Georgia**, so it sits inside
every US-scoped client scope. `client-scope.audit` cannot see it, because the
composer and the database agree about the wrong country.

**Two branches produce it, and the second is a defect already thought fixed.**

1. `resolveGeography` scans for a US state or Canadian province BEFORE it
   consults the sovereign-country list, so a bare `Georgia` is the state.
2. The code-like branch reads the first two letters of any 3-6 character place
   as an ISO-2 country code. Measured, all live today:

   | input   | resolves to  | should be     |
   |---------|--------------|---------------|
   | Georgia | United States | Georgia       |
   | Austin  | Australia     | United States |
   | Fiji    | Finland       | Fiji          |
   | Malawi  | Morocco       | Malawi        |
   | Chad    | Switzerland   | Chad          |

   That second branch is the **Bronx -> Brazil** defect. Its fix consulted the
   configured-jurisdiction table first, which covers Bronx and Queens and
   nothing else, so every unconfigured place still falls through. The comment in
   lib/geography.ts says the fix was placed "where it covers every configured
   jurisdiction rather than special-casing the one that happened to collide" -
   and every place we do not configure is still special-cased by luck.

**What the pass must do.**

- Fix the precedence: a bare name that is both a US state and a sovereign
  country needs a rule, and the rule cannot be "always the state". A country
  hint, a sibling segment, or the source's own jurisdiction should decide it;
  say which and why.
- Fix the code-like branch so a plain word is never read as a code. The existing
  test `/^[A-Z]{2}[0-9A-Z]{1,4}$/` matches ordinary English words; requiring a
  digit, or requiring the whole string to be uppercase in the source, are the
  two obvious candidates. MEASURE both against the corpus before choosing: this
  branch exists to read legacy TED strings and must keep doing so.
- Re-resolve the affected rows. A fix that leaves the wrong countries stored is
  a fix a client still receives.
- Extend `verify-geography.ts`, which already pins about thirty location
  strings, with the five above.
- Then flip the golden case `a-place-name-is-not-a-country-code` from `pending`
  to `inline`.

**Why it outranks the client-scope question it was found under.** A wrong market
narrows a document. A wrong country puts a foreign project inside every domestic
client's scope, and the audit that exists to catch scope leaks is blind to it by
construction.

### 1I. Legistar sponsors: the government mover, not the party (SMALL, measured 2026-08-16)

**What was expected, and what is actually there.** This was raised as the fix
that turns Nashville from a market that cannot name anyone into one that can.
It is not. `Matters/{id}/Sponsors` was probed against all 108 stored Legistar
records and against the six live clients directly. **Every sponsor it returns is
an elected official or a government department. Not one is a private party.**

All 24 distinct sponsor names in the corpus:

| kind | examples |
|---|---|
| Metro Council members (Nashville) | Kyonzte Toombs (17), Burkley Allen (16), Zulfat Suara (14), Rollin Horton (12) |
| City departments (Oakland) | Economic & Workforce Development, Housing & Community Development, Planning & Building, Office Of The Mayor |
| County commissioners (Miami-Dade) | Dennis C. Moss, Xavier L. Suarez |
| County Executive (Westchester) | County Executive |

So a sponsor answers **"who in government moved this item"**, which is a real and
citable fact, and never **"who is behind this project"**. Writing it into
`applicant` would fabricate a party relationship, which rule 11 forbids and which
no reader could catch, because "Zulfat Suara" reads exactly like a developer's
name to anyone who does not know Nashville's council.

**Coverage is three of six live clients, and it is a publishing choice.**
Measured over the stored corpus, then confirmed against the live API:

| client | stored records | carry a sponsor | endpoint on 12 recent matters |
|---|---:|---:|---|
| Nashville | 17 | **17** | HTTP 200, populated |
| Oakland | 8 | **8** | HTTP 200, populated |
| Westchester County | 2 | **2** | HTTP 200, populated |
| Clark County | 44 | **0** | HTTP 200, `[]` on all 12 |
| Phoenix | 19 | **0** | HTTP 200, `[]` on all 12 |
| Yonkers | 0 | - | HTTP 200, `[]` on all 12 |

**This answers the Clark County question, and not in the way it was asked.** The
guess was that sponsors would add nothing in Clark County because its item text
already names parties, and would add most where the item text is thin. Neither
half holds. Clark returns an empty array with HTTP 200 on every matter tried: the
endpoint is not sparse there, it is unused. The correlation is not with how thin
the item text is, it is with whether the jurisdiction's clerk populates the field
at all. Clark's 44 records name parties because **the attachments lane already
works there** (38 of 44 carry a read document), not because sponsors are
redundant.

**One pass or two, and the honest answer is one call and two meanings.**
Mechanically it is one pass: `Sponsors` and `Attachments` are sibling
sub-resources of the same matter, keyless, on the same host, and the fetch loop
in `sources/legistar.ts` (`docWorker`, bounded concurrency) already visits every
gated matter with the id in hand. Adding sponsors is one more `fetch` inside that
existing loop, same error handling, degrading to null. It is not a second pass
and must not be built as one.

Semantically they are opposites and must not share a field:

- **Attachments -> the private side.** owner / applicant / representative, read
  out of the staff report. Already built, already running, already on by default.
- **Sponsors -> the government side.** A new field, and it needs a new one.

**Attachments will not rescue Nashville either, which is the finding that
matters.** Of the 14 silent Nashville matters, **2 have any attachment at all**.
Nashville publishes TIF and redevelopment-plan resolutions as ~310 characters of
matter metadata with no staff report attached. That is a limit of what Nashville
publishes, not of what we read, and no endpoint closes it.

**What the pass would do.**

- Add `government_sponsors text[]` to `leads` (migration, Philip runs it by hand;
  there is no DDL helper).
- One `fetch` in the existing `docWorker` loop; skip the three clients that
  return `[]` after a first empty response rather than paying the call forever.
- Extend `LegistarSponsorSchema` in `sources/schemas.ts`, validated at the
  boundary like every other Legistar shape.
- Surface it as **"Moved by"** and never as a party. The report layer's party
  slot must keep saying nothing where the record says nothing.
- A golden case pinning that a sponsor never lands in `applicant`.

**Honest value.** 27 records gain a "moved by" line. Zero projects gain a party.
It does not change the Nashville coverage verdict and it does not reduce the 66
no-party projects by one. It is worth doing for the Nashville TIF resolutions,
where the sponsoring council member is a genuine contact path for a regulatory
consultant, and it is worth doing cheaply. It is not the party fix.

## TRACK 2: CURATION (make Philip the quality filter)

### 2A. Triage controls (NEXT BRIEF, unlocks everything after it)
One status column (new, watchlist, dismissed) plus manual edit of category, venue, and stream from the detail panel. Trash is a tombstone: dismissed URLs are never resurrected by any future run, including the weekly agent. Watchlist is the working desk. Manual edits are marked and never reverted by classifiers. One schema line for Philip, buttons in the dashboard, one upsert rule in the scraper.

### 2B. Significance signals (folds into 2A or follows it)
Surface what already exists in the data as sortable signals: bypass-term hits, named applicants present, dollar amounts detected, target matches. These plus Philip's stars become the selection layer the automated brief draws from.

## TRACK 3: STRUCTURE (survive scale)

### 3A. Project clustering, two-object Phase 2 (MAJOR, after triage)
The projects table, clustering by normalized project key, stage taxonomy, the Projects register view (name, market, stage, last activity, watch flag). Leads become events on a project timeline; OCVibe becomes one project with seventeen events instead of seventeen rows. New captures attach to existing projects on upsert. This is the fix for organized chaos and the precondition for a sane weekly cadence.

### 3B. Dashboard redesign, Brief 5 (after 3A)
Designed around the project register and the triage workflow, not the flat feed. Government and opportunities primary, intelligence subordinate as context. Design session before the brief is written.

### 3C. A record-text axis on client_scopes (MEDIUM, costed 2026-08-16, for Brief P)

**Why, in one sentence.** A client scope can say WHERE a project sits and WHAT
LABEL our classifier gave it, and cannot say what the project IS. For any client
whose buyer is defined by the second, geography plus venue type is the wrong
shape, and there is nothing else to reach for.

**Measured on Simtec, whose buyer is a project building an attraction.**

| scope shape (expressible today)          | proposes | of 5 wanted | of 20 wanted | noise |
|------------------------------------------|----------|-------------|--------------|-------|
| as stored                                | 14       | 5           | 5            | 9     |
| drop market, keep venues, widen stages    | 76       | 5           | 17           | 59    |
| drop market and venue, stage only         | 164      | 5           | 19           | 145   |
| **a record-text signal, no other axis**   | **19**   | 4           | **19**       | **0** |

Every shape the model can express buys coverage with 30 to 145 wrong rows. The
text axis buys 19 of 20 with none. It cannot be stored.

Fifteen projects Simtec would actually want are unreachable today, including Top
Gun Las Vegas, Sphere Abu Dhabi and Genting SkyWorlds. Seven of the twenty carry
NO market on any record, so no market list reaches them however long: this is
not a matter of picking better markets.

**watch_terms is not this axis and must not be mistaken for it.** It is issued
as a search string to the intelligence lane and never compared to anything, so
it changes what gets CAPTURED, not what gets PROPOSED. Putting attraction
vocabulary there widens the corpus for one client.

**The three pieces, costed:**

1. **The migration.** One column, `client_scopes.record_terms text[] not null
   default '{}'`. Same shape as the seven arrays beside it, so the intake form,
   `SCOPE_VALUE_FIELDS` normalisation and `scopeIsEmpty` pick it up with a name
   added to a list. DDL, so printed for Philip and blocking. No backfill: an
   empty array constrains nothing, which is what every existing scope means.

2. **The resolveScope branch.** `record_terms` joins `recordFacets` rather than
   `query`, because it is a property of a RECORD and not of the project row -
   the same reason market, venue and category are already resolved there. Six
   lines: `nonEmpty`, an `unconstrained` entry so a scope that constrains
   nothing still says so, and the field on the returned `recordFacets`.

3. **projectsMatchingRecordFacets.** The one real piece of work. The existing
   axes compare a column with `ilike` on a whole string; this matches a term
   ANYWHERE in `title` or `raw_content`. Options, in order of preference:
   `websearch_to_tsquery` against a stored tsvector (needs a GIN index, which is
   more DDL), or `or(title.ilike.*term*,raw_content.ilike.*term*)` per term with
   the results unioned, which needs no DDL and costs one query per term. Simtec
   would carry about seventeen terms, so the second is one round trip per term
   against a 553-record table and is fine at this size. Say which was chosen and
   why, and state the cap.

**Two things it must inherit from the axes beside it.** A term nothing matches
must return the empty set, never the parent's rows (golden case
`unresolvable-facet-returns-nothing`). And the client bar's matched-axes line
must name the terms that matched, or the client view stops answering "why is
this here" for the axis that put it there.

**Do not build the term list into the product.** Terms are per client and belong
in that client's scope row. Simtec's would come from the corpus scan, not from a
domain vocabulary: 28 of 49 obvious candidates - ride, dark ride, flying
theatre, simulator, ride system - score ZERO in this corpus, and the terms that
work are attraction, theme park, immersive, entertainment district, amusement.

## TRACK 4: THE DELIVERABLE ENGINE (automate the brief)

### 4A. This month: manual prototype (DONE pending review)
GLI-INTELLIGENCE-BRIEF-2026-07 exists, hand-assembled from live queries with verified links. Philip reviews, renders branded PDF, sends to Keith. This document IS the spec for 4B.

### 4B. The brief generator (after 2A and 3A)
Select (significance signals plus watchlist), synthesize (LLM writes why-it-matters per item, every fact traced to a stored row, anything else marked press-sourced), render (branded PDF). Output shape: N new projects, M projects with new activity, stage changes, headline finds, watch list. First as a button, then as the weekly agent.

### 4C. Weekly agent cadence (LAST)
The full pipeline on schedule: capture, attach to projects, decay via liveness, generate the delta brief. Lands only after triage, clustering, and the generator exist, so volume arrives into structure instead of chaos.

## TRACK 5: EXPANSION (one config line at a time, only after Tracks 1-3)
1. CIP and capital budget extraction: the 5-10 year plans, a whole source class, reuses the PDF machinery. First candidates: Clark County, Anaheim, Nashville CIPs.
2. Bond issuances via EMMA: funded-project confirmation with named parties.
3. CEQA beyond Orange County: LA and San Diego are one config line each.
4. Building permit portals (Accela and Tyler class) as an adapter family.
5. SEMARNAT: still gated on the egress decision, the standing Mexico and Caribbean blocker.
6. Southeast Asia priority market: no sources wired yet; scope the layer-by-layer blueprint for the first target country before building anything.

---

## THE ORDER, FLAT
1. Review and send the July partner brief (in flight)
2. 1D miss diagnosis, 1A Clark bodies audit, 1B anchor terms (one small combined session)
2b. 1H geography resolution (SMALL, and it leaks into every US-scoped client
    scope, so it goes before anything that generates a client document)
2c. 1I Legistar sponsors (SMALL, one call in an existing loop). Ranked here on
    request, ahead of Brief P Part 5. Note before scheduling it: it was ranked
    here to fix the Nashville party gap, and measurement says it does not. It
    adds a "moved by" line to 27 records and names no party anywhere.
3. 2A triage brief
4. 1C Anaheim Planning, 1E Nevada regulators, 1G legacy purge (one cleanup session)
5. 3A project clustering
5b. 3C record-text scope axis (Brief P; unblocks every client whose buyer is
    defined by what a project is rather than where it sits)
6. 4B brief generator
7. 3B dashboard redesign
8. 4C weekly agent
9. Track 5 expansion, prioritized by GLI demand

## THE STANDARD, UNCHANGED
One brief at a time. Migrations printed for Philip, blocking, first. Done means data: live queries pasted, files generated and read back, URLs fetch-verified. Deletions listed before they happen. Honest gaps beat faked coverage. There are no shortcuts.

## LOGGED 2026-08-18, NOT BUILT. TOMORROW, IN THIS ORDER.

Each of these was found by reading a generated document back as its recipient,
not by a test. None is started; this is the log, not the work.

### L1. RDXNWP is hand-named, and that is deliberately not a rule
`#### RDXNWP  -  Clark County | filed` is a heading in JKR's report. Its own
filing states `Project Type = Recreation facility (ice rink)` and
`Generally located = south of Russell Road and west of Decatur Boulevard within
Spring Valley`, so "Spring Valley Ice Rink" is stated by the record twice over.

HAND-NAME IT. Do not write a rule, and the measurement is the reason:

    SHAPE A  name ends in a published entity suffix (LLC, Inc, LP)   1 project
               "The Howard Hughes Company" - a real developer, not a shell
    SHAPE B  single unspaced all-caps token, not a known initialism  1 project
               RDXNWP, and nothing else in any market
    SHAPE C  name is exactly the primary applicant string           17 projects
               and it contains Neon Museum, Children's Museum of Phoenix,
               The Smith Center for Performing Arts, Aloft Hotel Phoenix
               Airport, National Lighthouse Museum, Centennial Park
               Conservancy. Those names are CORRECT.
    "six consonants"                                                 1 project

The one discriminator that is not a name shape - does the name appear anywhere
but the party field it came from - reaches 30 projects across four markets and
MISSES RDXNWP, because the Clark County agenda line reads
`UC-26-0302-RDXNWP, LLC: USE PERMIT...` and the token is therefore in the title.

Every general rule tested either reaches one project, which is a hand-name
wearing a rule's clothes, or reaches good names in five other markets.

The SPV shape is real and will recur in New York and Florida, and when it does
the honest fix is a STATED-FIELD NAMING PASS (project type + place), not a
name-shape filter. That pass needs the Clark County reader's coverage extended
to the other markets first: of the 19 projects in the union of all three shapes,
exactly 1 carries a stated Project Type, and it is RDXNWP.

### L2. `TAB/CAC: APPROVALS:` - a label captured as a value
JKR report, line 90, on the RDXNWP entry:

    [RECORD] TAB/CAC: APPROVALS:

The extractor took `APPROVALS:` as the value of `TAB/CAC`. It is a label. The
real value follows that colon in the source PDF
(clark.legistar1.com/clark/attachments/584a7a4c-727d-42b0-aacf-5ed2d9319bdd.pdf).
Sweep the shape before fixing the one instance, per standing rule 8: a value
that is itself a label ending in a colon is checkable across every extracted
field, not just this one.

### L3. A referral brief's recipient is a parameter, not the operator
The Heart Hotel brief prints `Prepared for Philip Kwong`. Heart Hotel is a JKR
project lead, not a client, and the brief exists to be FORWARDED to someone who
will act on the matter. The addressee is therefore an input to the document, and
today it defaults to whoever generated it - which is wrong on the one document
type designed to leave the building.

AND THE SAME BRIEF HAS NO COVERAGE NOTE AT ALL. `REFERRAL_SECTION_IDS` runs
referral-cover, referral-project, referral-people, referral-conditions,
referral-press, referral-opportunity, referral-risk. Its limits live in "About
this brief", which states the filing/press split and the date range but states
no withheld count. For a one-project brief with nothing withheld that reads as
adequate; it is a structural absence rather than a decision, and it would print
nothing if something WERE withheld. Standing rule 3 has no exemption for short
documents.

### THEN: the fresh capture run across every live market, and the movement report.

### ALSO OPEN, FOUND TODAY, NOT PART OF TOMORROW'S THREE
- `an-agency-reaches-a-document-through-more-than-the-applicant-column` is a
  PENDING golden case. The applicant_type gate reaches 7 records on 4 projects;
  97 live records carry a government body in `presented_by` and 16 in an untyped
  `applicant`, over 82 projects, 71 of them New York City. Of 11 sources on live
  attached records, nyc-zap is the ONLY one that publishes a type. `City of
  Anaheim - presented by` prints in Simtec's OCVibe entry today.
- ZAP types "Phipps Houses" as Other Public Agency. It is a private non-profit
  developer. We store what the source states, so it is gated; the source is
  wrong. Attached to no project, so no document changes today.
- The W key double-toggle on the register reads `current.watch` from rows that
  may not have refetched between two presses, so the second press can re-issue
  the first mutation instead of reversing it. It made e2e/triage.shots.ts red on
  one run and green on the one before, and it leaves a project on the watchlist
  when it bites. Two projects are watched right now - Heart Hotel / Kulik River
  and Nevada Palace - and I did not touch either, because I cannot tell which is
  Philip's and which the failed run left.
- `npm run build` while a server is up leaves the running server serving a
  half-replaced .next and every screen renders empty. Three tests failed on their
  first assertion that way and none of it was real. Belongs in CLAUDE.md next to
  the OneDrive .next note: kill the listener by PID first, `pkill` does not.
