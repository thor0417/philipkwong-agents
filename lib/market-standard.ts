// WHAT "COVERED" MEANS. Brief T.
//
// Nothing in this repository defined it, so a market was added when its records
// arrived rather than when it reached a standard. The result, measured on
// 2026-08-25: 14 live projects clear all four criteria and every one of them is
// Clark County. Not because Clark has better projects - because Clark is the
// only jurisdiction with a conditions reader, and no other market's projects
// fail on parties or on facts.
//
// THE STANDARD IS READ OFF CLARK COUNTY RATHER THAN INVENTED. Heart Hotel and
// Tropicana Land carry four things and every one of them comes out of the same
// document, the Clark County agenda sheet, through readers/clark-agenda-sheet:
// a named party, stated facts about the scheme, conditions of approval, and a
// decision with the body and the date.
//
// IMPORT-FREE ON PURPOSE. This is read from BOTH packages - the check in
// agents/, and the coverage note a client document prints - and a file that
// imports nothing can be resolved from the dashboard's own node_modules. Same
// rule and the same reason as lib/dead-feeds and lib/corpus-scope: a mirrored
// copy is a copy that goes stale, and the stale half decides what a client is
// told. See CLAUDE.md on the asymmetric split.

/**
 * A DECISION IS THE ONLY ONE OF THE FOUR THAT IS NOT A FIELD OF ITS OWN.
 *
 * Parties, conditions and stated facts are each a block on the entry. A decision
 * arrives as a stated fact of a particular KIND, carrying the deciding body in
 * its label and the date inside the line the document printed. Clark prints
 *
 *   COUNTY COMMISSION ACTION: April 8, 2026 - HELD - To 04/22/26
 *
 * so there is nothing to read but the kind. Any check for "carries a decision"
 * has to name these.
 */
export const DECISION_FACT_KINDS: ReadonlySet<string> = new Set([
  'commission_action',
  'board_action',
  'the_vote',
  'nyc_approved',
]);

/**
 * Acreage, zone, storeys, rooms and parking as Brief T names them, plus the rest
 * of the what-and-where set the same readers produce.
 *
 * DELIBERATELY DISJOINT FROM THE DECISION KINDS. A project whose only stated
 * fact IS the decision states nothing about the scheme, and counting it as
 * carrying facts would let the decision criterion satisfy the facts criterion.
 */
export const SCHEME_FACT_KINDS: ReadonlySet<string> = new Set([
  // what
  'site_acreage', 'project_type', 'units', 'density', 'stories', 'height_feet',
  'floor_area', 'open_space', 'parking', 'rooms', 'seats', 'lots', 'unit_size',
  'existing_land_use',
  // where
  'site_address', 'cross_streets', 'apn', 'town', 'land_use_plan', 'zone',
  'nyc_block_lot', 'nyc_borough',
]);

/** The four, in the order a reader meets them on the page. */
export const STANDARD_CRITERIA = ['party', 'facts', 'conditions', 'decision'] as const;
export type StandardCriterion = (typeof STANDARD_CRITERIA)[number];

// ---- THREE OF THE FOUR ARE UNIVERSAL AND ONE IS NOT --------------------------
//
// The first definition asked every market for all four, which made the standard
// unreachable everywhere but Clark and said nothing about why. PROBED 2026-08-25,
// 69 distinct documents fetched and parsed, 100% parse rate, with three Clark
// documents whose conditions already reached the corpus carried as CONTROLS so a
// silent probe could not pass for a negative result:
//
//   Nashville           9 documents   0 with a conditions heading
//   Oakland             7 documents   2 headings, both REFERENCES not lists
//   CFTOD               3 documents   1 heading, bond covenant language
//   Clark, unread       19 documents  1 heading, pre-application meeting boilerplate
//   Clark, Legistar     31 documents  2 headings, Title 30 zoning CODE text
//   Clark CONTROL       3 documents   3 headings, 5 to 10 real conditions each
//
// NOT ONE per-project condition outside the Clark County agenda sheet. The two
// Oakland hits are the sharpest evidence, because they are the near miss: a
// staff report says the project must "comply with the applicable mitigation
// measures identified in the LMSAP EIR and the City's Standard Conditions of
// Approval". Oakland HAS standard conditions - as a standing citywide document
// the report cites and does not reproduce. Clark's Title 30 hit is the same
// shape: "Conditions of Approval" as a procedure heading in the zoning code.
//
// A STANDING CODE CONDITION IS NOT A FACT ABOUT THE PROJECT, and printing one
// under a project's name would be the label-read-as-the-thing-it-names defect
// with a county link under it. So conditions stay a criterion and stop being a
// universal one: they are asked of a market only where the market publishes
// them per project.
export const UNIVERSAL_CRITERIA: readonly StandardCriterion[] = ['party', 'facts', 'decision'];

/**
 * WHERE CONDITIONS ARE PUBLISHED PER PROJECT, measured rather than assumed. A
 * market absent from this list is not failing: its publisher does not print the
 * thing, and a document that says otherwise misdescribes the source.
 *
 * Re-probe with agents/scraper/diagnostics/conditions-probe before adding one.
 */
export const MARKETS_PUBLISHING_CONDITIONS: readonly string[] = ['Clark County'];

export const conditionsApply = (market: string): boolean =>
  MARKETS_PUBLISHING_CONDITIONS.includes(market);

/** What this market is actually asked for. */
export const criteriaFor = (market: string): readonly StandardCriterion[] =>
  conditionsApply(market) ? STANDARD_CRITERIA : UNIVERSAL_CRITERIA;

/** What one project carries, as the entry that would print it carries it. */
export interface ProjectStandard {
  party: boolean;
  facts: boolean;
  conditions: boolean;
  decision: boolean;
}

export const meetsStandard = (market: string, p: ProjectStandard): boolean =>
  criteriaFor(market).every((c) => p[c]);

export const shortfall = (market: string, p: ProjectStandard): StandardCriterion[] =>
  criteriaFor(market).filter((c) => !p[c]);

/**
 * THE MARKETS DECLARED AT STANDARD, and the check reconciles BOTH WAYS against
 * it - the same shape as verify-coverage-table, for the same reason. A market
 * that quietly stops clearing the bar and a market that quietly starts are both
 * things nobody would notice, and only one of them is bad news.
 *
 * A market is at standard when at least one live project in it clears all four.
 * That is a low bar ON PURPOSE: it asks whether the machinery exists for the
 * market at all, not how much of the market it reaches. Clark clears all four on
 * 14 of 111 live projects and no other market clears it on any.
 *
 * Measured 2026-08-25. Adding a market here without the measurement behind it is
 * the defect this file exists to prevent.
 *
 * NEW YORK CITY ARRIVED THE MOMENT CONDITIONS STOPPED BEING UNIVERSAL, and that
 * is the whole argument for the split. Under the first definition it read as
 * below standard on conditions its publisher does not print. Asked only what it
 * can answer, 5 of its 40 live projects carry a named party, stated facts and a
 * decision with a body and a date - through readers/nyc-records rather than any
 * document, since all 175 of its primary_document_url values are application
 * pages and none is a file.
 *
 * The check found this itself: it failed as "meeting the standard and not
 * declared" on the first run after the split, which is the both-ways
 * reconciliation earning its place on its first real use.
 */
export const MARKETS_AT_STANDARD: readonly string[] = ['Clark County', 'New York City'];

/**
 * WHAT A CLIENT DOCUMENT SAYS ABOUT A MARKET BELOW STANDARD.
 *
 * Standing rule 3: nothing is silently absent. A Nashville project reading thin
 * without the document saying the market cannot go deeper is exactly the failure
 * the provenance layer exists to prevent - the reader takes a thin entry as a
 * quiet project rather than as a limit of the coverage.
 *
 * It states the market and what is missing, and it does NOT refuse to build. A
 * stated gap is the product; a refusal is an outage.
 */
// ---- WHAT A CLIENT DOCUMENT SAYS, IN TWO SENTENCES THAT ARE NOT THE SAME ----
//
// Standing rule 3: nothing is silently absent. A Nashville project reading thin
// without the document saying the market cannot go deeper is exactly the failure
// the provenance layer exists to prevent - the reader takes a thin entry for a
// quiet project rather than for a limit.
//
// BUT "BELOW STANDARD ON CONDITIONS" IS A CLAIM ABOUT US AND IT IS FALSE
// EVERYWHERE BUT CLARK. Probed 2026-08-25 over 69 documents: no jurisdiction
// outside the Clark County agenda sheet publishes a per-project condition at
// all. Telling a reader we do not reach Nashville's conditions sends them
// looking for a document nobody wrote. So the two limits get two sentences: one
// about what we do not read, which is ours to close, and one about what the
// publisher does not print, which is not.
//
// Neither refuses to build. A stated gap is the product; a refusal is an outage.

const CRITERION_WORDS: Record<StandardCriterion, string> = {
  party: 'the parties to the application',
  facts: 'the stated facts of the scheme',
  conditions: 'the conditions of approval',
  decision: 'the decision, its body and its date',
};

const listOf = (xs: readonly string[]): string =>
  xs.length === 0 ? '' : xs.length === 1 ? xs[0] : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];

/** What WE do not read in this market. Empty where nothing is missing. */
export function coverageLimitNote(market: string, missing: readonly StandardCriterion[]): string {
  const ours = missing.filter((m) => m !== 'conditions' || conditionsApply(market));
  if (ours.length === 0) return '';
  return (
    `Coverage of ${market} does not reach ${listOf(ours.map((m) => CRITERION_WORDS[m]))}. ` +
    `This is a limit of what we read in ${market}, not a finding that the record is silent on it.`
  );
}

/**
 * What the PUBLISHERS do not print, named together in one sentence rather than
 * repeated per market, because it is one fact about several places.
 *
 * Oakland is the reason this is worded as "per project" rather than "at all": a
 * staff report there requires compliance with "the City's Standard Conditions of
 * Approval", which exist as a standing citywide document it cites and does not
 * reproduce. A standing code requirement is not a term attached to this
 * approval, and printing one under a project's name would be a wrong quotation
 * under a government link.
 */
export function conditionsNotPublishedNote(markets: readonly string[]): string {
  const absent = [...new Set(markets.filter((m) => m && !conditionsApply(m)))].sort();
  if (absent.length === 0) return '';
  const publish = listOf([...MARKETS_PUBLISHING_CONDITIONS].sort());
  return (
    `Conditions of approval are published per project in ${publish}, and nowhere else this ` +
    `document covers: ${listOf(absent)} ${absent.length === 1 ? 'does' : 'do'} not publish them per ` +
    `project. Nothing here should be read as saying an approval in ${absent.length === 1 ? absent[0] : 'those markets'} ` +
    `carries no conditions. Where such requirements exist they are standing requirements of the ` +
    `jurisdiction rather than terms attached to this approval, and we do not reproduce them.`
  );
}
