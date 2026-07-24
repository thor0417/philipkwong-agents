// Target/probe term sets for the deep-capture brief. Three named projects double
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
// case-insensitive substring.
function termMatches(text: string, term: string): boolean {
  const t = term.toLowerCase();
  if (/^[a-z0-9]+$/.test(t)) {
    return new RegExp(`\\b${t}\\b`, 'i').test(text);
  }
  return text.toLowerCase().includes(t);
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
