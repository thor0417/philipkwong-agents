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

/** What one project carries, as the entry that would print it carries it. */
export interface ProjectStandard {
  party: boolean;
  facts: boolean;
  conditions: boolean;
  decision: boolean;
}

export const meetsStandard = (p: ProjectStandard): boolean =>
  p.party && p.facts && p.conditions && p.decision;

export const shortfall = (p: ProjectStandard): StandardCriterion[] =>
  STANDARD_CRITERIA.filter((c) => !p[c]);

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
 */
export const MARKETS_AT_STANDARD: readonly string[] = ['Clark County'];

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
export function belowStandardNote(market: string, missing: readonly StandardCriterion[]): string {
  if (missing.length === 0) return '';
  const words: Record<StandardCriterion, string> = {
    party: 'the parties to the application',
    facts: 'the stated facts of the scheme',
    conditions: 'the conditions of approval',
    decision: 'the decision, its body and its date',
  };
  const named = missing.map((m) => words[m]);
  const list =
    named.length === 1
      ? named[0]
      : named.slice(0, -1).join(', ') + ' and ' + named[named.length - 1];
  return (
    `Coverage of ${market} does not reach ${list}. ` +
    `This is a limit of what we read in ${market}, not a finding that the record is silent on it.`
  );
}
