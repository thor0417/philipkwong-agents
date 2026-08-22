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
  { market: 'Central Florida Tourism Oversight District', regionState: 'Florida', country: 'United States', sources: ['cftod-pdf'], layers: 'legislative, entitlement' },
  { market: 'Broward County', regionState: 'Florida', country: 'United States', sources: ['legistar'], layers: 'legislative, entitlement' },
  { market: 'New York City', regionState: 'New York', country: 'United States', sources: ['nyc-zap', 'nyc-ceqr', 'nyc-city-record'], layers: 'environmental review and legal notices; entitlement frozen at April 2026; NO council' },
  { market: 'Yonkers', regionState: 'New York', country: 'United States', sources: ['legistar'], layers: 'legislative, entitlement' },
  { market: 'Westchester County', regionState: 'New York', country: 'United States', sources: ['legistar'], layers: 'legislative, entitlement' },
];

// ---- RETIRED FROM THE TABLE, TOMBSTONED RATHER THAN DELETED -----------------
//
// A market leaves this table when it stops being coverage. It does NOT leave the
// database: its records are marked lifecycle = 'retired' the way the tender and
// development-bank sources were, so a row read later says business decision
// rather than capture failure. Same rule as opportunity/RETIRED_SOURCES, applied
// to a market instead of a source.
//
// THE NAMES STAY HERE SO NOBODY RE-ADDS THEM. That is the whole point of the
// list: each entry carries the date of the newest document the feed ever gave
// us, so a future reader can see it was measured rather than guessed, and knows
// what would have to change before the row comes back.
//
// MEASURED 2026-08-21 by probing each feed's BODY, not its status code. All
// three answer HTTP 200 and two of them have answered 200 for years while
// serving nothing new.
export interface RetiredMarket {
  market: string;
  regionState: string;
  /** The newest document the feed ever produced for us. */
  lastDocument: string;
  retired: string;
  why: string;
  /** What would have to be true for it to come back. */
  revivesWhen: string;
}

export const RETIRED_MARKETS: RetiredMarket[] = [
  {
    market: 'Miami-Dade County',
    regionState: 'Florida',
    lastDocument: '2018-06-18',
    retired: '2026-08-21',
    why:
      'Legistar client `miamidade` answers 200 and its newest matter was introduced 2018-06-15. ' +
      'Probed again 2026-08-21: newest three are all June 2018 proclamations. Eight years dead, ' +
      'declared in lib/dead-feeds since 2026-08-19, and it went on being listed as coverage.',
    revivesWhen:
      'the Legistar Web API returns a matter introduced in the last twelve months, or an adapter ' +
      'reads www.miamidade.gov/govaction directly.',
  },
  {
    market: 'San Antonio',
    regionState: 'Texas',
    lastDocument: '2021-09-20',
    retired: '2026-08-21',
    why:
      'Legistar client `sanantonio` answers 200 and its newest matter is 2021-09-24, a Head Start ' +
      'grant approval. Five years dead. It was the only Texas market on the table, so US Texas ' +
      'coverage is now openly zero rather than nominally one.',
    revivesWhen: 'the feed returns a matter introduced in the last twelve months.',
  },
  {
    market: 'Lake Buena Vista',
    regionState: 'Florida',
    lastDocument: '2024-02-02',
    retired: '2026-08-21',
    why:
      'Added to the table on 2026-08-21 because SFWMD had produced 4 records here and the table ' +
      'listed it nowhere, and removed the same day because the check written in between said it ' +
      'was not coverage. Measured over the whole life of the SFWMD adapter: 25 records, 6 surviving, ' +
      'and TWO published in the last twelve months, both Bonita Springs and both dismissed. All 6 ' +
      'projects it produced hold SFWMD records and nothing else. The adapter is retired with it.',
    revivesWhen:
      'a Florida water-permit source publishes something from this decade. SFWMD is on ' +
      'RETIRED_SOURCES in agents/scraper/opportunity, so reviving the market means reviving the ' +
      'adapter first.',
  },
  {
    market: 'South Florida',
    regionState: 'Florida',
    lastDocument: '1983-01-03',
    retired: '2026-08-21',
    why:
      'Two SFWMD permits, published November 1982 and January 1983, captured 2026-07-24. The ' +
      'CAPTURE is fresh and the DOCUMENTS are 43 years old, which is the Miami-Dade signature one ' +
      'stage further gone. It was never declared anything: not dead, not stale, just listed.',
    revivesWhen:
      'the SFWMD adapter produces a permit from this decade. The same adapter still serves Lake ' +
      'Buena Vista, which is why sfwmd is not a retired source.',
  },
];

// A RETIREMENT IS ONLY AS DURABLE AS THE ADAPTER'S SILENCE, and this list cost
// a day learning it.
//
// Marking a market's records lifecycle='retired' does NOT hold while something
// still fetches them. The scrape path writes lifecycle on every upsert, so the
// next run of a live adapter resurrects the rows it reaches. Measured on
// 2026-08-21: South Florida's two records were retired in the morning and were
// back to 'active' by the afternoon's government run, because SFWMD was still in
// the lane. Miami-Dade and San Antonio stayed retired only because they left
// DEFAULT_JURISDICTIONS in the same commit.
//
// So retiring a market means retiring whatever reaches it. Where that source
// serves only the retired market, it goes to RETIRED_SOURCES; where it serves
// live markets too, the market row has to come off the adapter's own list
// instead. Either way the record-level tombstone is the LAST step and never the
// only one.
//
// YONKERS IS DELIBERATELY NOT HERE, AND THE REASON IS THE FINDING.
//
// It was proposed for retirement on the strongest-looking evidence in the pass:
// zero records from any source, ever, against a covered-market claim. Probing
// the feed BODY rather than trusting the count refuted it. webapi.legistar.com
// /v1/yonkersny returns matters dated 2026-06-12, and the newest three are
// inter-municipal DEVELOPER agreements - exactly the vertical. The jurisdiction
// is in DEFAULT_JURISDICTIONS, so the lane reads it on every government run.
//
// So Yonkers is not a market with nothing behind it. It is a LIVE feed carrying
// relevant matters that our gate admits none of, which is a capture defect
// wearing a coverage problem's clothes. Retiring it would have deleted the
// evidence and closed the question. It stays on the table, and it reads `thin`
// with the honest sentence the coverage audit already prints for it: "an adapter
// is pointed here and it has produced nothing at all".
const COVERED_KEYS = new Set(COVERED_MARKETS.map((m) => m.market.toLowerCase()));

const RETIRED_KEYS = new Set(RETIRED_MARKETS.map((m) => m.market.toLowerCase()));

/** True when a market was claimed once and has been retired from the table. */
export function isRetiredMarket(market: string | null | undefined): boolean {
  return !!market && RETIRED_KEYS.has(market.trim().toLowerCase());
}

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
  /** Every live record naming this market, attached or not. */
  records: number;
  /**
   * Age in days of the newest document we hold for it, or null if none.
   *
   * THIS CAN BE NEGATIVE AND THAT IS NOT AN ERROR. Legistar publishes agendas
   * for meetings that have not happened, so a market's newest document is
   * routinely dated in the future. Measured 2026-08-21: Phoenix's newest matter
   * is dated 2026-08-25, four days ahead, giving newestDocumentDays = -4.
   *
   * Every threshold below is an upper bound (`> STALE_DAYS`), so a negative
   * reads as very fresh and behaves correctly. What must not happen is a caller
   * treating negative as a bad value and reporting it as a failure, or clamping
   * it to zero and quietly losing the fact that we hold a scheduled hearing. A
   * future-dated agenda is the most valuable document in the corpus: it is the
   * only thing that says what happens next.
   */
  newestDocumentDays: number | null;
  /** Declared dead in lib/dead-feeds. */
  deadFeed: boolean;
  /** Declared degraded in the known-degraded register. */
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
  const { liveProjects, projectsNamingAParty, records, newestDocumentDays, deadFeed, degraded } =
    input;

  if (deadFeed) {
    return { state: 'dead', why: 'the source has published nothing for over a year; declared in lib/dead-feeds' };
  }
  if (degraded) {
    return { state: 'degraded', why: 'the adapter is failing in a known way; declared in the known-degraded register' };
  }
  // NO RECORDS AT ALL IS A DIFFERENT STATEMENT FROM UNDATED RECORDS, and saying
  // the wrong one is how Yonkers reported "no record here carries a date" while
  // holding no records whatsoever. Both are thin; only one of them is worth
  // acting on, and the operator has to be able to tell which.
  if (records === 0) {
    return { state: 'thin', why: 'an adapter is pointed here and it has produced nothing at all' };
  }
  if (newestDocumentDays === null) {
    return {
      state: 'thin',
      why: `${records} records here and not one carries a date, so nothing can be said about freshness`,
    };
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
