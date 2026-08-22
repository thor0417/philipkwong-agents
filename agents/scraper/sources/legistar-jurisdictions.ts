// WHICH LEGISTAR JURISDICTIONS ARE CONFIGURED. The list, and nothing else.
//
// SPLIT OUT SO A CHECK CAN READ IT WITHOUT READING THE DATABASE.
// agents/scraper/verify-staleness asks each of these clients whether its feed is
// still moving, and it must be runnable with no credentials at all - it reads
// the SOURCE, never our tables. Importing sources/legistar for the list pulled
// in supabase-admin transitively and the check died on a missing key.
//
// The alternative was a second copy of the list inside the checker, which is the
// thing that drifts: a jurisdiction added to the lane and not to the check is a
// jurisdiction whose feed nobody watches, which is exactly the failure that put
// Miami-Dade and San Antonio on the covered-markets table with dead feeds.
//
// This file must import nothing.

export interface LegistarJurisdiction {
  client: string;
  jurisdictionLabel: string;
  reason: string;
  // Single-purpose district: capture every record, skip the keyword gate.
  bypassGate?: boolean;
}
// Exported so verify-staleness asks about the SAME list the lane reads, rather
// than a second copy that can drift from it.
export const DEFAULT_JURISDICTIONS: LegistarJurisdiction[] = [
  { client: 'clark', jurisdictionLabel: 'Clark County, NV', reason: 'Strip-adjacent entitlement; Top Gun / The Strat county layer; Area15 territory.' },
  // miamidade and sanantonio REMOVED 2026-08-21 with their markets. Both answer
  // HTTP 200 and have for years; probed by BODY on the day they were retired,
  // miamidade's newest matter is 2018-06-15 and sanantonio's is 2021-09-24. A
  // config row for a feed we no longer claim is a request made on every run for
  // documents we have already decided not to sell, and it is what kept them
  // looking maintained. See RETIRED_MARKETS in lib/coverage for the tombstones
  // and for what would have to be true before either row comes back.
  { client: 'nashville', jurisdictionLabel: 'Nashville, TN', reason: 'East Bank redevelopment, stadium district, hotel boom; proven producer.' },
  { client: 'phoenix', jurisdictionLabel: 'Phoenix, AZ', reason: 'Proven producer; hotel and entertainment growth.' },
  { client: 'oakland', jurisdictionLabel: 'Oakland, CA', reason: 'Waterfront / ballpark / Coliseum-site redevelopment; verified live on Legistar.' },
  // DOWNSTATE NEW YORK, added off the back of the NYC test. New York City itself
  // is NOT here and cannot be: its Legistar Web API answers 403 for client 'nyc'
  // on every endpoint (see docs/COVERAGE-MAP.md). The downstate casino cycle is
  // live and its two largest projects sit OUTSIDE the city limits, which is the
  // same shape of error as the Las Vegas Strip not being in Las Vegas.
  { client: 'yonkersny', jurisdictionLabel: 'Yonkers, NY', reason: 'MGM Empire City / MGM Yonkers; a community benefits agreement with MGM Yonkers Inc is already in the record. 274 matters in 12 months, 28 leisure or entitlement. Verified live 2026-08-08.' },
  { client: 'westchestercountyny', jurisdictionLabel: 'Westchester County, NY', reason: 'County that contains Yonkers, and owns Rye Playland, a county-run amusement park. Low yield (3 of 560 matters) but a Legistar config row costs two lines. Verified live 2026-08-08.' },
  // FLORIDA, LIVE FOR THE FIRST TIME. CFTOD covers Disney's own district and
  // nothing else, so Fort Lauderdale, Hollywood, the beach hotel corridor and
  // the county's convention business were all invisible. Probed by BODY on
  // 2026-08-22: 1,006 matters in twelve months, newest 2026-08-19, and the gate
  // admits 92 of the newest 1,000 - a 9% admit rate, the best of any
  // jurisdiction measured for Brief O item 2 and better than several already
  // configured. Its bodies are County Commission, Unified Direct Procurement
  // Authority and Sunshine Notices.
  { client: 'broward', jurisdictionLabel: 'Broward County, FL', reason: 'First live Florida market beyond Disney own district. Convention, beach hotel and stadium-adjacent entitlement; 1,006 matters in 12 months and 92 admitted from the newest 1,000, measured 2026-08-22.' },
];
