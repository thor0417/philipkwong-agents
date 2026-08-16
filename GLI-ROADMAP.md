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
