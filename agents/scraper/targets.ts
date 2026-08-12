// Target/probe term sets for the deep-capture brief. The named projects double
// as validation probes: an avenue that surfaces them will surface projects nobody
// named. A match on a BYPASS term is itself the signal, so the record skips the
// two-tier government gate (governmentGate in lib/taxonomy) and is flagged in the
// run report. SEARCH-only terms are broader/noisier and used for the Part E hunt
// (reporting) but NOT for gate bypass, so they never flood the capture.
//
// Correction applied (Top Gun relocation, this week's announcements): Top Gun is
// NOT at The Strat and NOT in City of Las Vegas jurisdiction. Confirmed site is
// 4815 S Las Vegas Blvd at Russell Road, unincorporated Clark County (Paradise NV),
// sold to Advent Allen Entertainment. The Strat / Stratosphere now indicate the OLD
// site, so they are SEARCH-only (Part E secondary), never bypass.

export interface TargetDef {
  name: string;
  // Distinctive terms whose presence bypasses the gate and flags the record.
  bypass: string[];
  // Broader terms used only for the Part E hunt report, never for bypass.
  searchOnly: string[];
  // CLUSTERING ONLY (no effect on the gate). A target is normally ONE named
  // project wherever it appears: 'ocvibe' means the same development in Anaheim
  // and in a trade-press story filed under Orange County, so splitting it by
  // market would split the project in half. Set perMarket when the target names
  // a PORTFOLIO rather than a project - 'walt disney' matches the Disneyland
  // Resort in Anaheim, the CFTOD district in Florida, and SFWMD permits in South
  // Florida, which are three different projects that must never merge.
  perMarket?: boolean;
  // Display name per market for a perMarket target. Falls back to
  // "<name> (<market>)" for a market not listed here.
  marketNames?: Record<string, string>;
  // CLUSTERING ONLY. Bypass terms that are good enough to FLAG a record for
  // review but too generic to assert project identity. They keep bypassing the
  // gate exactly as before; they simply cannot claim a record for the project.
  //
  // 'russell road' is the case that proved this necessary: it is a Las Vegas
  // arterial, and clustering on it swept five unrelated Clark County filings
  // (a refrigeration warehouse, a Hilton monorail, an interlocal transit
  // contract) into the Top Gun project. A street is where a project is, not
  // which project it is.
  weakForClustering?: string[];
  // CLUSTERING ONLY. Terms that name a DISTRICT rather than a project. A
  // district term claims a record normally - development in the district is
  // development of the district - but it is refused on a record whose subject is
  // city-wide fiscal or electoral process, because the annual budget and a
  // ballot measure enumerate every district in the city and are about none of
  // them.
  //
  // This is the sharp version of weakForClustering. 'russell road' is weak
  // outright: a street can never establish identity. 'platinum triangle' is not
  // weak - it is the correct signal on a PTMU overlay amendment and on a CFD
  // special-tax levy for that district - it is simply wrong on the budget.
  // Blanketing it as weak cost six records the July report places in the
  // project, which is why the distinction is drawn here instead.
  districtTerms?: string[];
  // CLUSTERING ONLY. Terms that name a PLACE CONTAINING MANY PROJECTS: a zoning
  // district, a corridor, a neighbourhood, or a venue that hosts unrelated
  // business. They ADMIT a record, because development in the district is worth
  // capturing, but they can NEVER claim project identity, because the district
  // is not the project.
  //
  // This is the third and last of the three weakenings, and the distinction
  // between them is the whole point:
  //
  //   weakForClustering  'russell road'      neither claims nor admits. A street
  //                                          is not evidence of anything.
  //   districtTerms      'platinum triangle' claims normally, refused only where
  //                                          the record is city-wide process.
  //   districtWide       'hudson yards'      admits always, claims never.
  //
  // 'hudson yards' is the case that proved it necessary. It is the Special
  // Hudson Yards District, and it matched 19 records covering at least 15
  // separate buildings: the Port Authority Bus Terminal, Brookfield's Manhattan
  // West, 70 Hudson Yards on the EASTERN rail yard, an HPD affordable housing
  // site, and eleven others, all filed under one project at significance 80.
  // Making it weakForClustering would have stopped the false merge and also
  // stopped capturing the district, which is the opposite of what we want.
  districtWide?: string[];
}

// ORDER IS PRECEDENCE for clustering (targets.ts is the first clustering rule).
// A record that matches two targets joins the one with more distinct matching
// terms, and ties break by the order below, so A SPECIFIC PROJECT MUST PRECEDE
// THE DISTRICT THAT CONTAINS IT. This is not cosmetic: every OCVibe entitlement
// record in the corpus also says "in an area of the City of Anaheim known as the
// Platinum Triangle", so with the order reversed the whole OCVibe cluster would
// be swallowed by the district.
export const TARGETS: TargetDef[] = [
  {
    // ADVENT ALLEN IS NOW A PORTFOLIO, NOT A PROJECT, so this is perMarket.
    //
    // 'advent allen' has always been a bypass term here, so an Advent filing in
    // any market was already going to be CAPTURED. What was wrong was where it
    // would LAND: without perMarket, a New York filing would have clustered
    // into the Las Vegas project, because a non-perMarket target is one project
    // wherever it appears. Advent Allen is reported to be preparing a New York
    // development, and Mark Advent created the New York-New York Hotel &
    // Casino, so a New York filing is a live possibility rather than a
    // hypothetical - and it would be a different development from Top Gun.
    //
    // The Las Vegas display name is pinned so the existing project is not
    // renamed by this change.
    //
    // Searched 2026-08-09 across all three New York sources: no Advent Allen
    // filing exists in New York City. This is the trap set for the one that
    // may come, not a record of one that has.
    name: 'Top Gun Las Vegas',
    perMarket: true,
    marketNames: { 'Las Vegas': 'Top Gun Las Vegas' },
    bypass: ['top gun', 'advent allen', '4815 s las vegas', '4815 las vegas', 'russell road', 'simtec'],
    weakForClustering: ['russell road'],
    searchOnly: ['advent', 'paramount', 'the strat', 'stratosphere', '4815', 'paradise, nv', 'paradise nv'],
  },

  // ---- NEW YORK CITY: the downstate casino programme and the large venues ----
  //
  // New York State's downstate gaming licences put several billion-dollar
  // entertainment developments through city land use review at once. Each bid is
  // a SEPARATE target because each is a separate development: one 'downstate
  // casino' target would merge Bally's Bronx into Coney Island, which is exactly
  // the false merge the per-project rule exists to prevent.
  //
  // The bypass terms are the NAMED PARTIES and the project names, never the
  // neighbourhood. 'coney island' and 'aqueduct' are searchOnly for a measured
  // reason: 'coney island' matches 15 stored records, most of them unrelated
  // residential rezonings on Coney Island Avenue, and 'aqueduct' matches a Parks
  // Department walk in the Bronx. A neighbourhood is where a project is, not
  // which project it is - the same rule that made 'russell road' weak above.
  {
    name: "Bally's Bronx",
    bypass: [
      "bally's bronx",
      'ballys bronx',
      'ballys new york operating',
      "bally's new york operating",
      "bally's hotel and casino",
      'ferry point',
    ],
    // Ferry Point is a city park before it is a casino site, and the Parks
    // Department files on it independently.
    weakForClustering: ['ferry point'],
    searchOnly: ["bally's", 'ballys', 'throgs neck'],
  },
  {
    name: 'The Coney (Coney Island casino)',
    bypass: [
      'the coney development',
      'tsg coney island',
      'coney island entertainment holdco',
      'thor equities',
      'saratoga casino holdings',
    ],
    searchOnly: ['coney island', 'surf avenue', 'stillwell'],
  },
  {
    name: 'Metropolitan Park / Willets Point',
    bypass: [
      'willets point',
      'metropolitan park',
      'queens development group',
      'city football stadium',
      'steve cohen',
      'sterling equities',
    ],
    searchOnly: ['citi field', 'flushing meadows'],
  },
  {
    // Not found in any of the three sources as of 2026-08-09. Resorts World
    // Aqueduct is an existing racino seeking a full licence, and an expansion
    // would reach ZAP and CEQR the moment it needs a discretionary action.
    name: 'Resorts World Aqueduct',
    bypass: ['resorts world', 'genting new york', 'aqueduct racetrack', 'aqueduct racino'],
    searchOnly: ['aqueduct', 'ozone park', 'genting'],
  },
  {
    // Not found as of 2026-08-09.
    name: 'Freedom Plaza (Soloviev)',
    bypass: ['freedom plaza', 'soloviev'],
    searchOnly: ['east 38th street', 'east 41st street'],
  },
  {
    name: 'Hudson Yards / Western Rail Yard',
    bypass: ['western rail yard', 'wry tenant', 'hudson yards'],
    // 'hudson yards west' is the brand the current project carries and the one
    // the press uses; the filings never say it, so it can only ever arrive
    // through search. Zero records in the corpus contain the phrase.
    searchOnly: ['related companies', 'oxford properties', 'hudson yards west'],
    // The district, not the project. See districtWide above.
    districtWide: ['hudson yards'],
  },
  {
    // Madison Square Garden's special permit is the recurring entitlement that
    // governs whether the arena may operate at all, so its filings are the
    // clearest large-venue signal in Manhattan.
    name: 'Madison Square Garden',
    bypass: ['madison square garden', 'msg arena', 'msg entertainment'],
    searchOnly: ['penn station', 'pennsylvania plaza'],
  },
  {
    // Heart Hotel / Kulik River cluster: the heart-shaped resort hotel and casino
    // proposed on the former SkyVue parcel (east side of Las Vegas Boulevard South,
    // across from Mandalay Bay), captured through Clark County entitlement filings
    // UC-26-0219 / TM-26-500056 and the companion variance VS-26-0218. The parties
    // are the durable watch: the applicant of record (Kulik River Capital), the
    // filing agent named on the staff reports (Temp Ventures), the representative
    // who presents the entitlement (Nancy Amundsen of Brown, Brown & Premsrirut),
    // and the reported principal (Eli Applebaum). SkyVue is the parcel's prior
    // failed project and still names the site in both press and filings.
    name: 'Heart Hotel / Kulik River',
    bypass: [
      'kulik river capital',
      'kulik river',
      // 'eli applebaum', not the bare surname. Once the watch terms became live
      // web queries (the unrestricted watch pass in sources/serper), a bare
      // 'applebaum' returned funeral homes, a stone company, a Substack, and a
      // university library guide. Verified on the watch probe.
      'eli applebaum',
      'temp ventures',
      'skyvue',
      '3941 las vegas blvd',
      // 'nancy amundsen', not the bare surname: a bare 'amundsen' false-fires on
      // Roald Amundsen, who appears in exactly our corpus (museum / heritage /
      // polar-exhibition records). Verified on the dry probe. The firm term
      // 'premsrirut' carries the representative when only the firm is named.
      'nancy amundsen',
      'brown brown premsrirut',
      'premsrirut',
      'vs-26-0218',
    ],
    searchOnly: ['heart hotel', 'high desert', 'steelman partners', 'sky restaurant'],
  },
  {
    // Corridor anchors near the Top Gun parcel (4815 S Las Vegas Blvd at Russell
    // Road). The south-Strip corridor's capital is anchored by the Athletics
    // ballpark and the proposed NBA arena; an entitlement naming either is a
    // neighbouring-parcel signal for the same corridor. These are the anchor terms
    // as briefed: location-qualified, so they fire on announcement / press phrasing
    // rather than on any stadium record in another market.
    name: 'Las Vegas corridor anchors',
    bypass: ['athletics ballpark', "a's stadium las vegas", 'nba arena las vegas'],
    searchOnly: ['tropicana site', 'las vegas athletics', 'south strip corridor'],
  },
  {
    name: 'OCVibe',
    bypass: ['ocvibe', 'oc vibe', 'ocv!be', 'honda center', 'anaheim real properties'],
    searchOnly: ['douglas park'],
    // The arena is OCVibe's anchor, and a record naming it is worth capturing,
    // but the building hosts business that is not the development: the Games
    // Agreement with the LA28 Olympic organising committee joined OCVibe on
    // 'honda center' and nothing else.
    districtWide: ['honda center'],
  },
  {
    // SPLIT OUT OF THE OCVibe TARGET (clustering brief, Part C). 'platinum
    // triangle' was an OCVibe bypass term, but the Platinum Triangle is the
    // Anaheim mixed-use overlay district that CONTAINS OCVibe, not OCVibe
    // itself: the July report treats "Platinum Triangle / PT Metro" (the PTMU
    // overlay, the CFD special taxes, and PT Metro's stalled A-Town project) as
    // a separate entry, and the acceptance test requires the same.
    //
    // MOVING A TERM BETWEEN TARGETS DOES NOT CHANGE GATE BEHAVIOUR. bypassHits
    // scans every target's terms, so 'platinum triangle' still bypasses exactly
    // as before; only the target it is attributed to changes. 'pt metro' and
    // 'a-town' are new and DO widen capture slightly, by design: they name the
    // stalled A-Town project directly, and neither is ambiguous.
    name: 'Platinum Triangle / PT Metro',
    bypass: ['platinum triangle', 'pt metro', 'a-town'],
    // 'platinum triangle' is a DISTRICT term, not a weak one. It claims records
    // normally - the PTMU overlay amendments, the Housing Element rezone, and
    // the CFD 08-1 special-tax levy are all genuinely Platinum Triangle records,
    // and the July report files them there - but it is refused on the city's
    // annual budget hearings and on the Tourism Mobility Tax ballot measure,
    // which name the district only to say where they apply.
    districtTerms: ['platinum triangle'],
    searchOnly: ['ptmu', 'stadium lofts', 'angel stadium'],
  },
  {
    // A PORTFOLIO, NOT A PROJECT: these terms reach the Disneyland Resort in
    // Anaheim, the Central Florida Tourism Oversight District in Florida, and
    // Walt Disney World-area SFWMD permits in South Florida. Those are three
    // different projects sharing one corporate parent, so this target clusters
    // per market and each market carries its own name.
    name: 'Disney / CFTOD',
    perMarket: true,
    marketNames: {
      Anaheim: 'Disneyland Resort',
      'Central Florida Tourism Oversight District': 'CFTOD / Walt Disney World',
      'South Florida': 'Walt Disney World area permits (SFWMD)',
    },
    bypass: [
      'walt disney',
      'disney parks',
      'wdpr',
      // DisneylandForward is the Disneyland Resort expansion programme, and it was
      // being missed with NO vocabulary at all: the CEQAnet record's entire subject
      // is the two words "DisneylandForward Project", which contains no leisure
      // noun, no deal instrument and no known party. It is a named project, so it
      // belongs here rather than in any vocabulary tier - the same reasoning that
      // puts 'ocvibe' here. Measured: 1 hit over the corpus, relevant, +0.2
      // precision. It is one token and unambiguous, so it cannot borrow context.
      'disneylandforward',
      'reedy creek',
      'bay lake',
      'lake buena vista',
      'epcot',
      'magic kingdom',
    ],
    searchOnly: ['disney'],
  },
];

// The single best target for a text, for CLUSTERING (never for the gate).
//
// Scored by the number of DISTINCT matching terms, ties broken by TARGETS order
// so a specific project outranks the district containing it. Uses
// strongBypassHits, so the CFTOD-letterhead geographic terms ("Bay Lake",
// "Reedy Creek", "Lake Buena Vista") cannot claim a record: inside SFWMD's
// permit corpus those name creeks and lakes, and letting them cluster would
// merge a 1987 swamp-logging permit into Walt Disney World.
export interface ClusteringTargetOptions {
  // The record's subject is city-wide fiscal or electoral process, so district
  // terms in it name where a rule applies, not what the record is about.
  fiscalOrBallot?: boolean;
  // The record's own title, when it has one. A TERM IN THE TITLE OUTRANKS A TERM
  // IN THE BODY, whatever the counts say.
  //
  // The CEQAnet record titled "DisneylandForward Project" matched 'ocvibe' once
  // in its body (as a cumulative project in the EIR) and 'disneylandforward'
  // once. One term each, so the tie broke on declaration order in this file, and
  // OCVibe is declared before Disney. A record whose title names the project is
  // not ambiguous; only our arithmetic was.
  title?: string | null;
}

export function bestTargetForClustering(
  text: string,
  opts: ClusteringTargetOptions = {}
): TargetDef | null {
  const hits = strongBypassHits(text);
  if (hits.length === 0) return null;
  const weakByTarget = new Map(TARGETS.map((t) => [t.name, new Set(t.weakForClustering ?? [])]));
  const districtByTarget = new Map(TARGETS.map((t) => [t.name, new Set(t.districtTerms ?? [])]));
  const wideByTarget = new Map(TARGETS.map((t) => [t.name, new Set(t.districtWide ?? [])]));

  const tally = (hs: TargetHit[]): Map<string, Set<string>> => {
    const counts = new Map<string, Set<string>>();
    for (const h of hs) {
      if (weakByTarget.get(h.target)?.has(h.term)) continue;
      // A district term never establishes identity, whatever the record is about.
      if (wideByTarget.get(h.target)?.has(h.term)) continue;
      if (opts.fiscalOrBallot && districtByTarget.get(h.target)?.has(h.term)) continue;
      if (!counts.has(h.target)) counts.set(h.target, new Set());
      counts.get(h.target)!.add(h.term);
    }
    return counts;
  };

  // The title first. Only if no target survives in the title does the body
  // decide, so a body mention can never outvote the record's own subject.
  const titleCounts = opts.title ? tally(strongBypassHits(opts.title)) : new Map();
  const counts = titleCounts.size > 0 ? titleCounts : tally(hits);

  let best: TargetDef | null = null;
  let bestCount = 0;
  for (const t of TARGETS) {
    const n = counts.get(t.name)?.size ?? 0;
    if (n > bestCount) {
      best = t;
      bestCount = n;
    }
  }
  return best;
}

// The project name a target gives a record in a given market.
export function targetProjectName(target: TargetDef, market: string | null): string {
  if (!target.perMarket) return target.name;
  const m = market ?? '(unknown market)';
  return target.marketNames?.[m] ?? `${target.name} (${m})`;
}

// Disney terms that are ALSO the Central Florida Tourism Oversight District's own
// address / former name / member cities: "Lake Buena Vista" (CFTOD's mailing
// address), "Bay Lake" (a city CFTOD governs), "Reedy Creek" (the district's former
// name). Inside CFTOD's own documents these appear on every page of letterhead, so
// they are NOT a signal that a given agenda item concerns a Disney development. They
// remain full bypass terms for OTHER sources (a news article naming Bay Lake IS
// about Disney); the CFTOD PDF extractor uses strongBypassHits to ignore them.
export const DISNEY_GEOGRAPHIC = new Set(['reedy creek', 'bay lake', 'lake buena vista']);

// A single-token term (no space, only word chars) matches on word boundaries so
// short tokens like '4815' or 'wdpr' do not match inside longer words; anything
// with a space or punctuation (e.g. 'ocv!be', 'russell road') matches as a
// case-insensitive substring of the PUNCTUATION-FOLDED text.
//
// Folding (every run of non-alphanumerics collapsed to one space, both sides)
// exists because government documents punctuate firm names their own way: the
// Clark County staff reports print "BROWN, BROWN, & PREMSRIRUT", which a literal
// substring test for 'brown brown premsrirut' would miss. Folding is applied
// symmetrically, so a term written with punctuation ('ocv!be') still matches text
// written the same way.
function fold(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function termMatches(text: string, term: string): boolean {
  const t = term.toLowerCase();
  if (/^[a-z0-9]+$/.test(t)) {
    return new RegExp(`\\b${t}\\b`, 'i').test(text);
  }
  return fold(text).includes(fold(t));
}

export interface TargetHit {
  target: string;
  term: string;
}

// All bypass-term hits in the text, one per (target, term) that matches.
export function bypassHits(text: string): TargetHit[] {
  const hits: TargetHit[] = [];
  if (!text) return hits;
  for (const t of TARGETS) {
    for (const term of t.bypass) {
      if (termMatches(text, term)) hits.push({ target: t.name, term });
    }
  }
  return hits;
}

// Does any bypass term match? Such a record skips the gate (the target is the
// signal) and is flagged in the report.
export function bypassesGate(text: string): boolean {
  return bypassHits(text).length > 0;
}

// Bypass hits EXCLUDING the CFTOD-letterhead geographic Disney terms. Use this
// inside CFTOD's own documents, where "Lake Buena Vista" et al. are the district's
// address rather than a signal that the item concerns a Disney project.
export function strongBypassHits(text: string): TargetHit[] {
  return bypassHits(text).filter((h) => !DISNEY_GEOGRAPHIC.has(h.term));
}

export function strongBypassesGate(text: string): boolean {
  return strongBypassHits(text).length > 0;
}

// ---- ADMISSION, as distinct from flagging -----------------------------------

// A term that is too weak to say WHICH project a record belongs to is also too
// weak to be the ONLY reason the record is admitted. Same set, same lesson,
// applied one layer earlier.
//
// 'russell road' is the whole set today, and it is the case that proved the
// point twice. It is a Las Vegas arterial, so clustering on it swept five
// unrelated Clark County filings into Top Gun (see weakForClustering above).
// The clustering fix stopped it claiming those records, but the gate went on
// ADMITTING them, so they simply became unclustered noise instead of a false
// merge. Measured over the frozen corpus: exactly 4 records are admitted on a
// weak term and nothing else - the RTC Durango Drive interlocal, two
// Refrigeration Supplies Distributor filings and a 4725 Holdings waiver - and
// the labels call all 4 irrelevant, with zero relevant records lost. The same
// three records the clustering brief named, arriving through the gate.
//
// The distinction that matters: these terms still FLAG. bypassesGate and the
// per-source bypassHits counters are unchanged, so a record mentioning Russell
// Road is still reported as a corridor mention. It just cannot walk past the
// gate on that alone.
export const WEAK_ALONE: ReadonlySet<string> = new Set(
  TARGETS.flatMap((t) => t.weakForClustering ?? [])
);

function carries(hits: TargetHit[]): boolean {
  return hits.some((h) => !WEAK_ALONE.has(h.term));
}

// Does the text carry a bypass strong enough to ADMIT it? Used by the gate.
export function bypassAdmits(text: string): boolean {
  return carries(bypassHits(text));
}

// The same, excluding the CFTOD-letterhead geographic Disney terms.
export function strongBypassAdmits(text: string): boolean {
  return carries(strongBypassHits(text));
}

// All hits across bypass AND search-only terms, for the Part E hunt (reporting).
export function searchHits(text: string): TargetHit[] {
  const hits: TargetHit[] = [];
  if (!text) return hits;
  for (const t of TARGETS) {
    for (const term of [...t.bypass, ...t.searchOnly]) {
      if (termMatches(text, term)) hits.push({ target: t.name, term });
    }
  }
  return hits;
}
