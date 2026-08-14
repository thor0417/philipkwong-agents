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
  { client: 'miamidade', jurisdictionLabel: 'Miami-Dade County, FL', reason: 'Hospitality supply pipeline; proven producer.' },
  { client: 'nashville', jurisdictionLabel: 'Nashville, TN', reason: 'East Bank redevelopment, stadium district, hotel boom; proven producer.' },
  { client: 'phoenix', jurisdictionLabel: 'Phoenix, AZ', reason: 'Proven producer; hotel and entertainment growth.' },
  { client: 'sanantonio', jurisdictionLabel: 'San Antonio, TX', reason: 'Lowest priority; produced 8 real records and costs nothing once verified.' },
  { client: 'oakland', jurisdictionLabel: 'Oakland, CA', reason: 'Waterfront / ballpark / Coliseum-site redevelopment; verified live on Legistar.' },
  // DOWNSTATE NEW YORK, added off the back of the NYC test. New York City itself
  // is NOT here and cannot be: its Legistar Web API answers 403 for client 'nyc'
  // on every endpoint (see docs/COVERAGE-MAP.md). The downstate casino cycle is
  // live and its two largest projects sit OUTSIDE the city limits, which is the
  // same shape of error as the Las Vegas Strip not being in Las Vegas.
  { client: 'yonkersny', jurisdictionLabel: 'Yonkers, NY', reason: 'MGM Empire City / MGM Yonkers; a community benefits agreement with MGM Yonkers Inc is already in the record. 274 matters in 12 months, 28 leisure or entitlement. Verified live 2026-08-08.' },
  { client: 'westchestercountyny', jurisdictionLabel: 'Westchester County, NY', reason: 'County that contains Yonkers, and owns Rye Playland, a county-run amusement park. Low yield (3 of 560 matters) but a Legistar config row costs two lines. Verified live 2026-08-08.' },
];
