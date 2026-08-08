// WHAT A PROJECT IS CALLED, and why the old answer was not usable.
//
// 148 of 179 project names carried at least one defect that makes them
// unshowable in a client document: 139 truncated mid-word with an ellipsis, 147
// longer than 70 characters, 41 opening with a procedural verb or an agenda
// position, 19 shouting in ALL CAPS, 8 starting with a raw case number. Only the
// five target-named projects read as project names.
//
// The cause was structural rather than sloppy. A project with no target term was
// named by taking its earliest record's title and cutting it to length. An
// agenda title is not a name: it is an instruction to a council, and it begins
// with the instruction. "ITEM NO. 3 DEVELOPMENT APPLICATION NO. 2024-00083
// Location: The proposed use would occu..." is a perfectly good agenda line and
// a useless project name.
//
// FOUR SOURCES, IN PRIORITY ORDER. The first that yields a usable name wins, and
// which one fired is returned alongside the name so the register can show its
// own confidence rather than presenting a guess as a fact.
//
//   1. TARGET      a named project is already named. "OCVibe", "Heart Hotel /
//                  Kulik River". Nothing beats this.
//   2. APPLICANT   the party plus what they are building: "Kulik River Capital
//                  resort hotel". This is how the business actually refers to a
//                  matter, and the applicant is a field a filing asserts rather
//                  than prose we interpreted.
//   3. SITE        the address plus what is being built, for the filings that
//                  name no party: "1715 South Douglass Road hotel".
//   4. TITLE       the cleaned title, as a last resort, following the rules
//                  below. Still a fallback, but a legible one.
//
// The point of the order is that the last resort is genuinely last. It was
// previously the only rule.

import type { ClusterRecord } from './cluster';

export type NameSource = 'target' | 'applicant' | 'site' | 'title';

export interface ProjectName {
  name: string;
  source: NameSource;
}

// The longest name that fits a table cell and a document line without wrapping
// awkwardly. Truncation happens at a WORD boundary and never mid-word.
//
// 80 rather than 70, chosen by measurement: at 70 the rule cut real names that
// were merely long, turning "Demarcation & Buffer Zone Establishment for the
// Morne Diablotin National Park" into the same phrase without its park. A name
// that is complete and slightly long beats one that is short and wrong.
export const MAX_NAME = 80;

// ---- Acronyms ----------------------------------------------------------------

// Tokens that must survive title-casing as capitals. An ALL CAPS agenda line
// title-cased naively produces "Buona Vita, Llc" and "Rfp-00133", which reads as
// worse than the shouting it replaced.
const ACRONYMS = new Set([
  'LLC', 'LP', 'LLP', 'INC', 'LTD', 'PLC', 'PC', 'PLLC', 'GP', 'PA', 'CO',
  'TIF', 'CFD', 'APN', 'DA', 'RFP', 'RFQ', 'EIR', 'CEQA', 'SCH', 'DBA',
  'SP', 'GPA', 'SDR', 'VAR', 'UC', 'TM', 'VS', 'WS', 'ZC', 'AR', 'ET', 'ORD',
  'CR', 'AE', 'PCD', 'PUD', 'HOA', 'RV', 'QSR', 'ADA', 'EV', 'HVAC',
  'MGM', 'LV', 'NV', 'CA', 'TX', 'AZ', 'TN', 'FL', 'OH', 'US', 'USA', 'UK',
  'UAE', 'OC', 'PT', 'PTMU', 'CFTOD', 'SFWMD', 'OTR', 'AC', 'II', 'III', 'IV',
]);

// Roman-numeral-ish and unit tokens that are not words.
const KEEP_UPPER = /^(?:[IVX]+|\d+[A-Z]?|[A-Z]&[A-Z])$/;

// A SHORT ALL-CAPS TOKEN IS AN ABBREVIATION, not a word to be title-cased.
//
// The explicit ACRONYMS list can only hold the ones we thought of, and company
// names invent their own. Measured: "LCLV MD, LLC" came back as "Lclv Md",
// which reads as a typo. Two shapes are reliably abbreviations rather than
// words - a token of three letters or fewer, and a token with no vowel in it -
// so both keep their capitals whether or not anyone listed them.
function looksLikeAbbreviation(bare: string): boolean {
  if (!/^[A-Za-z]+$/.test(bare)) return false;
  if (bare !== bare.toUpperCase()) return false;
  // Two letters or fewer is an abbreviation ("MD", "LV", "NV").
  if (bare.length <= 2) return true;
  // Longer than that, only a vowel-less run is. The first version of this rule
  // treated ANY token of three letters or fewer as an abbreviation, which
  // shouted at real words: "SUNSET BAY RESORTS, LLC" came back as "Sunset BAY
  // Resorts". A word has a vowel; LCLV, MGM and SFWMD do not.
  return bare.length <= 6 && !/[AEIOUY]/.test(bare);
}

// Case each alphanumeric RUN inside the token independently.
//
// It used to strip the punctuation, decide on the stripped form, then substitute
// that form back with String.replace - which silently did nothing whenever the
// punctuation was INTERIOR, because the stripped string no longer occurred in
// the token. "APPLICANT/OWNER:" became "APPLICANTOWNER", which is not a
// substring of the original, so the token was returned still shouting. Casing
// each run in place removes the substitution step and the bug with it.
export function titleCaseToken(tok: string): string {
  return tok.replace(/[A-Za-z0-9&]+/g, (run, at: number) => {
    // A single letter after an apostrophe is a possessive or a contraction, not
    // an abbreviation: "BALLY'S" must become "Bally's", not "Bally'S".
    if (run.length === 1 && at > 0 && /['’]/.test(tok[at - 1])) return run.toLowerCase();
    if (ACRONYMS.has(run.toUpperCase()) || KEEP_UPPER.test(run) || looksLikeAbbreviation(run)) {
      return run.toUpperCase();
    }
    return run.charAt(0).toUpperCase() + run.slice(1).toLowerCase();
  });
}

// Convert a shouted string to title case, preserving acronyms. Applied ONLY when
// the string is actually shouting: a correctly-cased title is left alone, because
// re-casing it would flatten proper nouns the source got right.
export function fixShouting(s: string): string {
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (letters.length < 6 || letters !== letters.toUpperCase()) return s;
  return s.split(/(\s+)/).map((t) => (/\s/.test(t) ? t : titleCaseToken(t))).join('');
}

// ---- Cleaning the last resort -------------------------------------------------

// Procedural chrome. Anchored to the START, applied repeatedly, because agenda
// lines stack them: "36. ABEYANCE - RENOTIFICATION - 24-0486 - PUBLIC HEARING -
// APPLICANT: ...".
const LEAD_STRIP: RegExp[] = [
  /^\s*\*{2,}[^*]*\*{2,}\s*/,                                   // ***REQUEST TO WITHDRAW***
  /^\s*(?:item\s+no\.?\s*\d+|\d{1,3})\s*[.):\-]\s*/i,           // "ITEM NO. 3", "36."
  /^\s*(?:abeyance|holdover|renotification|withdrawn|continued)\s*[-:,]\s*/i,
  // "PUBLIC HEARING - ", but also "Public Hearing and Ordinance Adoption - "
  // and "public hearing concerning the proposed issuance of ...". The separator
  // is optional because a summary line runs straight on into its subject.
  /^\s*(?:a\s+)?public\s+hearing\s+and\s+ordinance\s+adoption\s*[-:,]?\s*/i,
  // "Conduct a public hearing concerning the proposed issuance of ..." - the
  // preposition is consumed as part of the phrase rather than matched by a
  // lookahead, which keeps this a plain prefix strip and nothing more.
  /^\s*(?:a\s+)?public\s+hearing\s+(?:on|concerning|regarding|to\s+consider|about)\s+(?:the\s+|a\s+|an\s+)?(?:proposed\s+)?/i,
  /^\s*(?:a\s+)?public\s+hearing\s*[-:,]\s*/i,
  /^\s*(?:on|concerning|regarding|to\s+consider|for)\s+(?:the\s+|a\s+|an\s+)?(?:proposed\s+)?/i,
  /^\s*(?:an?\s+)?(?:resolution|ordinance)\s+(?:no\.?\s*[\d-]+\s*)?(?:\((?:adoption|introduction)\)\s*)?[-:,]?\s*/i,
  /^\s*bill\s+no\.?\s*[\d-]+\s*[-:,]?\s*/i,
  /^\s*applicant(?:\s*\/\s*owner)?\s*:\s*/i,
  /^\s*(?:subject|from|re)\s*:\s*/i,
  /^\s*(?:for\s+possible\s+action(?:\s+(?:to|on|regarding))?)\s*[-:,]?\s*/i,
  /^\s*(?:discussion\s+(?:and|for)\s+(?:possible\s+)?action(?:\s+(?:to|on|regarding))?)\s*[-:,]?\s*/i,
  /^\s*(?:approve|adopt|authorize|consider|determine|introduce|conduct|receive\s+and\s+file|award\s+of)\s+(?:the\s+|a\s+|an\s+)?(?:ratification\s+of\s+the\s+)?/i,
  /^\s*(?:a\s+public\s+hearing\s+on\s+)/i,
  // Third-person procedural verbs. An ordinance summary opens "Amends the Town
  // Center Development Standards Manual..." or "Authorizes multifamily and
  // mixed-use development...", which is the instrument speaking, not a name.
  /^\s*(?:amends|authorizes|approves|adopts|establishes|provides|creates|repeals|designates|levies)\s+(?:the\s+|a\s+|an\s+)?/i,
  /^\s*adopts\s+that\s+certain\s+document\s+entitled\s*/i,
  /^\s*on\s+the\s+basis\s+of\s+the\s+evidence\s+submitted\s+by\s*/i,
  /^\s*[A-Z]{2,4}-\d{2}-\d{3,6}(?:\s*\([^)]*\))?\s*[-:]\s*/i,   // "UC-26-0219-"
  /^\s*\d{2}-\d{3,6}(?:-[A-Z]{2,5}\d?)?\s*[-:]\s*/i,            // "25-0530-SDR1 - "
  /^\s*[-:,.–—]\s*/,
];

// Trailing chrome: a dangling connective or punctuation left by truncation.
const TRAIL_STRIP = /[\s,;:.–—-]+$|\s+(?:and|or|the|of|for|to|in|on|at|with|by|a|an)$/i;

export function cleanProjectTitle(raw: string): string {
  let t = String(raw ?? '').replace(/\s+/g, ' ').trim();
  // Drop a trailing ellipsis BEFORE anything else, so the length rules below are
  // applied to the real text rather than to a marker of earlier truncation.
  t = t.replace(/\s*(?:\.{3,}|…)\s*$/, '').trim();

  for (let pass = 0; pass < 6; pass++) {
    const before = t;
    for (const re of LEAD_STRIP) t = t.replace(re, '');
    if (t === before) break;
  }

  t = fixShouting(t);
  t = t.replace(/^["'“‘]+|["'”’]+$/g, '').trim();

  // TRUNCATE AT A WORD BOUNDARY, NEVER MID-WORD, AND NEVER WITH AN ELLIPSIS.
  // An ellipsis in a name tells the reader the system does not know the name.
  // Cutting cleanly at a word says the same thing without the apology.
  if (t.length > MAX_NAME) {
    const cut = t.slice(0, MAX_NAME + 1);
    const lastSpace = cut.lastIndexOf(' ');
    t = (lastSpace > 20 ? cut.slice(0, lastSpace) : t.slice(0, MAX_NAME)).trim();
  }
  for (let pass = 0; pass < 3; pass++) {
    const before = t;
    t = t.replace(TRAIL_STRIP, '').trim();
    if (t === before) break;
  }

  // SHOUTING IS CHECKED AGAIN, AFTER TRUNCATION.
  //
  // fixShouting deliberately declines on a mixed-case string, so that a title
  // the source cased correctly is not flattened. But truncation can turn a
  // mixed-case title into an all-caps fragment: "13. ABEYANCE - 25-0530-SDR1 -
  // SITE DEVELOPMENT PLAN REVIEW - PUBLIC HEARING - APPLICANT: LIVCO - ... For
  // possible action on a Land Use Entitlement project request" has lowercase in
  // its tail, and the tail is exactly what gets cut. Re-checking the result is
  // what catches that.
  return fixShouting(t);
}

// ---- The venue phrase ---------------------------------------------------------

// How a venue_type reads at the end of a name. Lowercase, because it is a common
// noun describing what is being built, not part of a proper name.
const VENUE_PHRASE: Record<string, string> = {
  'Entertainment Destination': 'entertainment destination',
  Resort: 'resort',
  'Integrated Resort': 'integrated resort',
  Museum: 'museum',
  'Theme Park': 'theme park',
  Hotel: 'hotel',
  'Casino/Gaming': 'casino',
  Waterpark: 'waterpark',
  'Heritage/Cultural Site': 'heritage site',
  'Family Entertainment Center': 'family entertainment centre',
  'Entertainment District': 'entertainment district',
  Zoo: 'zoo',
  'Mixed-Use Development': 'mixed-use development',
  Aquarium: 'aquarium',
  'Transit-Oriented Development': 'transit-oriented development',
  'Science Center': 'science centre',
  'Convention/Expo': 'convention centre',
  'Master-Planned Community': 'master-planned community',
  'Amusement Park': 'amusement park',
  'Waterfront Development': 'waterfront development',
  'Arena/Stadium': 'arena',
  'Downtown Redevelopment': 'downtown redevelopment',
  'Transit Hub': 'transit hub',
};

export function venuePhrase(venueType: string | null | undefined): string | null {
  if (!venueType) return null;
  return VENUE_PHRASE[venueType] ?? null;
}

// ---- Applicants ---------------------------------------------------------------

// An applicant that names a government body is not a project name: the city is
// the applicant on hundreds of unrelated filings. This mirrors the clusterer's
// own generic-applicant guard, which exists for the same reason.
const GENERIC_APPLICANT =
  /\b(city|county|state|department|dept|agency|authority|commission|board|district|bureau|division|office|municipality|town|village|government|ministry)\b/i;

// AN APPLICANT MUST LOOK LIKE AN ORGANISATION, not a person.
//
// The applicant column sometimes holds the individual who signed or presented a
// filing rather than the developing entity. Measured on the first pass of this
// rule, that produced "Brian Normanly leisure development" for the Reedy Creek
// Mitigation Bank and "Alice Hsu resort" for an Anaheim assessment-district
// hearing - in both cases a worse name than the title it replaced, and one that
// puts a private individual's name on a client document.
//
// The test is applied to the RAW string, before suffixes are stripped, because
// stripping is what erases the evidence: "Weston Urban, LLC" is an organisation
// and "Weston Urban" alone would not look like one.
const ORGANISATION_MARKER =
  /\b(llc|l\.l\.c|llp|lp|l\.p|inc|incorporated|ltd|limited|corp|corporation|co|company|plc|partnership|partners|trust|holdings|group|associates|properties|development|developments|enterprises|capital|ventures|investments|bank|club|church|association|foundation|society|institute|university|college|hotels?|resorts?|casino|entertainment|realty|estates?|builders|construction|management|international)\b/i;

// Tidy a raw applicant string into something printable: drop the legal suffix
// noise a filing stacks on, drop a co-applicant list after the first party, and
// fix shouting.
export function cleanApplicant(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const original = String(raw).replace(/\s+/g, ' ').trim();
  if (!ORGANISATION_MARKER.test(original)) return null;

  let s = original.replace(/\([^)]*\)/g, ' ');
  // First named party only. "Anaheim Real Estate Partners, LLC, TS Anaheim, LLC,
  // and FCD, LLC" is one project's applicant list, and the first is the one that
  // recurs across its records.
  s = s.split(/\s+and\s+|\s*;\s*|\s*\/\s*/)[0];
  s = s.replace(/\bdba\b.*$/i, '');
  // Strip stacked legal suffixes from the tail, repeatedly.
  //
  // ONLY THE HARD ENTITY SUFFIXES. 'Partnership', 'Trust' and 'Company' are NOT
  // stripped: they are frequently part of a descriptive phrase rather than a
  // suffix, and stripping them mangles the name. Measured, "OTR, an Ohio
  // Partnership" became "OTR, an Ohio" - a dangling article where a name should
  // be. A suffix is only removed when what remains still ends in a real word.
  for (let pass = 0; pass < 4; pass++) {
    const next = s.replace(
      /[,\s]+(?:LLC|L\.L\.C\.?|LLP|L\.P\.?|LP|INC\.?|INCORPORATED|LTD\.?|CORP\.?|CORPORATION|CO\.|PLC)\s*$/i,
      ''
    );
    if (next === s) break;
    s = next;
  }
  s = s.replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '');
  // A trailing article or preposition means the strip cut into the phrase.
  if (/\b(?:an?|the|of|for|in|at|by|to)$/i.test(s)) return null;
  if (s.length < 4) return null;
  if (GENERIC_APPLICANT.test(s)) return null;
  return fixShouting(s);
}

// ---- Sites --------------------------------------------------------------------

// A street address, printable. Takes the record's own site keys so the naming
// rule and the clustering rule agree about what an address is - including the
// civic-venue and law-firm exclusions the site signal already applies.
export function cleanAddress(siteKey: string): string | null {
  if (!siteKey.startsWith('addr:')) return null;
  const a = siteKey.slice(5).trim();
  if (a.length < 6) return null;
  return a.split(' ').map(titleCaseToken).join(' ');
}

// ---- The rule -----------------------------------------------------------------

export interface NamingContext {
  targetName: string | null;
  records: ClusterRecord[];
  // The project's rolled-up venue type.
  venueType: string | null;
  // Site keys already computed by the clusterer, in record order.
  siteKeysByRecord: string[][];
}

function modeOf(values: (string | null | undefined)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let bestN = 0;
  for (const [v, n] of counts) {
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

// Join a base (an applicant or an address) to its venue phrase, TRUNCATING THE
// BASE RATHER THAN THE RESULT.
//
// Truncating the joined string cuts the venue word off the end, which is the one
// part that says what the project IS. Measured: "World Buddhism Association
// Headquarters & MGM-GRAND BALLY'S integrated resort" came back as "...
// integrated", a name ending mid-phrase in an adjective.
function withVenue(base: string, venue: string | null): string {
  const clean = base.replace(/\s+/g, ' ').trim();
  if (!venue) return clean.length > MAX_NAME ? cutAtWord(clean, MAX_NAME) : clean;
  const room = MAX_NAME - venue.length - 1;
  const head = clean.length > room ? cutAtWord(clean, Math.max(20, room)) : clean;
  return `${head} ${venue}`.replace(/\s+/g, ' ').trim();
}

// Cut at a word boundary, never mid-word, never with an ellipsis.
function cutAtWord(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max + 1);
  const lastSpace = cut.lastIndexOf(' ');
  const out = lastSpace > 12 ? cut.slice(0, lastSpace) : s.slice(0, max);
  return out.replace(/[\s,;:.–—-]+$/, '').trim();
}

// ---- Disambiguating identical names -------------------------------------------
//
// A NAME THAT SEVERAL PROJECTS SHARE IS NOT A NAME. Nashville's Metro Council
// approves tax increment financing one redevelopment district at a time, and
// every resolution opens with the same 77 characters:
//
//   "A Resolution approving the activities and improvements eligible for tax
//    increment financing in the Skyline Redevelopment Plan."
//
// The district - the only part that differs - sits past MAX_NAME, so the title
// rule cut all six down to the same string. In the register they read as one
// matter listed six times, which is worse than a bad name: it looks like a bug
// in the clustering rather than six real projects.
//
// THE SUFFIX COMES FROM THE RECORD, never from a counter. "(2)" would make the
// rows distinct and tell the reader nothing; a resolution number is what the
// clerk, the council and Philip all use to refer to the matter, so it makes the
// row both unique and useful. In priority order:
//
//   1. THE CASE OR BILL NUMBER the project clusters on. It is the project's own
//      identity (project_key), so it is unique by construction and stable across
//      runs - the two properties a suffix has to have.
//   2. A CASE NUMBER ON ITS RECORDS, for a project keyed on something else.
//   3. THE DATE, for a project with no case number anywhere: same matter name,
//      different meeting.
//
// APPLIED ONLY TO COLLISIONS. A name that is already unique in its market is
// left exactly as it was: a suffix on every project would be chrome on 178 rows
// to fix 8.

// The suffix is written into MAX_NAME rather than added on top of it. The
// register truncates the name cell with a CSS ellipsis, so a suffix pushed past
// the column width is invisible in the one view the duplication shows up in -
// which would leave the rows looking identical and the fix looking done. Same
// principle as withVenue: cut the BASE, keep the part that distinguishes.
export function withSuffix(base: string, suffix: string): string {
  const tail = ` (${suffix})`;
  const clean = base.replace(/\s+/g, ' ').trim();
  const room = MAX_NAME - tail.length;
  const head = clean.length > room ? cutAtWord(clean, Math.max(20, room)) : clean;
  return `${head}${tail}`;
}

// A project_key of the form 'case:<market>:<root>' carries the case or bill
// number the project is identified by. Upper-cased for display: the roots are
// folded to lowercase for matching, and every case-id family in CASE_RULES
// (RS2026-2083, UC-26-0219, Z-14-B) is published in capitals.
export function caseNumberFromKey(projectKey: string | null | undefined): string | null {
  const k = String(projectKey ?? '');
  if (!k.startsWith('case:')) return null;
  const root = k.split(':').slice(2).join(':').trim();
  if (root.length < 3) return null;
  return root.toUpperCase();
}

export interface NameCollisionInput {
  name: string;
  market: string | null;
  // The project's identity key, which names its case root when it has one.
  project_key: string;
  // Printable case or bill numbers found on the project's own records, used when
  // the project is keyed on something other than a case.
  caseNumbers: string[];
  // The project's own date - its last activity - as a last resort.
  date: string | null;
}

// The suffix a project would carry, or null if it has nothing of its own to be
// distinguished by. Exported so the report can say which rule fired.
export function disambiguationSuffix(p: NameCollisionInput): string | null {
  const fromKey = caseNumberFromKey(p.project_key);
  if (fromKey) return fromKey;
  const distinct = [...new Set(p.caseNumbers.map((c) => c.trim().toUpperCase()).filter(Boolean))];
  // Only when the records agree on ONE case number. A record set naming several
  // has no single number that identifies the project, and picking the first
  // would label the project with whichever record happened to sort first.
  if (distinct.length === 1) return distinct[0];
  const date = String(p.date ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function collisionKey(market: string | null, name: string): string {
  return `${market ?? ''}|${name.replace(/\s+/g, ' ').trim().toLowerCase()}`;
}

export interface Disambiguation {
  // Position in the array handed to disambiguateNames, so the caller can apply
  // the rename in place.
  index: number;
  // The project's identity, so a LATER consumer can still find it. The index is
  // only meaningful before the caller reorders its own array - the clusterer
  // sorts its projects by record count immediately afterwards - and a report
  // read after that point would otherwise point at the wrong project.
  project_key: string;
  from: string;
  to: string;
  suffix: string;
}

// Returns one entry per project whose name was changed. Projects left alone -
// unique names, and members of a collision group with nothing to distinguish
// them - are simply absent.
export function disambiguateNames(projects: NameCollisionInput[]): Disambiguation[] {
  const groups = new Map<string, number[]>();
  projects.forEach((p, i) => {
    const k = collisionKey(p.market, p.name);
    const g = groups.get(k);
    if (g) g.push(i);
    else groups.set(k, [i]);
  });

  const out: Disambiguation[] = [];
  for (const idxs of groups.values()) {
    if (idxs.length < 2) continue;
    const suffixes = idxs.map((i) => disambiguationSuffix(projects[i]));
    // A SUFFIX TWO MEMBERS SHARE IS NOT A DISTINGUISHING SUFFIX. Six resolutions
    // heard at one meeting all carry that meeting's date, and stamping it on all
    // six would leave them identical while claiming to have fixed them. Those
    // members keep their name, and the fact that they were not separated stays
    // visible in the report rather than being papered over.
    const seen = new Map<string, number>();
    for (const s of suffixes) if (s) seen.set(s, (seen.get(s) ?? 0) + 1);
    idxs.forEach((i, at) => {
      const suffix = suffixes[at];
      if (!suffix || (seen.get(suffix) ?? 0) > 1) return;
      const to = withSuffix(projects[i].name, suffix);
      if (to === projects[i].name) return;
      out.push({ index: i, project_key: projects[i].project_key, from: projects[i].name, to, suffix });
    });
  }
  return out;
}

export function deriveProjectName(ctx: NamingContext): ProjectName {
  // 1. TARGET.
  if (ctx.targetName) return { name: ctx.targetName, source: 'target' };

  const venue = venuePhrase(ctx.venueType);

  // 2. APPLICANT + venue.
  const applicant = modeOf(ctx.records.map((r) => cleanApplicant(r.applicant)));
  if (applicant) return { name: withVenue(applicant, venue), source: 'applicant' };

  // 3. SITE + venue.
  const address = modeOf(ctx.siteKeysByRecord.flat().map(cleanAddress));
  if (address) return { name: withVenue(address, venue), source: 'site' };

  // 4. CLEANED TITLE. The earliest record states what the matter is; later ones
  // only reference it. Fall through to the next record if cleaning leaves too
  // little to be a name.
  const sorted = [...ctx.records].sort((a, b) => {
    const da = a.published_date ?? a.deadline ?? a.first_seen ?? '';
    const db = b.published_date ?? b.deadline ?? b.first_seen ?? '';
    return String(da).localeCompare(String(db));
  });
  for (const r of sorted) {
    const cleaned = cleanProjectTitle(r.title ?? '');
    if (cleaned.length >= 12) return { name: cleaned, source: 'title' };
  }
  return {
    name: cleanProjectTitle(sorted[0]?.title ?? '') || 'Untitled project',
    source: 'title',
  };
}
