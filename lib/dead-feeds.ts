// MARKETS WHOSE SOURCE HAS STOPPED PUBLISHING.
//
// A market is declared here when the feed we read for it has published nothing
// for STALE_MONTHS. Everything downstream reads this one list: the report path
// excludes these markets from client documents and says so, the register marks
// their projects, the run-health surface prints the declaration, and
// verify-staleness checks the declaration against the live source in both
// directions.
//
// WHY THIS IS NOT PART OF THE KNOWN-DEGRADED REGISTER, which is the obvious
// place for it. degraded-sources suppresses an ALARM for a unit that is failing
// in a known way, and it keys on a health verdict. A frozen feed produces no
// health verdict to key on: Legistar fetches Miami-Dade's matters successfully
// and keeps them successfully, every run, exactly as it did in 2018. Health asks
// "did this source produce?" and the answer is yes. The question this file asks
// is "is what it produces still moving?", which is a different axis, and
// answering it with a suppression entry would have meant declaring a healthy
// source unhealthy in order to describe it.
//
// WHY IT LIVES IN ROOT lib/ AND IS IMPORTED ACROSS THE PACKAGE SPLIT rather
// than mirrored into dashboard/lib the way taxonomy.ts is. A mirror drifts, and
// the cost of drift here is asymmetric: the copy that goes stale is the one that
// decides what a client is told. A market that has recovered but is still
// declared dead in the dashboard's copy is a market silently withheld from a
// paying client; a market that has died but is only declared in the root copy is
// a 2018 filing presented as current. Neither is survivable, so there is one
// copy. This file imports nothing, which is what lets the Next build reach it
// (see experimental.externalDir in dashboard/next.config.js).
//
// MEASURED 2026-08-14. Both entries were found by asking each configured
// Legistar client for its newest matter. Nothing in the system had said a word,
// because source_health holds one row and a baseline needs history.

export interface DeadFeed {
  // Exactly the value stored in projects.market, because that is the column the
  // exclusion filters on. Matched case-insensitively; nothing else is matched
  // loosely, since a market withheld by a near-miss is worse than one withheld
  // by an exact rule.
  market: string;
  regionState: string;
  country: string;
  // The feed we read for this market, named the way its lane names it, so
  // verify-staleness can tie a declaration to a probe rather than to a comment.
  client: string;
  lane: string;
  // The newest thing the feed carries. Everything after this date is invisible
  // to us, and this is the date the documents quote.
  frozenSince: string;
  // When we last measured it, so an entry that has sat here unchecked for a year
  // is visibly a year old. Same discipline as degraded-sources.
  measured: string;
  // What we saw, in a sentence someone can re-run.
  evidence: string;
  // Where the jurisdiction actually publishes now, or null where we could not
  // establish it. Null is a real answer and must not be written as a guess.
  liveDataAt: string | null;
  // THE CONDITION THAT REMOVES THIS ENTRY. An exclusion with no expiry is how a
  // market stays withheld for a year after its feed came back. verify-staleness
  // fails the gate when a declared feed starts publishing again, which forces
  // this entry to be deleted rather than left to rot.
  revivesWhen: string;
}

export const DEAD_FEEDS: DeadFeed[] = [
  {
    market: 'Miami-Dade County',
    regionState: 'Florida',
    country: 'United States',
    client: 'miamidade',
    lane: 'government',
    frozenSince: '2018-06-15',
    measured: '2026-08-14',
    evidence:
      'webapi.legistar.com/v1/miamidade answers 200 and holds 107 matters, the newest introduced ' +
      '2018-06-15, and zero in the last twelve months. The Legistar portal shell at ' +
      'miamidade.legistar.com/Calendar.aspx also answers 200 and its initial HTML carries zero ' +
      'meeting rows, where Nashville carries 91.',
    liveDataAt: 'www.miamidade.gov/govaction/',
    revivesWhen:
      'the Legistar Web API returns any matter introduced in the last twelve months, or a Miami-Dade ' +
      'adapter reads www.miamidade.gov/govaction directly. Either way this entry is deleted, not edited.',
  },
  {
    market: 'San Antonio',
    regionState: 'Texas',
    country: 'United States',
    client: 'sanantonio',
    lane: 'government',
    frozenSince: '2021-09-24',
    measured: '2026-08-14',
    evidence:
      'webapi.legistar.com/v1/sanantonio answers 200 with a newest matter of 2021-09-24, a newest ' +
      'event of 2021-09-30, and zero matters in the last twelve months.',
    // A 403 from Cloudflare means the host exists and is protected, which is not
    // the same as a 404. It is the same wall Las Vegas PrimeGov sits behind.
    liveDataAt: 'sanantonio.primegov.com (PrimeGov; returns HTTP 403 from Cloudflare to us)',
    revivesWhen:
      'the Legistar Web API returns a matter from the last twelve months, or the PrimeGov adapter ' +
      'reaches sanantonio.primegov.com the way it reaches other PrimeGov clients.',
  },
];

/** The declaration covering a market, if it has one. */
export function deadFeedForMarket(
  market: string | null | undefined,
  regionState?: string | null
): DeadFeed | null {
  const m = String(market ?? '').trim().toLowerCase();
  if (!m) return null;
  for (const f of DEAD_FEEDS) {
    if (f.market.toLowerCase() !== m) continue;
    // The region is checked only when the row carries one. A project with no
    // region still matches its market, because the market string is the
    // identifying fact and a missing region is missing data rather than a
    // different place.
    const r = String(regionState ?? '').trim().toLowerCase();
    if (r && f.regionState.toLowerCase() !== r) continue;
    return f;
  }
  return null;
}

/** Whether a market is one we can no longer speak about in the present tense. */
export function isDeadFeedMarket(
  market: string | null | undefined,
  regionState?: string | null
): boolean {
  return deadFeedForMarket(market, regionState) !== null;
}

/** The declaration for a Legistar client, for the staleness check and Health. */
export function deadFeedForClient(client: string): DeadFeed | null {
  return DEAD_FEEDS.find((f) => f.client === client) ?? null;
}

/**
 * How a frozen market is described to a client, in one sentence.
 *
 * ONE BUILDER, SO EVERY DOCUMENT SAYS THE SAME THING. The count and the reason
 * are the rule; the freeze date is what makes the sentence useful, because
 * "we do not cover San Antonio" and "we covered San Antonio until September
 * 2021" are different facts and the client is owed the second one.
 *
 * It does not name the vendor, the API or the HTTP status. A client reading
 * "Legistar Web API" learns about our plumbing, which is the same category error
 * as printing the word Provisional.
 */
export function frozenMarketSentence(feeds: { feed: DeadFeed; projects: number }[]): string {
  const parts = feeds
    .slice()
    .sort((a, b) => b.projects - a.projects || a.feed.market.localeCompare(b.feed.market))
    .map(
      ({ feed, projects }) =>
        `${feed.market} (${projects} project${projects === 1 ? '' : 's'}, nothing published since ` +
        `${monthYear(feed.frozenSince)})`
    );
  const total = feeds.reduce((n, f) => n + f.projects, 0);
  // TWO COUNTS, AND THEY AGREE WITH DIFFERENT WORDS. `feeds.length` is how many
  // MARKETS are frozen and `total` is how many PROJECTS were held out; the first
  // draft of this sentence used one to inflect a pronoun standing for the other
  // and produced "the source we read for its market ... describing them here",
  // over three projects in one market. Every clause below states which count it
  // is agreeing with.
  const oneMarket = feeds.length === 1;
  const oneProject = total === 1;
  return (
    `${total} project${oneProject ? '' : 's'} ${oneProject ? 'is' : 'are'} held out of this document ` +
    `because the public source we read for ${oneMarket ? 'that market' : 'those markets'} has ` +
    `stopped publishing. We hold real filings for ${oneProject ? 'it' : 'them'} and ` +
    `${oneProject ? 'it is' : 'they are'} old, so describing ${oneProject ? 'it' : 'them'} here would ` +
    `present past activity as current. By market: ${parts.join(', ')}. ` +
    `${oneProject ? 'It remains' : 'They remain'} on the register with the date of the last ` +
    `filing we hold.`
  );
}

/** '2018-06-15' as 'June 2018'. Dates a client reads are not ISO. */
export function monthYear(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
