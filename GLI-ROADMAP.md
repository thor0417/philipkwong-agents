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
### L0. THE W KEY TOGGLES ONCE. THE SECOND PRESS DOES NOTHING.
  FIRST THING TOMORROW. It is the reason the gate is red and the reason the
  push of 2026-08-18 was made with --no-verify.

  e2e/triage.shots.ts:68 presses W, waits for the detail pane's button to change,
  presses W again and expects it back. The second press never lands. Reproduced
  three times against a freshly built server with the port free, deterministic,
  and it fails in BOTH directions - Watch -> Watching -> stuck, and Watching ->
  Watch -> stuck - so it is not about which state the project starts in.

  WHAT IS KNOWN. The handler is `watch.mutate({ id: current.id, watch:
  !current.watch })` at page.tsx:1022, and `current` is `rows[selectedIndex]`.
  The mutation carries NO optimistic update: `onSettled: invalidateAll`
  (lib/use-projects.ts:182). `rows` IS in the keydown effect's dependency array,
  so the closure is not permanently stale. The detail pane reflects the change
  and the second press still reads the old value, which points at the pane and
  the register reading two different queries and only one of them refetching.

  WHAT IS NOT KNOWN. Whether the register's list query is invalidated at all by
  invalidateAll, or invalidated under a key that does not match. Check that
  before writing anything: if the list is not refetching, the watch DOT on the
  row (page.tsx:1875) is also stale after a toggle, which is the same defect on
  a surface nobody has looked at.

  It leaves a project on the watchlist when it bites. Two are watched now, Heart
  Hotel / Kulik River and Nevada Palace. Philip is clearing them by hand; do not
  script it.

- The verify script deleted .next BEFORE running the Playwright suite
  (typecheck -> build -> clean -> shots), and Playwright reuses an existing
  server that serves out of that .next. Whatever the server had already loaded
  kept working and anything it needed afterwards did not, so tests failed one at
  a time, on a different test each run, with errors that read exactly like
  product defects: a page with no <header>, a register with no rows. FIXED
  2026-08-18 - clean now runs after shots - and asserted in e2e/harness.audit.ts
  so the order cannot drift back. It was NOT the cause of the W defect above;
  that was reproduced after this was fixed.
- `npm run build` while a server is up leaves the running server serving a
  half-replaced .next and every screen renders empty. Three tests failed on their
  first assertion that way and none of it was real. Belongs in CLAUDE.md next to
  the OneDrive .next note: kill the listener by PID first, `pkill` does not.

## THREE STAGE CHANGES THAT HAPPENED AND ARE NOT RECORDED, 2026-08-19

NOT BACKFILLED, AND THAT IS THE DECISION RATHER THAN AN OMISSION. A
reconstructed event dated from the record that probably caused it is a fact we
asserted, not one the system observed, and `project_events` is the audit trail.
A stated hole beats a plausible fill. This is the statement.

WHAT HAPPENED. `idx_project_events_dedupe` - a unique index applied by hand,
declared in no migration and named nowhere in this repo - omits `occurred_at`
from the identity of an event. A second event of the same type on the same
project carrying the same `from_value`, `to_value` and `lead_id` is therefore
refused however long afterwards it occurs. `recordManualEvent` swallowed the
23505 to a `console.error` and `emitProjectEvents` counted it as
`rejectedAsDuplicate`, which reads as a duplicate correctly removed.

Migration 039 drops that index. It does not recover what was lost.

HOW THEY WERE FOUND: three live projects carry a stage today that their own
event trail cannot reach. The last recorded transition ends somewhere else.

| project | last recorded transition | ends at | stage today | the missing transition |
|---|---|---|---|---|
| Heart Hotel / Kulik River | 2026-08-10 | stalled | approved | stalled to approved |
| Hudson Yards / Western Rail Yard | 2026-03-22 | under construction | dormant | under construction to dormant |
| Disneyland Resort | 2026-08-10 | under construction | approved | under construction to approved |

Each of the three had already recorded that exact transition once before, which
is why the repeat collided. Hudson Yards is the airtight case: its
`under construction -> dormant` of 2025-05-30 carries `lead_id` NULL, so the
return trip's key is identical in every constrained column.

WHY IT CANNOT BE RECOVERED. The event carries an `occurred_at`, and that date is
the fact. Nothing stored says when these three transitions happened: the
projects table keeps the current stage and not the date it was reached, and the
run that computed each change printed its counters to stdout and exited. Dating
them from the most plausible record would put a date we chose into the column a
reader trusts to say when something happened. `last_activity` is the date of a
RECORD, not of a stage decision, and the two are not the same thing.

WHAT IS AND IS NOT AFFECTED. None of the three would have printed as an ADVANCE
in a client document: `stalled` and `dormant` are off the stage ladder, so
`classifyStageTransition` reads two of them as `liveness`, and
`under construction -> approved` is a `corrected`. No client document has lost
an advance. What IS wrong today is the "What moved" section's own withheld
counters, which state how many corrected and liveness transitions were held
back, and are short by three.

THE EXPOSURE IS PROSPECTIVE AND REAL. Hilton Resorts advanced
`filed -> approved` on 2026-08-11 against lead `6820b2aa`. If that reading is
corrected and the project advances again on the same record, the key is
identical, the insert is refused, and "What moved" shows nothing while the
register shows approved.

WHAT WAS DONE INSTEAD OF A BACKFILL
- migration 039 drops the index, printed and blocking
- `recordManualEvent` returns a result; the register says "saved, and the
  history entry was refused" rather than nothing
- `emitProjectEvents` counts `refusedByACoarserIndex` apart from
  `rejectedAsDuplicate` and prints it loudly
- every emit appends its counters to `snapshots/project-events-emit.jsonl`, so
  "what did the last run attempt" survives the run
- golden case `a-manual-event-that-repeats-is-refused-and-not-recorded`

### 039 IS RUN, AND WHAT THE DROPPED INDEX CONSTRAINED IS NOT ON RECORD

Run 2026-08-19. `pg_indexes` now returns five rows on `project_events`:
`idx_project_events_identity` (unique), `idx_project_events_project`,
`idx_project_events_recent`, `idx_project_events_type`, `project_events_pkey`.
`idx_project_events_dedupe` is gone.

THE DEFINITION WAS NOT CAPTURED. The migration ran the `pg_indexes` SELECT
before the drop precisely so it would be, and the `indexdef` column was
truncated in the Supabase results pane. The index is now dropped, so there is no
second chance: WHAT IT ACTUALLY CONSTRAINED REMAINS AN INFERENCE and will stay
one permanently.

THE INFERENCE, and it is well supported but it is not a record. Every
observation fits an identity of `(project_id, event_type, from_value, to_value,
lead_id)` with `occurred_at` absent:

- 911 rows held 911 distinct keys on those five columns; no coarse key ever
  repeated, across four months and three write paths
- a repeat watch toggle seconds after the first returned 23505 naming this index,
  while `watch_added` and `watch_removed` on the same project both stored, so
  `event_type` is in it and `occurred_at` is not
- three projects carry a stage their trail cannot reach, and all three are
  projects that returned to a transition already recorded once

WHAT THIS COSTS US. The drop is safe on an argument that does not depend on the
inference: `idx_project_events_identity` constrains the same five columns PLUS
`occurred_at`, so whatever subset of those five the dropped index used, the
surviving index treats strictly fewer row pairs as equal. Nothing that was
storable is now unstorable, and nothing stored became insertable twice. That
argument holds without knowing the definition.

What we cannot do is say with certainty WHICH rows it refused historically. The
three named above are identified by the disagreement between `projects.stage`
and the last recorded transition, which is evidence of loss and not a list of
it. If a fourth event was refused on a project whose stage later returned to
where the trail says it is, that one is invisible and always will be.

THE RULE THIS EARNS. An index, constraint or policy applied by hand is applied
in a migration file in this repo first. `idx_project_events_dedupe` cost three
months of a silently lossy audit trail and its own definition, and both costs
came from the same thing: it existed only in the database.

PROVEN, 2026-08-19, and the proof is the write rather than the migration. A
`watch_added` on Heart Hotel / Kulik River identical in every constrained column
to the one stored on 2026-08-10, differing only in `occurred_at`, was ACCEPTED.
`project_events` went 911 to 912 rows and that project went from 2 watch events
to 3, having held 2 since 2026-08-10 through roughly thirty toggles.

### DEAD SCHEMA, LOGGED NOT DROPPED, 2026-08-19

Found by `agents/scraper/diagnostics/schema-drift.ts`. Declared in
`supabase/schema.sql`, absent from the live database, and read by no code in
either package. They are the v1.0 CRM that was never built.

    activities              table, absent
    contacts                table, absent
    deals                   table, absent
    leads.next_action       column, absent
    leads.next_action_date  column, absent

NOT DROPPED TODAY, and not because dropping is hard: because there is nothing
to drop. They do not exist. What exists is the DECLARATION, and deleting that
from the base schema is a real edit to a file that also creates `leads`, which
is not an edit to make while a capture run is settling.

They are recorded here so the next reader of `supabase/schema.sql` knows the
CRM half is aspirational rather than missing, and so a future audit run does
not re-report them as a finding.

## PER-SOURCE RUN-OVER-RUN COMPARISON BEGINS 2026-08-19. THERE IS NO EARLIER BASELINE.

READ THIS BEFORE READING THE NEXT MOVEMENT REPORT AS A DROP.

No capture run before 2026-08-19 wrote its per-source volume anywhere that
survived the run. The counts existed in console scrollback and nowhere else, and
the emit counters that would have shown what the movement layer attempted were
printed to stdout and discarded with it. So the first report that compares
"this run against the last run" has, for every source, a left-hand column that
did not exist.

WHAT THE BASELINE IS. The pair
`snapshots/corpus-2026-08-19T07-07-19-pre-run.json` and
`snapshots/corpus-2026-08-19T08-11-52-post-run-complete.json`, plus the two
lines in `snapshots/project-events-emit.jsonl` dated 2026-08-19:

    Serper half       974 fetched   51 written   emit: 14 attempted, 14 inserted
    Government half   374 attempted 279 written  emit: 80 attempted, 80 inserted
                      24 of 26 sources produced records

AND A SEPARATE REASON THE FIRST COMPARISON WILL LOOK WRONG. Every full-capture
claim in this repo before today ran `npm run scrape:all`, which reaches SERPER
AND NOTHING ELSE - the orchestrator contains no reference to the government
lane. So a next run that reports Legistar, NYC ZAP, CEQR, City Record, Anaheim
and Oakland volumes is not those sources recovering. It is those sources being
counted for the second time ever.

Both halves ran today only because they were run as two commands by hand. The
`npm run capture` command that runs every live lane in one process, with a
captured exit line per lane, is specified and not yet built.

A COUNT WITH NO PRIOR COUNT IS NOT A DROP AND IT IS NOT A RISE. It is the first
measurement, and this note exists so the second one is not misread as the
second half of a trend.

## TWO CITY RECORD SHAPES, LOGGED UNFIXED, 2026-08-19

City Record pages to yesterday's notices - 2,352 rows over 3 pages, newest
2026-08-18 - so nothing here is a capture lag. Both are losses at the gate.

### A TEXT AMENDMENT HAS NO SITE, NO APPLICANT AND NO ACTION VERB

The vocabulary gate reads an item's subject: a strong term, or a weak term plus
an action. A CITYWIDE TEXT AMENDMENT changes the rules rather than a parcel, so
it carries none of those and the gate cannot see it.

    2024-01-11  Borough President - Manhattan   Gaming Facility Text Amendment Proposal
    2024-01-11  Community Boards                PUBLIC HEARING ON THE GAMING FACILITY TEXT AMENDMENT

Both rejected `weak-without-action`. That is the instrument sitting underneath
Bally's Bronx and Metropolitan Park, both of which ARE in the register: we hold
the projects and not the rule that enabled them.

MEASURED. Of 2,325 rejected rows, 18 carry a hospitality word and every one is
`weak-without-action`. FOURTEEN of the 18 are NYC Parks golf and food
concessions - a snack bar in Alley Pond Park, a driving range concession - and
the gate is arguably RIGHT to drop those. The loss is two notices, not 2,255.

NOT FIXED TONIGHT. A rule admitting text amendments cannot key on the vocabulary
that defines this gate, and inventing one at the end of a long session is how a
gate gets loosened. It needs its own measurement.

### THE KNOWN-ENTITY BYPASS IS A DISCOVERY CEILING

Re-running `gateDecide` over the same 2,352 rows WITHOUT the entity index
admits 27. The live run admits 97. So roughly 70 of 97 City Record admissions
arrive because a party we ALREADY TRACK is named in them.

That is the feedback loop working as designed, and it is also the ceiling: City
Record's yield is a function of what we already hold rather than of what the
city published. A matter involving nobody we track must clear the vocabulary
gate alone, and 27 of 2,352 do - roughly 1 percent.

The discovery claim depends on the 27, not the 97. TOMORROW'S WORK.

### AND THE MEASUREMENT ITSELF WAS WRONG TWICE BEFORE IT WAS RIGHT

Recorded because the corrections are the method, not an aside:

  - the first probe read `g.admit`, a field GateVerdict does not have. Every row
    fell to the else branch and the output printed `strong 18` INSIDE the
    rejected bucket - a contradiction, which is how it was caught.
  - the second assembled its own gate text: `additional_description1` where the
    dataset has `additional_description_1`, and no `building_name`. It admitted
    19 against the live run's 97.

Only the third used the adapter's own `gateTextOf` and `gateDecide`. A second
opinion built on a different text is not a measurement of the gate.

## A LICENCE FILING AGAINST AN ADDRESS IS NOT A DEVELOPMENT, 2026-08-19

LOGGED, NOT FILTERED. Found while widening Simtec's scope to include `filed`,
which was the right change for a different reason - see below - and which let
these in as a side effect.

Twelve of the 29 projects entering that scope are single-record Las Vegas rows,
every one at significance 38.8 with exactly one record:

    2427 South Las Vegas Boulevard casino      221 North Rampart Boulevard
    2000 South Las Vegas Boulevard casino      KLA Capital Series 7 casino
    Proview Series 39 casino                   Fifth Street Gaming casino
    Brandywine Bookmaking casino               WILLIAM HILL ll casino
    Neon Museum                                Nevada Test Site Historical Foundation museum
    The Smith Center for Performing Arts       2427/2000 S Las Vegas Blvd variants

The shape: a GAMING OR LIQUOR LICENCE application filed against a street
address. The venue word is real - casino, museum - so the gate admits it, the
address becomes the project name, and it clusters as a project. It is not a
development. Nothing is proposed, nothing is built, and there is no applicant
who wants anything designed.

WHY IT IS NOT FILTERED TONIGHT. The obvious rule - drop single-record projects -
is a rule about our own capture depth rather than about the world, and it would
also drop Spring Valley Ice Rink, which is one record and a real ice rink. The
discriminator is the INSTRUMENT, not the record count, and reading the
instrument means reading the filing rather than counting rows.

IT WILL RECUR AND GET WORSE. The moment a Nevada Gaming Control Board lane
exists, licence filings arrive by the hundred against the same addresses. This
entry is here so that lane is built with an instrument rule from the start
rather than discovering the same shape at volume.

RELATED, AND THE REASON THIS WAS SEEN AT ALL: `The Smith Center for Performing
Arts` and `Neon Museum` are among the 17 projects the name-source measurement
recorded as correctly named from the applicant field. Their names are right.
What is wrong is that they are on the register as projects at all.

### A HARNESS THAT SLICES BEFORE IT SEARCHES IS TESTING ITS OWN WINDOW, 2026-08-19

`report.shots.ts` read `options.slice(1, 12)` to find a project with a filing in
the period. That held while a client scope proposed 14 projects. Widening
Simtec's scope to include `filed` took it to 43 and the slice became a RACE:
the light run found Heart Hotel and failed later, the dark run found nothing and
failed at the search. Same data, same moment, two different errors.

Fixed by searching the whole picker. The assertion did not change.

ONE OTHER INSTANCE, PASSING, NOT CHANGED TONIGHT:
`company.shots.ts:20` reads `els.slice(0, 8)` to find a project carrying a
party. It is better behaved - its failure message says "no project in the first
page had an identified party", so it names its own window rather than implying
it searched everything - but it is the same shape and it will fail the same way
if parties get sparser in the first eight rows.

THE SHAPE: a loop that probes the first N of a list THE PRODUCT CONTROLS. The
list length is a product decision, the N is a harness decision, and nothing
keeps them in step. Worth a sweep when there is time.

## MEMBERSHIP MUST TRAVEL WITH A RE-KEY, LOGGED NOT BUILT, 2026-08-22

Shipped today, in `agents/scraper/migrations/backfill-projects.ts`: the orphan
sweep reads `client_projects` before it deletes and keeps any project a client
holds a row for, whatever the status and whoever wrote it. Migration
`042_client_projects_restrict.sql` is printed and BLOCKING: it turns the
`on delete cascade` on `client_projects.project_id` into `on delete restrict`,
so a future write path that grows its own delete fails loudly instead of erasing
a confirmation.

THAT STOPS THE LOSS. IT DOES NOT FINISH THE JOB. The kept row now points at a
dead shell while the records live under a new project id, so the membership is
preserved and useless: the client's document will not print the project, because
the project it is confirmed against holds no records. Philip has to notice and
re-confirm against the new row.

WHAT THE REAL FIX IS. The clusterer knows the old key and the new key at the
moment it re-keys - that is the whole reason the shell exists to be swept. So
membership rows move in that same step:

  1. `project_key` changes; the leads are written to the new project id.
  2. Before the sweep runs, `client_projects` rows pointing at the old id are
     updated to the new id, per client, respecting the unique index on
     `(client_id, project_id)`: if the client already holds a row for the new
     id, keep the STRONGER state - `excluded` beats `included` beats `proposed`,
     because a refusal is a judgement and a proposal is a question.
  3. The move is logged the way deletions are, to
     `snapshots/membership-moved-<stamp>.json`, naming client, project, old id,
     new id and the status carried. A move nobody can see is the same defect as
     a deletion nobody can see.
  4. Only then does the sweep run. With the rows moved, the shell is genuinely
     uncurated and deletes cleanly.

WHY IT WAITS. Step 2 is the only part that can be wrong, and it can be wrong in
a way that silently changes what a client is sold: merging two projects merges
two membership decisions, and there is no measurement yet of how often a re-key
is a MERGE rather than a rename. That has to be measured before the code is
written.

## THE ONLY HARD DELETE HAS NO DRY RUN, COSTED 2026-08-22

`PROJECTS_NO_WRITE=1` returns from `runBackfill` at line 368, at the top of the
write section and BEFORE the orphan sweep at step 6. So the one path in this
system that hard-deletes is the one path the dry-run flag cannot preview: what
the sweep is about to remove can only be discovered by letting it remove it. The
guard shipped today is asserted in `verify-curation` against the exported pure
`orphanIsCurated`, which tests the RULE and not the sweep.

WHAT IT WOULD TAKE. Four changes, and one of them is a simplification that makes
the other three easy.

1. **KEY THE SWEEP ON `project_key`, NOT ON A STORED ID.** This is the change
   that matters and it is worth making on its own merits. Today:

       attachedCounts.set(stored.get(p.project_key)?.id, p.record_count)   // 571
       if ((attachedCounts.get(p.id) ?? 0) > 0) continue;                  // 574

   The sweep asks "does a cluster resolve to this row's ID", which requires the
   upserts in step 1 to have happened. Under a dry run they have not, so a
   cluster whose key is NEW has no id, and every row it should have claimed
   looks orphaned. Keying the map on `project_key` instead - which is one-to-one
   with the id inside a module - gives an identical answer in a real run and a
   CORRECT one in a dry run, with no dependency on writes at all.

2. **MOVE THE EARLY RETURN PAST THE SWEEP**, and guard each write where it
   happens rather than by leaving the function. Steps 3, 4 and 5 write only
   through `updateLeads`, so one `if (noWrite) return 0` inside it covers all
   three. Step 6 needs its `projects.update` and `projects.delete` guarded, and
   step 7's `emitProjectEvents` needs skipping.

3. **`loadProjects` MUST RUN UNDER `noWrite`.** It is a read, and step 2 already
   sits after the return purely by accident of ordering.

4. **THE PREVIEW WRITES A FILE, IT DOES NOT PRINT.** Standing rule 11: a
   generator that prints has produced nothing. `snapshots/orphans-would-remove-<stamp>.json`,
   the same shape as `orphans-removed-<stamp>.json` and named so the two cannot
   be confused when someone greps the directory a month later.

WHAT THE PREVIEW MUST SAY ABOUT ITSELF. Even with (1), a dry run has not created
the project rows a real run would, so a row whose records are moving to a
brand-new key is genuinely orphaned in the preview and genuinely swept in the
real run - the same answer for the same reason. That is correct and should be
stated rather than left for someone to rediscover: the preview reports what the
sweep WOULD do given the clustering it just computed, which is exactly the
question.

NOT DONE TODAY. It touches the write path of the only destructive step in the
system, which is not something to change in the same pass as the guard that
stops it losing data.

## DRY_RUN IS A SERPER FLAG DOCUMENTED AS A UNIVERSAL ONE, FOUND 2026-08-22

`DRY_RUN=1` is read by `orchestrator.ts` and by nothing in `government.ts`.
`docs/ADDING-A-MARKET.md` step 6 told you to use it for the first run of a new
market, and the first run of a new market is a government run.

Found by using it. Adding Broward County for Brief O item 2:

    DRY_RUN=1 npm run scrape:government -- --market="Broward County"
    Broward County, FL: 1152 fetched / 92 matched / 92 gate-admitted
                        | 92 inserted / 0 updated

Ninety-two rows written by the command documented as the one that writes
nothing. It cost nothing here because Broward was being added anyway and the
scope was right, which is exactly why it would not have been noticed.

Same shape as `scrape:all` not being every source: a flag that belongs to one
lane, described as if it belonged to the runtime.

DOC FIXED TODAY, CODE NOT. The page now says the flag does nothing in this lane
and that the first run is protected by SCOPE instead. The code fix is to make
`government.ts` honour `DRY_RUN` - refuse every write and say so in the run
report - and it is deliberately NOT bundled with a market addition, because it
changes the write path of the capture lane. It wants its own pass and its own
gate, the same way the orphan-sweep dry run does.

PART OF THE SAME PASS, NOT A SUGGESTION (Philip, 2026-08-22): sweep
`PROJECTS_NO_WRITE` and `HEALTH_NO_WRITE` for the same shape before the pass is
called done. A flag the runbook tells you to use, that does nothing, is worse
than no flag - it is the runbook actively misleading the person following it.

What the sweep has to answer for each flag, and the answer goes in the file that
documents it:

  1. which module reads it, by grep, not by reputation;
  2. which commands the runbook tells you to use it with;
  3. whether (1) covers (2), and where it does not, either make the code honour
     it or delete the claim from the doc. Both are acceptable; leaving the gap is
     not.

`PROJECTS_NO_WRITE` is already known to be half-honoured: it stops the writes in
`runBackfill` and returns BEFORE the orphan sweep, so the destructive step it
most needs to preview is the one step it cannot reach. That is written up above
as its own item and the two should be done together, because they are the same
question asked of two flags.

`HEALTH_NO_WRITE` is untested here. `source-health-never-applied` in the memory
notes says to keep it out of real runs and in every harness, which is a claim
about behaviour nobody has verified since.

