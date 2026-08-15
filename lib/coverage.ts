// WHAT WE ACTUALLY WATCH, AND HOW WELL.
//
// A geography tree listing sixty-five countries with counts beside them reads as
// coverage. It is not. Thirteen of those places have a government-lane adapter
// pointed at them; every other entry is where a press story happened to land,
// and the two must never be shown as the same kind of thing. A client's cover
// page saying "New York City" is a claim; a client's cover page saying "Bishkek"
// because one headline mentioned it is a lie the client will only discover when
// they ask about something we never saw.
//
// SO THIS FILE DECLARES THE COVERED MARKETS, and everything downstream reads it:
// the navigation splits on it, the Health screen states it, and the report path
// can be held to it.
//
// FIVE STATES, NOT ONE BOOLEAN. "Covered" is not a yes or no, and pretending it
// is has cost this project twice already - once when two markets sat on the
// covered list for years while their feeds were frozen, and once when a market
// that captures and clusters perfectly well produced an empty report because it
// names nobody.
//
//   dead      the source has stopped publishing. Declared in lib/dead-feeds on a
//             measurement of the SOURCE, never inferred from our own captures.
//   degraded  the adapter is failing in a known, written-down way. Declared in
//             agents/scraper/degraded-sources.
//   stale     the source still answers, but the newest document we hold from it
//             is older than STALE_DAYS. Not yet dead; the same shape of failure
//             at an earlier stage.
//   thin      it captures and it clusters and it cannot name a party, so a
//             report scoped to it comes out empty. Nashville: nine projects, one
//             naming anybody.
//   live      none of the above.
//
// WHY IT LIVES IN ROOT lib/ AND IS IMPORTED ACROSS THE PACKAGE SPLIT, rather
// than mirrored into dashboard/lib the way taxonomy.ts is: the same asymmetry
// that put dead-feeds here. The copy that goes stale is the one that decides
// what a client is told. This file imports nothing, which is what lets the Next
// build reach it (see experimental.externalDir in dashboard/next.config.js).

export type CoverageState = 'live' | 'degraded' | 'stale' | 'thin' | 'dead';

export interface CoveredMarket {
  /** Exactly the value stored in projects.market and leads.market. */
  market: string;
  regionState: string;
  country: string;
  /** The lanes pointed at it, named the way their adapters are named. */
  sources: string[];
  /** What the adapters reach here, from the eight-layer blueprint. */
  layers: string;
}

// THE THIRTEEN CLAIMED MARKETS, from docs/COVERAGE-MAP.md, which is the
// document this list has to agree with. A market is here because an adapter is
// POINTED at it, not because the corpus happens to hold records naming it -
// those are press captures and they are the other side of the split.
export const COVERED_MARKETS: CoveredMarket[] = [
  { market: 'Clark County', regionState: 'Nevada', country: 'United States', sources: ['legistar', 'clark-tab'], layers: 'legislative, entitlement' },
  { market: 'Las Vegas', regionState: 'Nevada', country: 'United States', sources: ['agenda-portal'], layers: 'legislative, entitlement' },
  { market: 'Anaheim', regionState: 'California', country: 'United States', sources: ['agenda-portal', 'ceqanet'], layers: 'legislative, entitlement, part of environmental' },
  { market: 'Oakland', regionState: 'California', country: 'United States', sources: ['legistar', 'ceqanet'], layers: 'legislative, entitlement, part of environmental' },
  { market: 'Phoenix', regionState: 'Arizona', country: 'United States', sources: ['legistar'], layers: 'legislative, entitlement' },
  { market: 'Nashville', regionState: 'Tennessee', country: 'United States', sources: ['legistar'], layers: 'legislative, entitlement' },
  { market: 'San Antonio', regionState: 'Texas', country: 'United States', sources: ['legistar'], layers: 'legislative, entitlement' },
  { market: 'Miami-Dade County', regionState: 'Florida', country: 'United States', sources: ['legistar'], layers: 'legislative, entitlement' },
  { market: 'South Florida', regionState: 'Florida', country: 'United States', sources: ['sfwmd'], layers: 'utility permits only' },
  { market: 'Central Florida Tourism Oversight District', regionState: 'Florida', country: 'United States', sources: ['cftod-pdf'], layers: 'legislative, entitlement' },
  { market: 'New York City', regionState: 'New York', country: 'United States', sources: ['nyc-zap', 'nyc-ceqr', 'nyc-city-record'], layers: 'environmental review and legal notices; entitlement frozen at April 2026; NO council' },
  { market: 'Yonkers', regionState: 'New York', country: 'United States', sources: ['legistar'], layers: 'legislative, entitlement' },
  { market: 'Westchester County', regionState: 'New York', country: 'United States', sources: ['legistar'], layers: 'legislative, entitlement' },
];

const COVERED_KEYS = new Set(COVERED_MARKETS.map((m) => m.market.toLowerCase()));

/** True when a market value names a market an adapter is pointed at. */
export function isCoveredMarket(market: string | null | undefined): boolean {
  return !!market && COVERED_KEYS.has(market.trim().toLowerCase());
}

export function coveredMarket(market: string | null | undefined): CoveredMarket | null {
  if (!market) return null;
  const key = market.trim().toLowerCase();
  return COVERED_MARKETS.find((m) => m.market.toLowerCase() === key) ?? null;
}

// ---- THE THRESHOLDS ----------------------------------------------------------
//
// Both are stated here rather than buried at the call site, because a coverage
// state that decides what a client is sold must be arguable.

/**
 * A source that still answers but whose newest DOCUMENT is older than this is
 * stale. Ninety days is a quarter: it is long enough that a council in summer
 * recess (Yonkers, measured at 57 days and explained) does not trip it, and
 * short enough to catch a feed that has quietly stopped months before the
 * twelve-month dead-feed rule would.
 */
export const STALE_DAYS = 90;

/**
 * A market is thin when fewer than this share of its live projects name a party.
 *
 * A project with no named party cannot carry an entry in a client document -
 * there is nobody to say who is doing it - so a market below this line captures,
 * clusters, and produces nothing sellable. Measured: Nashville is 1 of 9, which
 * is 11%; every other live market is at or above 85%. Half is a wide margin
 * around a gap that is currently unambiguous, so the rule cannot flip on one
 * filing either way.
 */
export const THIN_NAMED_SHARE = 0.5;

/** Below this many live projects, share is noise and the count is the fact. */
export const THIN_MIN_PROJECTS = 3;

export interface CoverageInput {
  /** Live projects reachable through this market. */
  liveProjects: number;
  /** Of those, how many have at least one record naming a party. */
  projectsNamingAParty: number;
  /** Age in days of the newest document we hold for it, or null if none. */
  newestDocumentDays: number | null;
  /** Declared dead in lib/dead-feeds. */
  deadFeed: boolean;
  /** Declared degraded in agents/scraper/degraded-sources. */
  degraded: boolean;
}

export interface Coverage {
  state: CoverageState;
  /** One sentence, in numbers, for a person deciding whether to sell it. */
  why: string;
}

/**
 * The state, and why.
 *
 * PRECEDENCE IS DELIBERATE AND IS THE ORDER OF SEVERITY. A dead market is also
 * stale and also thin; saying "thin" about Miami-Dade would be true and useless.
 * Each state is the WORST thing true of the market.
 */
export function coverageFor(input: CoverageInput): Coverage {
  const { liveProjects, projectsNamingAParty, newestDocumentDays, deadFeed, degraded } = input;

  if (deadFeed) {
    return { state: 'dead', why: 'the source has published nothing for over a year; declared in lib/dead-feeds' };
  }
  if (degraded) {
    return { state: 'degraded', why: 'the adapter is failing in a known way; declared in degraded-sources' };
  }
  if (newestDocumentDays === null) {
    return { state: 'thin', why: 'no record here carries a date, so nothing can be said about freshness' };
  }
  if (newestDocumentDays > STALE_DAYS) {
    return {
      state: 'stale',
      why: `the newest document we hold is ${newestDocumentDays} days old, past the ${STALE_DAYS}-day line`,
    };
  }
  if (liveProjects === 0) {
    return { state: 'thin', why: 'captured records, but nothing that survived into a project' };
  }
  if (liveProjects >= THIN_MIN_PROJECTS && projectsNamingAParty / liveProjects < THIN_NAMED_SHARE) {
    return {
      state: 'thin',
      why: `${projectsNamingAParty} of ${liveProjects} projects name a party, so a report scoped here comes out mostly empty`,
    };
  }
  return {
    state: 'live',
    why: `${liveProjects} live projects, ${projectsNamingAParty} naming a party, newest document ${newestDocumentDays} days old`,
  };
}

/** Ordering for a list a person reads worst-first. */
export const COVERAGE_ORDER: Record<CoverageState, number> = {
  dead: 0,
  degraded: 1,
  stale: 2,
  thin: 3,
  live: 4,
};

export const COVERAGE_LABEL: Record<CoverageState, string> = {
  dead: 'dead',
  degraded: 'degraded',
  stale: 'stale',
  thin: 'thin',
  live: 'live',
};
