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
    name: 'Top Gun Las Vegas',
    bypass: ['top gun', 'advent allen', '4815 s las vegas', '4815 las vegas', 'russell road', 'simtec'],
    weakForClustering: ['russell road'],
    searchOnly: ['advent', 'paramount', 'the strat', 'stratosphere', '4815', 'paradise, nv', 'paradise nv'],
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
export function bestTargetForClustering(text: string): TargetDef | null {
  const hits = strongBypassHits(text);
  if (hits.length === 0) return null;
  const weakByTarget = new Map(TARGETS.map((t) => [t.name, new Set(t.weakForClustering ?? [])]));
  const counts = new Map<string, Set<string>>();
  for (const h of hits) {
    if (weakByTarget.get(h.target)?.has(h.term)) continue;
    if (!counts.has(h.target)) counts.set(h.target, new Set());
    counts.get(h.target)!.add(h.term);
  }
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
