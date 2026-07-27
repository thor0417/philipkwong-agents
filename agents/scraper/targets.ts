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
}

export const TARGETS: TargetDef[] = [
  {
    name: 'Top Gun Las Vegas',
    bypass: ['top gun', 'advent allen', '4815 s las vegas', '4815 las vegas', 'russell road', 'simtec'],
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
      'applebaum',
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
    bypass: ['ocvibe', 'oc vibe', 'ocv!be', 'honda center', 'anaheim real properties', 'platinum triangle'],
    searchOnly: ['douglas park'],
  },
  {
    name: 'Disney / CFTOD',
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
