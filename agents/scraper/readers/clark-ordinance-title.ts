// THE CLARK COUNTY ORDINANCE AND AGREEMENT TITLE READER.
//
// The shape, the guard and the entry dedupe live in readers/core. This file is
// one form and nothing else.
//
// WHY A READER FOR A TITLE, WHEN EVERY OTHER READER TAKES A DOCUMENT.
//
// Measured 2026-08-22 over the whole live corpus. Clark County's 197 land-use
// cases (UC/WS/PA/ZC/DR/SDR/TM/ET/MPC/AR) carry 2,802 filing facts between them
// and publish a staff-report PDF 100% of the time. Its ORDINANCES and
// AGREEMENTS - ORD-nn-nnnnnn and AG-nn-nnnnnn - carry ZERO facts and publish a
// document 13% of the time. The fact reader is not failing on them; it is
// pointed at a staff sheet that ordinances do not have.
//
// The facts are in the title, and the title is stored. 54 of 112 ordinance and
// agreement titles state an acreage, 53 a use, 58 a set of cross streets and 58
// a counterparty; 65 yield at least one of the four with NO document fetch,
// across 57 live projects. The sharpest case is Athletics StadCo - the strongest
// project in the 2026-08-21 backfill cohort, three records, no facts at all -
// whose ORD title reads "for a recreational facility (baseball stadium) on 35.11
// acres, generally located at the southeast corner of Las Vegas Boulevard South
// and Tropicana Avenue within Paradise".
//
// THE FORM, as Clark prints it:
//
//   ORD-25-901050: Introduce an ordinance to consider adoption of a Development
//   Agreement with Sunset Canyon Corporate Center LLC for an office building on
//   2.08 acres, generally located north of Sunset Road and east of Tenaya Way
//   within Spring Valley. JJ/dw (For possible action)
//
//   AG-26-900559: Accept and authorize the signature of the Performance
//   Agreement with Athletics StadCo LLC for the A's Ballpark Southeast Garage
//   and Phase I of the Central Utility Plant, generally located east of S. Las
//   Vegas Boulevard and south of Tropicana Avenue within Paradise. JG/ja (For
//   possible action)
//
// CLARK ONLY, AND THAT IS A MEASUREMENT NOT A PREFERENCE. The same four patterns
// over Nashville's 35 ordinance records yield NOTHING - it writes "An ordinance
// approving an agreement between the Metropolitan Government and X relating to
// management, operation, and maintenance of Y", which states no acreage, no
// cross streets and no use - and over Phoenix's 13 they yield the counterparty
// alone. Extending to either means reading their prose, which is a different
// form and therefore a different reader. See standing rule 2.
//
// EVERY VALUE IS A VERBATIM SUBSTRING OF THE TITLE. verifyFilingFacts is run
// before anything is returned, so a pattern that ever assembles a value rather
// than quoting one throws instead of storing it.
import { type FilingFact, tidyLine, num, verifyFilingFacts } from './core';

/** ORD-25-901050 / AG-26-900559, with the leading agenda number Clark sometimes prefixes. */
const ORD_AG = /^\s*\d*\.?\s*(ORD|AG)-\d{2}-\d{5,6}\b/i;

export function isClarkOrdinanceTitle(text: string): boolean {
  return ORD_AG.test(text);
}

/**
 * A COUNTERPARTY IS NOT AN APPLICANT AND IS NOT A SPONSOR.
 *
 * Clark names the private party as the one the county is contracting WITH.
 * "Development Agreement with MAVERIK, Inc. for a gasoline station" makes
 * MAVERIK the counterparty. The trailing initials block ("JJ/dw") is the
 * assigned commissioner and planner and is deliberately not read here: staff are
 * never printed as a party (see case_planner in readers/core).
 */
const COUNTERPARTY = /\b(?:Agreement|agreement) with ([A-Z][^;]{2,80}?)(?:\s+for\b|\s+to\b|,\s*(?:generally|located))/;

/** "for a recreational facility (baseball stadium) on 35.11 acres" */
const PROJECT_TYPE = /\bfor (?:a|an|the) ([a-z][a-z0-9 '\/&()-]{3,70}?)(?=\s+on\s+[\d,]|\s*,\s*generally|\s+generally|\s*\.)/i;

/** "on 35.11 acres", "on a 7.5 acre portion of a 15.4 acre site" */
const ACREAGE = /\bon (?:a )?([\d,]+(?:\.\d+)?)\s*acres?\b/i;

/**
 * "generally located north of Sunset Road and east of Tenaya Way within Spring Valley"
 *
 * A FULL STOP IS NOT A TERMINATOR HERE, because Clark abbreviates directions in
 * street names. The first version stopped at any period and read
 * "east of S. Las Vegas Boulevard and south of Tropicana Avenue" as "east of S"
 * - a value that is verbatim, passes the guard, and is worse than nothing,
 * because it looks like an answer. So the clause ends where it actually ends:
 * at "within <township>", or at the trailing initials block Clark appends
 * ("JG/ja"), or at the end of the title.
 */
const CROSS_STREETS = /generally located,?\s+(.{8,160}?)(?:\s+within\b|\.\s*(?:[A-Z]{2,3}\/|\(For\b|$))/i;

/** "within Spring Valley", "within Paradise" - Clark's township. */
const TOWN = /\bwithin ([A-Z][A-Za-z' -]{2,40}?)(?:\.|,|\s*$|\s+[A-Z]{2}\/)/;

export function readOrdinanceTitleFacts(rawTitle: string): FilingFact[] {
  const title = tidyLine(rawTitle);
  if (!isClarkOrdinanceTitle(title)) return [];

  const facts: FilingFact[] = [];
  const add = (kind: FilingFact['kind'], label: string, display: string, value: number | null = null): void => {
    const d = display.trim().replace(/[,;.]+$/, '');
    if (!d) return;
    // The whole title is one line, so the line IS the title. That satisfies the
    // guard's second half honestly rather than by construction: the display has
    // to be a substring of it, which is exactly what we want to assert.
    facts.push({ kind, label, display: d, value, line: title });
  };

  const cp = COUNTERPARTY.exec(title);
  if (cp) add('counterparty', 'Agreement with', cp[1]);

  const pt = PROJECT_TYPE.exec(title);
  if (pt) add('project_type', 'for', pt[1]);

  const ac = ACREAGE.exec(title);
  if (ac) add('site_acreage', 'acres', ac[1], num(ac[1]));

  const cs = CROSS_STREETS.exec(title);
  if (cs) add('cross_streets', 'generally located', cs[1]);

  const tw = TOWN.exec(title);
  if (tw) add('town', 'within', tw[1]);

  // THE GUARD, on the title rather than on a document. A pattern that ever
  // reformats a value - strips a comma out of "35,110", say - fails here rather
  // than writing a number the county never printed.
  return verifyFilingFacts(facts, title);
}
