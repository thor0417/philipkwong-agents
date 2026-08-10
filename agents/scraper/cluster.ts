// THE CLUSTERING ENGINE. Records become projects.
//
// The dashboard shows records; the business thinks in projects. OCVibe is seven
// records, Heart Hotel is three Clark County filings plus a town-advisory-board
// item, CFTOD is a 2045 plan plus a dozen board items. A human reassembled those
// by hand to produce the July report. At 25 markets that is impossible.
//
// FOUR SIGNALS, IN PRIORITY ORDER. A record can carry several; the STRONGEST one
// that actually connects it becomes its cluster_reason, so every attachment is
// auditable and a false merge can be traced to the rule that made it.
//
//   1. target    a bypass term in targets.ts. Heart Hotel, OCVibe, Top Gun,
//                Platinum Triangle and Disney/CFTOD are named projects by
//                definition.
//   2. case      a recurring matter identifier, per jurisdiction, because the
//                numbering conventions differ (see CASE_RULES).
//   3. entity    the applicant/owner, normalized and fuzzy-matched.
//   4. site      a street address, an APN, or a source-published project name.
//
// WHY UNION-FIND AND NOT "FIRST RULE WINS THE PARTITION". The brief's rule order
// says a record joins on the first rule that fires, and that is exactly how the
// REASON is chosen here. It cannot be how the PARTITION is chosen, because the
// signals interlock: the three Las Vegas Museum of Art records are one project,
// but two of them join on the applicant (City Parkway V) and the third has no
// applicant at all and joins on the shared address (355 Promenade Place). Under
// a first-rule-wins partition the third record would sit in its own key forever
// and the July report's cluster could never be reproduced. So every signal
// unions, and priority only decides what we RECORD as the reason.
//
// NOTHING IS EVER HARD DELETED. A record that carries no signal is UNCLUSTERED,
// which is a first-class state: it appears in the Inbox, visible and attachable
// by hand. Clustering never removes a record and never forces a cluster to make
// the numbers look better.
//
// THE CURATION LAYER IS UNTOUCHABLE. A dismissed lead never joins a project (it
// is not even offered to the engine), and clustering writes nothing to status,
// notes, or manual_overrides.

import { distance } from 'fastest-levenshtein';
import {
  bestTargetForClustering,
  targetProjectName,
  type TargetDef,
} from './targets';
import { extractProjectNames, nameSignalApplies } from './project-name';
import { deriveSummary } from './project-summary';
import {
  deriveProjectName,
  disambiguateNames,
  type Disambiguation,
  type NameSource,
} from './project-naming';
import {
  deriveProjectStage,
  hasStallMarker,
  recordStage,
  type LadderStage,
  type ProjectStage,
} from '../../lib/taxonomy';

// ---- The record shape the engine consumes -----------------------------------
// Deliberately a plain structural type over the leads columns, so the same
// function serves the backfill (rows read from Supabase) and the write path
// (rows about to be written), with no adapter in between.
export interface ClusterRecord {
  id?: string | null;
  url: string;
  title?: string | null;
  raw_content?: string | null;
  market?: string | null;
  country?: string | null;
  region_state?: string | null;
  location?: string | null;
  applicant?: string | null;
  representative?: string | null;
  presented_by?: string | null;
  source?: string | null;
  source_type?: string | null;
  status?: string | null;
  // 'detached' means Philip pulled this record off a project by hand. The engine
  // treats it like a dismissal: it never re-clusters, so the next run cannot
  // undo his decision by the very rule he overruled. He can still attach it to
  // a project by hand from the Inbox, which sets 'manual'.
  cluster_reason?: string | null;
  published_date?: string | null;
  deadline?: string | null;
  first_seen?: string | null;
  milestone_date?: string | null;
  venue_type?: string | null;
  development_category?: string | null;
  // Which lane produced the record. Read ONLY by the name signal, which is
  // scoped to the intelligence stream (see project-name).
  stream?: string | null;
}

export type ClusterReason =
  | 'target'
  | 'case-family'
  | 'companion'
  | 'entity'
  | 'site'
  | 'name'
  | 'manual';

// Priority order. Lower is stronger; this IS the brief's rule order.
//
// 'name' sits LAST, below site. A published project name is the weakest of the
// five because it is the only one derived from prose rather than from a field a
// filing system populated: a case number, an applicant and an address are all
// asserted by the source, while a name is inferred from a headline. When a
// record carries a name and anything else, the other signal is the better
// explanation of why it belongs, and that is what gets recorded as the reason.
const REASON_PRIORITY: Record<Exclude<ClusterReason, 'manual'>, number> = {
  target: 0,
  'case-family': 1,
  // A companion item: the same meeting, the same sub-area of the same specific
  // plan. Ranked just below a case number because it IS a case-like identifier -
  // it just happens to be scoped to the hearing rather than to the jurisdiction.
  companion: 2,
  entity: 3,
  site: 4,
  name: 5,
};

// ---- Text helpers -----------------------------------------------------------

// The full text a record is matched against: its title plus its captured body.
export function recordText(r: ClusterRecord): string {
  return `${r.title ?? ''}\n${r.raw_content ?? ''}`;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// The market a record clusters within. Null market is its OWN bucket, never a
// wildcard: an undated trade-press story with no resolved geography must not
// merge into a market it was never placed in.
export function marketKey(r: ClusterRecord): string {
  return slug(r.market ?? r.location ?? '(unknown)') || 'unknown';
}

// ---- 3. ENTITY: normalization + the generic stoplist -------------------------

// Legal suffixes stripped so "KULIK RIVER CAPITAL, LLC" and "Kulik River Capital
// LLC" are one entity. Stripped repeatedly from the tail, because filings stack
// them ("Toll South LV LLC", "Cardinal Industries of Fla Inc").
const LEGAL_SUFFIXES = new Set([
  'llc', 'l.l.c', 'llp', 'lp', 'l.p', 'inc', 'incorporated', 'ltd', 'limited',
  'corp', 'corporation', 'co', 'company', 'plc', 'gp', 'pa', 'pc', 'pllc',
  'trust', 'partnership', 'partners', 'holdings', 'group', 'et', 'al', 'etal',
]);

// Normalized entity name: lowercase, parentheticals dropped, punctuation folded,
// legal suffixes stripped from the tail, leading "the" dropped.
export function normalizeEntity(raw: string | null | undefined): string {
  if (!raw) return '';
  let s = raw.toLowerCase();
  // "City Parkway V, Inc., (CPV)" -> drop the trailing acronym gloss.
  s = s.replace(/\([^)]*\)/g, ' ');
  // A filing that names several co-applicants ("Anaheim Real Estate Partners,
  // LLC, TS Anaheim, LLC, and FCD, LLC") is normalized on its FIRST named party,
  // which is the one that recurs across the project's records.
  s = s.split(/\s+and\s+|\s*;\s*/)[0];
  s = s.replace(/[^a-z0-9]+/g, ' ').trim();
  const parts = s.split(' ').filter(Boolean);
  while (parts.length > 1 && LEGAL_SUFFIXES.has(parts[parts.length - 1])) parts.pop();
  if (parts.length > 1 && parts[0] === 'the') parts.shift();
  return parts.join(' ');
}

// GENERIC APPLICANTS. "Never cluster on a generic applicant (a city, a county, a
// department)": a city is the applicant on hundreds of unrelated filings, and
// clustering on it would produce one meaningless mega-project per market.
//
// Matched against the WHOLE normalized name, never a leading token, because
// "City Parkway V" is the Las Vegas redevelopment corporation that ties the
// Museum of Art records together and must survive a stoplist that kills "City of
// Las Vegas".
const GENERIC_APPLICANT_PATTERNS: RegExp[] = [
  /^(city|county|town|village|state|board|department|office|bureau|division) of\b/,
  /\b(city council|town council|county commissioners|board of (county )?commissioners)\b/,
  /\b(planning|zoning|redevelopment|housing|park|library|utility|utilities) (commission|agency|authority|board|district)\b/,
  /\b(school district|water management district|redevelopment agency|housing authority)\b/,
  /\b(public works|community development|economic development|budget and finance|finance department)\b/,
  /\b(metropolitan (council|government)|formal meeting|subcommittee|committee)\b/,
  /^(city|county|state|district|department|council|commission|board|authority|agency)$/,
  /\b(director|councilman|councilwoman|councilmember|mayor)\b/,
  // NEW YORK'S AGENCIES NAME THEMSELVES AS THE APPLICANT, and on a
  // city-initiated action they are the applicant on every one of them. ZAP
  // writes "DCP - Department of City Planning (NYC)" as primary_applicant on
  // every neighbourhood rezoning the department sponsors, so clustering on it
  // welded the Long Island City Neighborhood Rezoning to the citywide Arena
  // Text Amendment - two unrelated city-initiated actions with nothing in
  // common but their sponsor.
  //
  // The patterns above miss these because ZAP writes them as an abbreviation
  // followed by an expansion, so neither "^department of" nor the bare-word
  // rule matches. Anchored on the abbreviation with its separator so a private
  // company whose name merely contains these letters is untouched.
  /^(dcp|hpd|edc|dot|dpr|dcas|nycha|sca|hra|dsny|ddc|nypd|fdny|acs|dep)\b[\s-]/,
  /\b(department of (city planning|housing preservation|parks|transportation|design|sanitation|environmental protection))\b/,
  /\b(economic development corporation|housing authority|school construction authority)\b/,
];

export function isGenericEntity(normalized: string): boolean {
  if (normalized.length < 4) return true;
  return GENERIC_APPLICANT_PATTERNS.some((p) => p.test(normalized));
}

// The entity a record clusters on: its applicant, falling back to the owner
// named in the representative field only when there is no applicant at all.
// presented_by is deliberately NOT used: it names the staff member who read the
// item out, which is the city, not the developer.
function entityOf(r: ClusterRecord): string {
  const e = normalizeEntity(r.applicant);
  if (e && !isGenericEntity(e)) return e;
  return '';
}

// AN AWARDEE IS A COUNTERPARTY, NOT A PROJECT SPONSOR.
//
// The entity signal assumes the named party is the one developing the thing.
// For a concession award that assumption is wrong in a specific way: the party
// is whoever won a licence to operate at a site the CITY owns, and one operator
// routinely holds several unrelated concessions.
//
// Busters Marine Bronx Marina, LLC is the case. Three New York City Parks
// concession notices, three different sites in three different boroughs -
// Locust Point Marina in the Bronx, Bayside Marina in Queens, and an outdoor
// cafe in WNYC Transmitter Park in Brooklyn - welded into one project called
// "Busters Marine Bronx Marina", because the boroughs fold to one market and
// the operator's name is the same on all three. The register then described a
// Brooklyn cafe concession as a Bronx marina.
//
// WHY NOT THE MORE GENERAL RULE. The obvious fix is "entity must not join
// records naming disjoint sites", and it was written and measured before this
// one. Over the whole corpus it fires on exactly ONE project - two Mulkey
// Holdings filings at 2001 and 2021 West Charleston Boulevard, which are
// adjacent parcels and a correct merge - and it does not catch Busters at all,
// because these notices name their sites as places ("Bayside Marina") rather
// than as street addresses. A rule that fixes nothing it was aimed at and
// breaks one thing that was right is not a fix.
//
// So the rule keys on what the record IS. Measured over the corpus: 11 records
// are concession awards, all nyc-city-record, and exactly one project is built
// from more than one of them.
//
// The record keeps every other signal. A concession notice that names a street
// address or a case number still clusters on it; what it no longer does is
// claim a project on the operator's name alone. The company relationship is not
// lost - the companies layer records that this operator holds three concessions
// - it simply stops being an assertion that they are one development.
const CONCESSION_AWARD_RE =
  /\bintent to award\b[\s\S]{0,40}\bas a concession\b|\bintent to award a concession\b|\bas a concession a license\b/i;

export function isConcessionAward(r: ClusterRecord): boolean {
  return CONCESSION_AWARD_RE.test(r.raw_content ?? '');
}

// FUZZY MATCHING. Library: fastest-levenshtein 1.0.16 (headless, dependency-free).
//
// THRESHOLD 0.90 normalized similarity (1 - distance/maxLength), and it is
// deliberately guarded on both sides:
//   - both names at least 10 characters, because 0.90 on a short name is
//     meaningless: "Toll South LV" and "Toll North LV" score 0.92 and are two
//     different developers.
//   - identical first token, because the leading word is the distinctive one in
//     a developer name and two names that disagree on it are not typos of each
//     other.
// Normalization alone already collapses the real-world case this exists for
// ("KULIK RIVER CAPITAL, LLC" vs "Kulik River Capital LLC" are identical after
// normalizeEntity). The fuzzy pass is what catches OCR drift and singular/plural
// slips that normalization cannot see.
export const ENTITY_SIMILARITY_THRESHOLD = 0.9;
const ENTITY_MIN_FUZZY_LENGTH = 10;

export function entitySimilarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 0;
  return 1 - distance(a, b) / max;
}

export function entitiesMatchFuzzily(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < ENTITY_MIN_FUZZY_LENGTH || b.length < ENTITY_MIN_FUZZY_LENGTH) return false;
  if (a.split(' ')[0] !== b.split(' ')[0]) return false;
  return entitySimilarity(a, b) >= ENTITY_SIMILARITY_THRESHOLD;
}

// ---- 2. CASE FAMILY: per jurisdiction, because the conventions differ --------
//
// A case root is a RECURRING MATTER identifier: the same string appears on every
// record of the same matter as it moves through hearings, holdovers and
// readings. Per-item document numbers (a resolution number, a contract number)
// are deliberately NOT case roots - they never recur, so they would only ever
// produce clusters of one while pretending to be evidence.
export interface CaseRule {
  // Which jurisdiction this convention belongs to (matched on market, then on
  // source, so a market that is not yet named still gets its source's rule).
  label: string;
  markets?: string[];
  sources?: string[];
  // Each pattern's first capture group (or whole match) is the case root.
  patterns: RegExp[];
}

export const CASE_RULES: CaseRule[] = [
  {
    label: 'Clark County, NV (entitlement case ids: UC/TM/VS/WS/DR/PA/ZC/AR/ET/ORD-yy-nnnn)',
    markets: ['Clark County'],
    sources: ['clark-tab'],
    patterns: [
      // The full id IS the matter: a holdover carries the same id to the next
      // meeting. The parenthetical parent in "AR-26-400027 (UC-22-0556)" is
      // captured too, which is what links an extension to its original case.
      /\b((?:UC|TM|VS|WS|DR|SDR|ZC|NZC|PA|AR|ET|SUP|VC|TC|ORD)-\d{2}-\d{3,6})\b/gi,
    ],
  },
  {
    label: 'Las Vegas, NV (primegov case yy-nnnn with an application suffix; Bill No. yyyy-n)',
    markets: ['Las Vegas'],
    patterns: [
      // 25-0530-SDR1, 24-0495-SUP1, 25-0362-GPA1 -> root 25-0530 etc. The
      // suffix is required: a bare \d{2}-\d{4} also matches the tail of
      // "R-44-2025", which is a per-item resolution number and no kind of root.
      /\b(\d{2}-\d{4})-[A-Z]{2,5}\d?\b/gi,
      /\bcase\s+(\d{2}-\d{4})\b/gi,
      // A bill recurs across three readings under one number.
      /\bbill\s+no\.?\s*(\d{4}-\d{1,3})\b/gi,
    ],
  },
  {
    label: 'Anaheim, CA (development agreement / development application / specific plan numbers)',
    markets: ['Anaheim'],
    patterns: [
      /\bdevelopment\s+agreement\s+no\.?\s*([\d][\d-]{2,12})/gi,
      /\bda\s+no\.?\s*([\d][\d-]{2,12})/gi,
      /\bdevelopment\s+application\s+no\.?\s*([\d][\d-]{2,12})/gi,
      /\bspecific\s+plan\s+no\.?\s*([\d][\d-]{2,12})/gi,
    ],
  },
  {
    label: 'Nashville, TN (metro bill/resolution numbers and Planning proposal numbers)',
    markets: ['Nashville'],
    patterns: [
      /\b((?:BL|RS)\d{4}-\d{3,4})\b/gi,
      // The proposal number is what links a zoning bill to its companion
      // building-materials bill.
      /\b(\d{4}[A-Z]{2}-\d{3}-\d{3})\b/gi,
    ],
  },
  {
    label: 'Phoenix, AZ (rezoning application Z-numbers and legistar file numbers)',
    markets: ['Phoenix'],
    patterns: [
      /\b(Z-\d{1,4}(?:-[A-Z0-9]{1,4}){1,3})\b/gi,
      /\bfile\s+(\d{2}-\d{4})\b/gi,
    ],
  },
  {
    label: 'CEQAnet (State Clearinghouse number)',
    sources: ['ceqanet'],
    patterns: [/\bSCH\s*#?\s*(\d{8,10})\b/gi, /ceqanet\.opr\.ca\.gov\/Project\/(\d+)/gi],
  },
  {
    // NEW YORK CITY: the CEQR number and the ULURP application numbers. These
    // are the case family for New York, the role case roots play in Clark
    // County - but they earn it differently, and the difference matters.
    //
    // A Clark County case id recurs because ONE matter is heard repeatedly. A
    // New York number recurs because one project is described by THREE
    // SOURCES: the ZAP entitlement row carries both numbers, the CEQR
    // environmental record carries the CEQR number, and a City Record hearing
    // notice names the ULURP number. So the case root is what stitches the
    // three layers of this market into one project instead of three.
    //
    // THE CEQR NUMBER IS THE PRIMARY ROOT because there is exactly one per
    // project. Shape: two-digit year, agency code, sequence, borough letter
    // (26DCP126M, 99HRA001K, 03BSA193Q).
    //
    // THE ULURP NUMBER is per APPLICATION, not per project, and one project
    // routinely files several - a map amendment and its companion text
    // amendment are different numbers on the same development. Shape: an
    // optional prefix letter, six digits, an action code, and a borough letter
    // (140316ZSR, N230150ZCM, M220029ALDM, F220467LDM). The trailing borough
    // letter is REQUIRED by the pattern: without it, any six digits followed
    // by letters would qualify and street addresses would start clustering.
    label: 'New York City (CEQR numbers and ULURP application numbers)',
    markets: ['New York City'],
    sources: ['nyc-zap', 'nyc-ceqr', 'nyc-city-record'],
    patterns: [
      /\b(\d{2}[A-Z]{2,6}\d{3,4}[A-Z]?)\b/gi,
      /\b([CNMF]?\d{6}[A-Z]{1,3}[MXKQR])\b/gi,
    ],
  },
  // ---- LEGISTAR, ANY JURISDICTION. Must stay LAST. --------------------------
  //
  // caseRuleFor returns the FIRST rule matching by market or source, so every
  // market-specific rule above still wins for its own market. This catches the
  // rest.
  //
  // WHY IT WAS MISSING AND WHAT IT COST. Case rules were keyed per market, so a
  // Legistar jurisdiction nobody had hand-listed had NO case signal at all -
  // not a weaker one, none. Westchester County's two Ice Casino Improvements
  // filings and Yonkers' budget ordinance carried no applicant, no address and
  // no target either, so they carried no signal of any kind and sat in the
  // Inbox permanently. The county read as zero projects while holding records
  // about a casino.
  //
  // Every Legistar instance publishes a file number for every matter; the
  // adapter already writes it as "File: BL2026-1451". Reading it is what makes
  // a new Legistar market work on arrival rather than on the day someone
  // notices it is empty.
  //
  // The second pattern is the capital-project code. Westchester writes
  // "BOND ACT(Amended)-RP02A-3248-Ice Casino Improvements I" and
  // "CBA-RP02A-3248-Ice Casino Improvements II" - two instruments, two file
  // numbers, ONE project, and the code is the only thing that says so.
  {
    label: 'Legistar, any jurisdiction (file number, capital project code)',
    sources: ['legistar'],
    patterns: [
      /^File:\s*([A-Z0-9][A-Z0-9.\-]{2,})\s*$/gim,
      /\b([A-Z]{2}\d{2}[A-Z]-\d{3,5})\b/g,
    ],
  },
];

// SOURCES WHOSE RECORD IS A PROJECT MANIFEST, NOT AN INDEX.
//
// MAX_CASE_ROOTS_PER_RECORD exists because a record naming many case roots is
// usually an agenda item listing many matters, and treating those as one matter
// merges unrelated developments. That premise is about AGENDA records, where
// one item genuinely can be about many things.
//
// A ZAP row is a different kind of object. The dataset's unit is the PROJECT -
// one row is one project by construction - and its ulurp_numbers column is that
// project's own list of applications. A ZAP row naming fourteen ULURP numbers
// is not an index of fourteen matters; it is one development that filed
// fourteen applications, and dropping its case signals would scatter the
// project across the very records that prove it is one.
//
// Measured over the 2023+ ZAP window: 51 of 517 rows carrying any ULURP number
// name more than three, so without this exemption 10% of New York entitlement
// filings would lose their case family entirely - and they are the LARGE ones,
// because filing count scales with project complexity.
//
// The exemption is per source and deliberately narrow. It is not "trust rows
// with many roots"; it is "this source's unit of publication is the project".
export const PROJECT_MANIFEST_SOURCES: ReadonlySet<string> = new Set(['nyc-zap']);

// ---- Two kinds of record that must not assert project identity --------------

// A CONTAINER RECORD is the meeting, not a matter in it: a whole town-advisory
// -board agenda, a Legistar calendar event, a portal landing page, a board
// agenda packet. Its body carries every item on the agenda, so it names a dozen
// unrelated case numbers and addresses at once.
//
// This is not theoretical. A single "Winchester Town Advisory Board Agenda"
// record bridged the World Buddhism Association / MGM-Grand Bally's lease to an
// unrelated 305 CCD off-site improvements waiver, producing a nine-record
// project out of two separate matters. A container carries NO signals at all
// and lands in the Inbox, where it is visible and attachable by hand.
//
// Detected on the container words in the title PLUS the absence of an item
// anchor in the URL: every real agenda ITEM in this corpus is captured with an
// '#item-N' fragment, so a record without one is the page, not the item.
const CONTAINER_TITLE_RE = /\b(agenda|agendas|calendar|minutes|portal|packet)\b/i;

// A CONTAINER CAN ALSO ANNOUNCE ITSELF IN ITS BODY, and in New York it does.
//
// The title test above was built for Legistar and Granicus, where the meeting
// says "agenda" on it. A New York community board publishes its meeting to the
// City Record under a title like "JUNE 9, 2026 PUBLIC HEARING" or "FEBRUARY 25,
// 2026 MEETING" - no container word anywhere - and then lists in its body every
// ULURP application the board will hear that night.
//
// BOTH OF THE FALSE MERGES THIS RULE WAS WRITTEN FOR CAME FROM ONE BOARD.
// Bronx Community Board No. 6, meeting at its own district office at 1932
// Arthur Avenue:
//
//   - "JUNE 9, 2026 PUBLIC HEARING" names ULURP 240206ZMX and N240207ZRX, the
//     Sojourner Truth / Mapes Rezoning case roots, so it joined that project.
//   - "PUBLIC HEARING ON THE GAMING FACILITY TEXT AMENDMENT" joined on the SITE
//     signal, because both notices carry 1932 Arthur Avenue - the board's own
//     office, which is where the meeting is, not where anything is being built.
//
// Between them they welded a Phipps Houses affordable-housing project at 110
// East 138th Street to a citywide casino zoning text amendment, and the
// register named the result "East 138th Street JV Associates casino". A client
// reading that would have been told an affordable-housing scheme was a casino.
//
// The phrase is the notice's own words and it is exactly the container claim:
// the record is about a LIST of matters, not a matter. Measured over the
// corpus: 23 records match, all nyc-city-record, 19 of them currently attached
// to a project.
//
// IT MUST NOT CATCH A SINGLE-MATTER NOTICE. The Franchise and Concession
// Review Committee publishes to the same section in the same format, and those
// notices are about one concession each ("NOTICE OF A JOINT PUBLIC HEARING ...
// relative to: INTENT TO AWARD as a concession a License Agreement to X").
// They carry no such phrase and are untouched, which is the whole point: this
// keys on the record declaring itself a list, not on it being a hearing.
const CONTAINER_BODY_RE = /\bthe following matters have been scheduled\b/i;

export function isContainerRecord(r: ClusterRecord): boolean {
  const url = r.url ?? '';
  if (url.includes('#event-')) return true;
  if (url.includes('#item')) return false;
  if (CONTAINER_TITLE_RE.test(r.title ?? '')) return true;
  return CONTAINER_BODY_RE.test(r.raw_content ?? '');
}

// A CITYWIDE / CITY-INITIATED record is legislation, not a project. An omnibus
// zoning update lists every specific plan it touches, and none of them is its
// subject: Anaheim's "Location: Citywide. Request: City-initiated clarifying
// technical amendments" item named Specific Plan No. 90-1 alongside four
// others, and that one bridge merged the Anaheim Hills Festival / OTR project
// into Platinum Triangle, which is precisely the false merge the acceptance
// test exists to catch.
//
// Such a record keeps its TARGET signal (a citywide ordinance amending the PTMU
// overlay genuinely belongs to Platinum Triangle, and the July report files it
// there) but contributes NO case-family signal, because the case numbers it
// lists are its scope, not its subject.
const CITYWIDE_RE = /\bcity[- ]initiated\b|\blocation:\s*citywide\b|\bcitywide\b/i;

export function isCitywideRecord(r: ClusterRecord): boolean {
  return CITYWIDE_RE.test(recordText(r));
}

// A FISCAL OR ELECTORAL RECORD names every district in the city and is about
// none of them. The annual budget adoption enumerates the Community Facilities
// Districts it appropriates for; a ballot measure names the areas a tax would
// apply to. Both mention "Platinum Triangle" without being about the Platinum
// Triangle in any sense a reader would recognise.
//
// THE LINE IS DRAWN AT BUDGETS AND BALLOTS, NOT AT TAXES. That distinction is
// the whole difficulty: "RESOLUTION ... levying Special Taxes within Community
// Facilities District No. 08-1 (Platinum Triangle)" IS a tax measure by the
// letter, and it IS a Platinum Triangle record - district-specific financing of
// that district's own infrastructure, which is why the July report files it
// there. A rule that keyed on "tax" would throw it out with the budget hearings.
// So the terms below name city-wide fiscal PROCESS (appropriations limits, the
// annual budget) and electoral process (ballot measures), never taxation itself.
//
// Spanish is included because Anaheim publishes its agendas in both languages
// and the translated budget hearing is a separate captured record.
const FISCAL_BALLOT_TERMS: RegExp[] = [
  /\bappropriations?\s+limits?\b/i,
  /\bbudget\s+appropriations?\b/i,
  /\bpublic hearing (?:on|to consider) the fiscal year\b/i,
  /\badopting the fiscal year[^.]{0,40}budget\b/i,
  /\bapproving the fiscal year[^.]{0,40}budget\b/i,
  /\bannual budget\b/i,
  /\bballot measure\b/i,
  /\bordering the submission\b/i,
  /\bgeneral municipal election\b/i,
  // Spanish equivalents of the same two classes.
  /\basignaciones presupuestarias\b/i,
  /\bpresupuesto del a[ñn]o fiscal\b/i,
];

export function isFiscalOrBallotRecord(r: ClusterRecord): boolean {
  const text = recordText(r);
  return FISCAL_BALLOT_TERMS.some((re) => re.test(text));
}

// A record naming MANY case roots is an index, not a filing. Anaheim's annual
// omnibus zoning update names five specific plans in one item, including SP 90-1
// (the Anaheim Hills Festival case root): treating those as one matter would
// merge citywide housekeeping into the OTR project and break the acceptance
// test. Above this count the record's case signals are dropped entirely; its
// entity and site signals still stand.
export const MAX_CASE_ROOTS_PER_RECORD = 3;

function caseRuleFor(r: ClusterRecord): CaseRule | null {
  const market = r.market ?? '';
  const source = r.source ?? '';
  for (const rule of CASE_RULES) {
    if (rule.markets?.includes(market)) return rule;
    if (rule.sources?.includes(source)) return rule;
  }
  return null;
}

export function caseRoots(r: ClusterRecord): { rule: string | null; roots: string[] } {
  const rule = caseRuleFor(r);
  if (!rule) return { rule: null, roots: [] };
  // THE TITLE NAMES THE SUBJECT; THE BODY NAMES THE SCOPE. For a citywide record
  // that distinction is the whole difference between a signal and a bridge: an
  // omnibus zoning update lists every specific plan it touches, and none of them
  // is what the item is about - but the application number in its own title is.
  //
  // So a citywide record keeps exactly ONE case root, the first one in its
  // title. Without this, "DEVELOPMENT APPLICATION NO. 2026-00022" heard at
  // Planning Commission and again at Council became two separate one-record
  // projects, because suppressing citywide case signals wholesale left nothing
  // holding the two halves of one application together. Taking only the FIRST
  // title root (not all of them) matters: the Council item's title itself goes
  // on to list Specific Plan No. 90-1 and three others, which is precisely the
  // bridge into Anaheim Hills Festival / OTR that must stay closed.
  const scanText = isCitywideRecord(r) ? (r.title ?? '') : recordText(r);
  const text = scanText;
  const found = new Set<string>();
  for (const p of rule.patterns) {
    const re = new RegExp(p.source, p.flags.includes('g') ? p.flags : `${p.flags}g`);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const root = (m[1] ?? m[0]).toLowerCase().replace(/\s+/g, '');
      if (root) found.add(root);
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  const roots = [...found];
  if (isCitywideRecord(r) && roots.length > 1) {
    // Order the title's roots by where they actually appear, and keep the first.
    roots.sort((a, b) => text.toLowerCase().indexOf(a) - text.toLowerCase().indexOf(b));
    return { rule: rule.label, roots: [roots[0]] };
  }
  return { rule: rule.label, roots };
}

// ---- 4. SITE: address, APN, or a source-published project name ---------------

const STREET_SUFFIX =
  'street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|way|lane|ln|place|pl|parkway|pkwy|court|ct|circle|cir|highway|hwy|trail|terrace|plaza|promenade';

const ADDRESS_RE = new RegExp(
  `\\b(\\d{2,6})\\s+((?:[nsew]\\.?\\s+)?(?:[a-z][a-z'.-]{1,18}\\s+){0,3}?(?:${STREET_SUFFIX}))\\b`,
  'gi'
);

// Clark County / Las Vegas assessor parcel numbers, and any labelled APN.
const APN_RE = /\bapns?\s*[:#]?\s*((?:\d{3}-\d{2}-\d{3}-\d{3})|(?:[\d]{3,}-[\d-]{5,}))/gi;

// SFWMD publishes the project identity as its own line. That IS the site: it is
// what separates the Disney Wilderness Preserve permits from the Animal Kingdom
// Lodge permits, which share a permit-family root and are two different places.
const SOURCE_PROJECT_RE = /^\s*Project:\s*(.+)$/gim;

// THE MEETING'S OWN VENUE IS NOT THE PROJECT'S SITE. Clark County's agenda PDFs
// bleed the hearing masthead into the extracted item text, so an entitlement
// item ends with "PLANNING COMMISSION (PC) Date: 7/21/2026 Location: 500 S.
// Grand Central Pkwy, Commission Chambers". That one courthouse address merged
// a World Buddhism Association / MGM-Grand Bally's lease into an unrelated 305
// CCD off-site improvements waiver.
//
// Matched on a window AROUND the address rather than a fixed prefix, because the
// giveaway sits on either side: "Commission Chambers" follows it here, and
// "Department of Administrative Services" precedes it on the agenda footer. A
// bare "Location:" is NOT a trigger: Anaheim writes "Location: This
// approximately 3.23-acre property is located at 1715 South Douglass Road",
// where Location: introduces exactly the site we want.
const CIVIC_VENUE_RE =
  /commission chambers|council chambers|board\s?room|government center|city hall|county courthouse|administrative services|clerk of the board|county manager/i;
const CIVIC_WINDOW_BEFORE = 90;
const CIVIC_WINDOW_AFTER = 60;

export function siteKeys(r: ClusterRecord): string[] {
  const text = recordText(r);
  const out = new Set<string>();

  // The record's OWN representative and applicant strings are excluded from the
  // address scan. Clark County staff reports print the attorney's office address
  // inline ("KAEMPFER CROWELL, JENNIFER LAZOVICH, 1980 FESTIVAL PLAZA DRIVE
  // #650"), and that one address appears on filings for four unrelated sites.
  const noise = `${r.representative ?? ''}\n${r.presented_by ?? ''}`;
  const noiseAddresses = new Set<string>();
  let nm: RegExpExecArray | null;
  const noiseRe = new RegExp(ADDRESS_RE.source, ADDRESS_RE.flags);
  while ((nm = noiseRe.exec(noise)) !== null) {
    noiseAddresses.add(`${nm[1]} ${nm[2]}`.toLowerCase().replace(/\s+/g, ' '));
  }

  const addrRe = new RegExp(ADDRESS_RE.source, ADDRESS_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = addrRe.exec(text)) !== null) {
    const key = `${m[1]} ${m[2]}`.toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '');
    if (noiseAddresses.has(key)) continue;
    const window = text.slice(
      Math.max(0, m.index - CIVIC_WINDOW_BEFORE),
      m.index + m[0].length + CIVIC_WINDOW_AFTER
    );
    if (CIVIC_VENUE_RE.test(window)) continue;
    out.add(`addr:${key}`);
  }

  const apnRe = new RegExp(APN_RE.source, APN_RE.flags);
  while ((m = apnRe.exec(text)) !== null) out.add(`apn:${m[1].toLowerCase()}`);

  const projRe = new RegExp(SOURCE_PROJECT_RE.source, SOURCE_PROJECT_RE.flags);
  while ((m = projRe.exec(text)) !== null) {
    const name = m[1].trim().toLowerCase().replace(/\s+/g, ' ');
    if (name.length >= 4) out.add(`proj:${name}`);
  }

  return [...out];
}

// An address carried by many unrelated records in one market is an OFFICE, not a
// site: a law firm, a city hall, a filing agent. Above this count the address is
// dropped from clustering and reported, so the suppression is visible rather
// than silent.
export const MAX_RECORDS_PER_ADDRESS = 3;

// The shortest applicant name allowed to claim an intelligence record from its
// prose (see the cross-stream pass). Longer than the entity signal's own floor,
// because matching a company name inside free text is a weaker act than reading
// it out of an applicant field: a short name matches inside unrelated phrases.
export const CROSS_STREAM_MIN_ENTITY = 10;

// ---- 5. COMPANION: the same meeting, the same sub-area -----------------------

// A Development Area designator: "DA 5", "DA5". A sub-area of a specific plan,
// which is how a council agenda refers to the piece of a plan an amendment
// touches when it does not repeat the plan's own number.
//
// Deliberately narrow. It is NOT a general "sub-area" scanner: 'Area 5',
// 'Planning Area 5' and 'District 5' are all common enough on an agenda to
// collide across unrelated matters, and 'DA' is the one abbreviation that is
// unambiguous in this corpus. Five records carry it in total.
const SUBAREA_RE = /\bDA\s?(\d{1,2})\b/g;

export function subareaKeys(r: ClusterRecord): string[] {
  const re = new RegExp(SUBAREA_RE.source, SUBAREA_RE.flags);
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  const text = recordText(r);
  while ((m = re.exec(text)) !== null) out.add(`da${m[1]}`);
  return [...out];
}

// The meeting a record was heard at: its agenda URL without the item fragment.
// Two items on one agenda share it; the same agenda re-heard at a later meeting
// has a different clip id and therefore a different key, which is correct - a
// continuation is joined through the case root its other half carries.
export function meetingOf(r: ClusterRecord): string {
  return String(r.url ?? '').split('#')[0];
}

// ---- The engine -------------------------------------------------------------

export interface ClusteredProject {
  project_key: string;
  name: string;
  // Which rule produced the name: target, applicant, site or title. Kept so the
  // register can show how confident the name is instead of presenting a cleaned
  // agenda line as if it were a project's real name.
  name_source: NameSource;
  market: string | null;
  country: string | null;
  region_state: string | null;
  stage: ProjectStage;
  development_category: string | null;
  venue_type: string | null;
  primary_applicant: string | null;
  primary_representative: string | null;
  last_activity: string | null;
  next_milestone: string | null;
  first_seen: string | null;
  // One line saying what the project IS, quoted from its own records. Null when
  // none of them contains a usable sentence, which is the honest answer for a
  // project whose only record is a meeting agenda. The GENERATED fallback is not
  // computed here: it costs a model call per project and the clusterer runs on
  // every scrape. See migrations/backfill-project-summaries.ts.
  summary: string | null;
  summary_source: 'derived' | null;
  // The filing the sentence was quoted from, so a report can cite it.
  summary_url: string | null;
  record_count: number;
  live: boolean;
  liveness_reason: ProjectLiveness['reason'];
  // The member records, each with the reason it joined.
  members: { record: ClusterRecord; reason: ClusterReason }[];
}

export interface ClusterResult {
  projects: ClusteredProject[];
  // Records that carried no signal at all. Visible in the Inbox, never hidden.
  unclustered: ClusterRecord[];
  // Telemetry, all of it reported rather than swallowed.
  reasonCounts: Record<string, number>;
  casePatternsFound: Record<string, number>;
  fuzzyMerges: { a: string; b: string; similarity: number; market: string }[];
  // Whole-agenda / calendar / portal records, which carry no signals and land in
  // the Inbox rather than bridging every matter printed on the page.
  containerRecords: number;
  // Citywide / city-initiated legislation narrowed to the single case root named
  // in its own title (its subject), discarding the ones its body merely scopes.
  citywideRecordsDropped: number;
  omnibusRecordsDropped: number;
  // Records naming more than one Development Area, refused as an index of a
  // whole plan rather than a filing about one part of it.
  multiSubareaRecords: number;
  officeAddressesDropped: { key: string; records: number; market: string }[];
  // Extracted project names that at least two records shared, so the name became
  // a usable signal. Reported so every name-based merge is inspectable.
  namesCorroborated: { key: string; records: number }[];
  // Names seen exactly once, which are suppressed rather than made into
  // one-record projects. Counted, not listed: there are hundreds.
  namesUncorroborated: number;
  // Intelligence records attached to a project by recognising a government
  // applicant's name in their prose. Listed, because this rule crosses streams.
  crossStreamAttached: { entity: string; market: string; title: string }[];
  // Intelligence records naming more than one known developer, refused rather
  // than allowed to bridge two projects.
  crossStreamAmbiguous: number;
  skippedDismissed: number;
  // Records Philip detached by hand, which never re-cluster.
  skippedDetached: number;
  // Why each project is live or dormant (Part F).
  livenessReasons: Record<string, number>;
  // Projects whose derived name collided with another project in the same market
  // and gained a suffix from their own record (see project-naming). Listed in
  // full: a renamed project is a visible change to what the register says, so
  // every one of them is inspectable.
  namesDisambiguated: Disambiguation[];
  // Collision groups nothing could separate - same name, same market, and no
  // case number or date of their own. Counted so the failure is not silent.
  namesStillColliding: number;
}

class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

interface Signal {
  key: string;
  reason: Exclude<ClusterReason, 'manual'>;
}

// The best available date for a record: the source deadline, else the published
// date, else when we first saw it. Used for last_activity and liveness only.
export function bestDate(r: ClusterRecord): string | null {
  return r.deadline ?? r.published_date ?? r.first_seen ?? null;
}

// ---- Naming -----------------------------------------------------------------

// Procedural chrome that every agenda title carries and no project is called.
const TITLE_STRIP: RegExp[] = [
  /^\s*(?:item\s+no\.?\s*\d+|\d{1,3})[.)]\s*/i,
  /^\s*(?:for possible action(?:\s+(?:to|on|regarding))?)\s*/i,
  /^\s*(?:discussion (?:and|for) (?:possible )?action(?:\s+(?:to|on|regarding))?)\s*/i,
  /^\s*(?:approve|adopt|authorize|consider|determine|receive and file)\s+(?:the\s+)?(?:ratification of the\s+)?/i,
  /^\s*(?:abeyance|holdover|renotification|public hearing|resolution|ordinance)\s*[-:]\s*/i,
  /^\s*(?:bill no\.?\s*[\d-]+)\s*[-:]\s*/i,
  /^\s*adopts that certain document entitled\s*/i,
  /^\s*on the basis of the evidence submitted by\s*/i,
];

export function cleanTitle(title: string): string {
  let t = title.replace(/\s+/g, ' ').trim();
  for (let pass = 0; pass < 4; pass++) {
    const before = t;
    for (const re of TITLE_STRIP) t = t.replace(re, '');
    // Leading case numbers ("UC-26-0219-KULIK RIVER CAPITAL, LLC:").
    t = t.replace(/^\s*[A-Z]{2,4}-\d{2}-\d{3,6}\s*[-:]\s*/i, '');
    t = t.replace(/^\s*[-:,.–—]\s*/, '');
    if (t === before) break;
  }
  t = t.replace(/^["'“‘]+|["'”’]+$/g, '').trim();
  return t.length > 90 ? `${t.slice(0, 87).trimEnd()}...` : t;
}

// NAMING MOVED OUT. A project used to be named by cleaning its earliest
// record's title and cutting it to length, which is why 148 of 179 names were
// unusable: an agenda title is an instruction to a council, not a name. The
// rule now lives in agents/scraper/project-naming, which tries the target, then
// the applicant plus venue type, then the site plus venue type, and only then
// the cleaned title. cleanTitle above is retained because the naming module and
// other callers still use the same idea of procedural chrome.

// The most common non-null value, for rolling a project's geography and people
// up from its records.
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

export interface ClusterOptions {
  // Liveness window in months (Part F). A project with a heartbeat inside it, or
  // a future milestone, is live.
  livenessMonths?: number;
  now?: number;
}

function monthsBefore(now: number, n: number): number {
  const d = new Date(now);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() - n;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(year, month, Math.min(d.getUTCDate(), lastDay));
}

// ---- PROJECT LIVENESS (Part F) ----------------------------------------------
// A PROJECT is live if ANY of its records heartbeats inside the window, or the
// project carries a future milestone. Otherwise it is dormant.
//
// THIS IS PROJECT-LEVEL AND INDEPENDENT OF PER-RECORD LIFECYCLE. A project with
// one recent record is live even if its other records have aged out and been
// archived individually: the project is the thing that is alive, and it is alive
// because something happened to it. Reading liveness off the records one at a
// time is how a live project with a long history reads as dead.
//
// The window matches the project-event model in lead-date.ts, which already
// treats 12 months of silence as the boundary, so a project and its records do
// not disagree about what recent means.
export const PROJECT_LIVENESS_MONTHS = 12;

export interface ProjectLiveness {
  live: boolean;
  // The most recent heartbeat across every attached record.
  lastActivity: string | null;
  // The NEAREST future milestone across every attached record. Nearest, not
  // furthest: it is the next thing that happens, which is what a register is
  // read for.
  nextMilestone: string | null;
  // Why the project is live, for the report.
  reason: 'future milestone' | 'recent activity' | 'undated' | 'dormant';
}

export function projectLiveness(
  records: ClusterRecord[],
  now: number = Date.now(),
  months: number = PROJECT_LIVENESS_MONTHS
): ProjectLiveness {
  const liveFloor = monthsBefore(now, months);

  // A future milestone is any future-dated milestone across the records: a
  // parsed milestone_date ("opening 2028", a scheduled hearing) OR a real
  // submission deadline still to come. A deadline next month is as much a
  // future milestone as a groundbreaking, and omitting it would let a project
  // with a live tender attached read as dormant.
  const future = [
    ...records.map((r) => r.milestone_date),
    ...records.map((r) => r.deadline),
  ]
    .filter((d): d is string => {
      if (!d) return false;
      const t = new Date(d).getTime();
      return !Number.isNaN(t) && t > now;
    })
    .sort();

  const dates = records
    .map((r) => bestDate(r))
    .filter((d): d is string => Boolean(d) && !Number.isNaN(new Date(d as string).getTime()))
    .sort();
  const lastActivity = dates.length ? dates[dates.length - 1] : null;
  const nextMilestone = future[0] ?? null;

  if (nextMilestone) return { live: true, lastActivity, nextMilestone, reason: 'future milestone' };
  // Undated is never assumed old: the dashboard badges these DATE UNKNOWN
  // rather than burying them.
  if (!lastActivity) return { live: true, lastActivity, nextMilestone, reason: 'undated' };
  if (new Date(lastActivity).getTime() >= liveFloor) {
    return { live: true, lastActivity, nextMilestone, reason: 'recent activity' };
  }
  return { live: false, lastActivity, nextMilestone, reason: 'dormant' };
}

// Cluster a corpus of records into projects.
//
// DISMISSED ROWS NEVER JOIN A PROJECT: they are filtered out here, before any
// signal is computed, so no rule can resurrect one.
export function clusterRecords(
  input: ClusterRecord[],
  opts: ClusterOptions = {}
): ClusterResult {
  const now = opts.now ?? Date.now();
  const livenessMonths = opts.livenessMonths ?? PROJECT_LIVENESS_MONTHS;

  const skippedDismissed = input.filter((r) => r.status === 'dismissed').length;
  const skippedDetached = input.filter(
    (r) => r.status !== 'dismissed' && r.cluster_reason === 'detached'
  ).length;
  const records = input.filter((r) => r.status !== 'dismissed' && r.cluster_reason !== 'detached');

  const result: ClusterResult = {
    projects: [],
    unclustered: [],
    reasonCounts: {},
    casePatternsFound: {},
    fuzzyMerges: [],
    containerRecords: 0,
    citywideRecordsDropped: 0,
    omnibusRecordsDropped: 0,
    multiSubareaRecords: 0,
    officeAddressesDropped: [],
    namesCorroborated: [],
    namesUncorroborated: 0,
    crossStreamAttached: [],
    crossStreamAmbiguous: 0,
    skippedDismissed,
    skippedDetached,
    livenessReasons: {},
    namesDisambiguated: [],
    namesStillColliding: 0,
  };

  // ---- Pass 1: signals per record -------------------------------------------
  const signals: Signal[][] = [];
  const targets: (TargetDef | null)[] = [];
  const addressCounts = new Map<string, number>();

  for (const r of records) {
    const text = recordText(r);
    const mk = marketKey(r);
    const sigs: Signal[] = [];

    // A container record is the meeting, not a matter in it. No signals at all.
    if (isContainerRecord(r)) {
      result.containerRecords++;
      signals.push(sigs);
      targets.push(null);
      continue;
    }

    // 1. Target term. A non-perMarket target is one project wherever it appears;
    // a portfolio target clusters per market.
    const target = bestTargetForClustering(text, { fiscalOrBallot: isFiscalOrBallotRecord(r) });
    targets.push(target);
    if (target) {
      const key = target.perMarket
        ? `target:${slug(target.name)}:${mk}`
        : `target:${slug(target.name)}`;
      sigs.push({ key, reason: 'target' });
    }

    // 2. Case family (market-scoped). Suppressed for citywide legislation and
    // for any record that names more matters than a single filing can be about.
    const { rule, roots } = caseRoots(r);
    if (rule) result.casePatternsFound[rule] = (result.casePatternsFound[rule] ?? 0) + roots.length;
    if (roots.length > 0 && isCitywideRecord(r)) result.citywideRecordsDropped++;
    if (roots.length > MAX_CASE_ROOTS_PER_RECORD && !PROJECT_MANIFEST_SOURCES.has(r.source ?? '')) {
      result.omnibusRecordsDropped++;
    } else {
      for (const root of roots) sigs.push({ key: `case:${mk}:${root}`, reason: 'case-family' });
    }

    // 3. Entity (market-scoped), unless the party is a concession counterparty.
    const entity = isConcessionAward(r) ? '' : entityOf(r);
    if (entity) sigs.push({ key: `entity:${mk}:${entity}`, reason: 'entity' });

    // 4. Site (market-scoped).
    for (const s of siteKeys(r)) {
      const key = `site:${mk}:${s}`;
      if (s.startsWith('addr:')) addressCounts.set(key, (addressCounts.get(key) ?? 0) + 1);
      sigs.push({ key, reason: 'site' });
    }

    // 5. COMPANION ITEM: the same meeting, the same sub-area.
    //
    // THE MISS THIS FIXES. An entitlement reaches a council as two adjacent
    // agenda items: a General Plan Amendment and a Specific Plan Amendment, two
    // halves of one application. The Anaheim Hills Festival pair proves it -
    // items 23 and 24 of the 2025-12-15 meeting, and items 19 and 20 of the
    // 2026-01-12 continuation. The SPA half names "Specific Plan No. 90-1" and
    // clusters on that case root. The GPA half names no case number, no
    // applicant and no address; its entire subject is "change the land use
    // designation within DA 5 from Regional Commercial to Mixed-Use Medium".
    // So it carried no signal at all and sat in the Inbox while its own sibling
    // was in the project.
    //
    // THE GENERAL RULE WAS TESTED AND REJECTED. "Same meeting, same market,
    // overlapping subject" merges everything a council does in one sitting.
    // Measured on the 2025-12-15 Anaheim agenda alone, that would have joined
    // the Nitrous Oxide and Kratom ordinances, a Good Hope International hotel
    // compliance review, the Anaheim GardenWalk agreement, the PT Metro A-Town
    // agreement and the Festival items into ONE project - six developments and
    // two public-health ordinances. A meeting is a container, exactly as
    // isContainerRecord already says.
    //
    // SO THIS IS THE NARROW FIX. The signal is not "same meeting", it is "same
    // meeting AND the same named sub-area". A Development Area designator is a
    // sub-area of a specific plan, so DA 5 heard on one agenda is one matter.
    // Scoped to the meeting URL, so DA 5 in an unrelated specific plan at
    // another hearing cannot reach it.
    //
    // A RECORD NAMING MORE THAN ONE SUB-AREA IS REFUSED, the same way an
    // omnibus record naming many case roots is: the Anaheim Hills Festival
    // development application names DA 5 and DA 2 and is an index of the
    // whole plan, not a filing about one area. It clusters on its case
    // number regardless.
    //
    // MEASURED over the whole corpus: 5 records carry a sub-area token at all,
    // 1 is refused for naming two, and the rule creates exactly 2 groups - the
    // two GPA/SPA pairs it was written for. No other record is touched.
    const subareas = subareaKeys(r);
    if (subareas.length === 1) {
      sigs.push({ key: `companion:${mk}:${meetingOf(r)}:${subareas[0]}`, reason: 'companion' });
    } else if (subareas.length > 1) {
      result.multiSubareaRecords++;
    }

    // 6. NAME (market-scoped), intelligence stream only.
    //
    // The signal that lets a market with no government coverage appear in the
    // register at all. Trade press names a project and carries none of the four
    // signals above, so 391 of 410 intelligence records had nothing to cluster
    // on. Scoped hard to the stream it was built for: on government titles the
    // same extraction merges procedural boilerplate across unrelated projects,
    // measured and documented in project-name.
    if (nameSignalApplies(r.stream)) {
      for (const n of extractProjectNames(r.title)) {
        sigs.push({ key: `name:${mk}:${n.key}`, reason: 'name' });
      }
    }

    signals.push(sigs);
  }

  // Office-address suppression: an address on more than MAX_RECORDS_PER_ADDRESS
  // records in one market is a law firm or a city hall, not a project site.
  const suppressed = new Set<string>();
  for (const [key, n] of addressCounts) {
    if (n > MAX_RECORDS_PER_ADDRESS) {
      suppressed.add(key);
      const [, market, ...rest] = key.split(':');
      result.officeAddressesDropped.push({ key: rest.join(':'), records: n, market });
    }
  }
  // ---- Pass 1b: CROSS-STREAM ENTITY ATTACHMENT ------------------------------
  //
  // An intelligence record naming OCVibe joins the OCVibe project, because
  // 'ocvibe' is a target term. An intelligence record naming Kulik River Capital
  // joins Heart Hotel for the same reason. But those are the only two projects
  // it works for: measured, exactly 2 of 179 projects contain more than one
  // stream, and both are target-named. The other 158 government projects have no
  // route to receive press coverage at all, because a target term is the ONLY
  // signal an intelligence record and a government record could previously
  // share - trade press has no applicant column to match on.
  //
  // So the entity signal is extended to read prose. A government filing ASSERTS
  // its applicant in a field; a headline names the same company in a sentence.
  // The vocabulary comes entirely from applicant fields already in the corpus,
  // so this invents no entities - it only lets an existing one be recognised
  // where it is written out rather than filed.
  //
  // THREE GUARDS, because this rule reaches across streams and a mistake here
  // attaches press to the wrong project:
  //   - the entity must be at least CROSS_STREAM_MIN_ENTITY characters. Short
  //     names match inside unrelated words and inside each other.
  //   - it must not be generic, which isGenericEntity already decides.
  //   - A RECORD MATCHING MORE THAN ONE ENTITY IS REFUSED ENTIRELY. "Company A
  //     and Company B partner on a resort" would otherwise BRIDGE two separate
  //     government projects into one, which is the worst failure this engine
  //     has. A record naming several developers is a market roundup, not a
  //     project record. Same reasoning as MAX_CASE_ROOTS_PER_RECORD.
  const knownEntities = new Map<string, Set<string>>();
  for (let i = 0; i < records.length; i++) {
    const e = entityOf(records[i]);
    if (!e || e.length < CROSS_STREAM_MIN_ENTITY) continue;
    const mk = marketKey(records[i]);
    if (!knownEntities.has(mk)) knownEntities.set(mk, new Set());
    knownEntities.get(mk)!.add(e);
  }
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (!nameSignalApplies(r.stream)) continue;
    if (signals[i].some((s) => s.reason === 'entity')) continue;
    const mk = marketKey(r);
    const pool = knownEntities.get(mk);
    if (!pool) continue;
    const hay = ` ${recordText(r).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
    const hits = [...pool].filter((e) => hay.includes(` ${e} `));
    if (hits.length === 0) continue;
    if (hits.length > 1) {
      result.crossStreamAmbiguous++;
      continue;
    }
    signals[i].push({ key: `entity:${mk}:${hits[0]}`, reason: 'entity' });
    result.crossStreamAttached.push({ entity: hits[0], market: mk, title: (r.title ?? '').slice(0, 90) });
  }

  // A NAME SIGNAL MUST BE CORROBORATED. It only counts when at least one other
  // record carries the same name in the same market.
  //
  // Without this the rule does not cluster, it renames the Inbox. Every trade
  // press headline that yields a distinctive phrase would become a ONE-RECORD
  // project: measured, that turned 219 unclustered records into 435 projects, of
  // which roughly 256 were singletons invented from a single headline. The
  // register would have grown by 143 percent while learning almost nothing, and
  // every one of those names would then have landed in Part Three's naming
  // problem.
  //
  // The other four signals are exempt, and the asymmetry is deliberate. A case
  // number, an applicant and an address are ASSERTED BY THE SOURCE: one Clark
  // County filing with a case number is a real filing on a real project even if
  // nothing else references it yet. A name is INFERRED FROM PROSE, so a single
  // occurrence is one journalist's phrasing and not yet evidence of anything.
  // Corroboration is what turns it into evidence.
  //
  // A record whose only signal was an uncorroborated name stays in the Inbox,
  // visible and attachable by hand, exactly as before.
  const nameCounts = new Map<string, number>();
  for (const sigs of signals) {
    for (const s of sigs) {
      if (s.reason === 'name') nameCounts.set(s.key, (nameCounts.get(s.key) ?? 0) + 1);
    }
  }
  for (const [key, n] of nameCounts) {
    if (n < 2) suppressed.add(key);
    else result.namesCorroborated.push({ key: key.split(':').slice(2).join(':'), records: n });
  }
  result.namesUncorroborated = [...nameCounts.values()].filter((n) => n < 2).length;

  for (let i = 0; i < signals.length; i++) {
    signals[i] = signals[i].filter((s) => !suppressed.has(s.key));
  }

  // ---- Pass 2: union on every shared signal ---------------------------------
  const uf = new UnionFind(records.length);
  const byKey = new Map<string, number[]>();
  for (let i = 0; i < signals.length; i++) {
    for (const s of signals[i]) {
      if (!byKey.has(s.key)) byKey.set(s.key, []);
      byKey.get(s.key)!.push(i);
    }
  }
  for (const idxs of byKey.values()) {
    for (let k = 1; k < idxs.length; k++) uf.union(idxs[0], idxs[k]);
  }

  // Fuzzy entity pass, strictly within a market.
  const entityKeys = [...byKey.keys()].filter((k) => k.startsWith('entity:'));
  for (let a = 0; a < entityKeys.length; a++) {
    for (let b = a + 1; b < entityKeys.length; b++) {
      const [, ma, ...na] = entityKeys[a].split(':');
      const [, mb, ...nb] = entityKeys[b].split(':');
      if (ma !== mb) continue;
      const nameA = na.join(':');
      const nameB = nb.join(':');
      if (!entitiesMatchFuzzily(nameA, nameB)) continue;
      result.fuzzyMerges.push({
        a: nameA,
        b: nameB,
        similarity: Number(entitySimilarity(nameA, nameB).toFixed(3)),
        market: ma,
      });
      uf.union(byKey.get(entityKeys[a])![0], byKey.get(entityKeys[b])![0]);
    }
  }

  // ---- Pass 3: build the projects -------------------------------------------
  const groups = new Map<number, number[]>();
  for (let i = 0; i < records.length; i++) {
    if (signals[i].length === 0) {
      result.unclustered.push(records[i]);
      continue;
    }
    const root = uf.find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(i);
  }

  for (const idxs of groups.values()) {
    const members = idxs.map((i) => {
      // The reason is the STRONGEST signal this record carries: the brief's
      // "first rule that fires", recorded per record.
      // Seeded with the record's OWN first signal, never with a fixed sentinel.
      // It used to seed with 'site', which silently assumed site was the weakest
      // reason. Adding 'name' below site made that assumption wrong and the bug
      // visible: a record carrying only a name signal was reported as 'site',
      // so 280 intelligence records were attributed to a signal none of them
      // had. signals[i] is non-empty here - the empty case returned above.
      const best = signals[i].reduce<Exclude<ClusterReason, 'manual'>>(
        (acc, s) => (REASON_PRIORITY[s.reason] < REASON_PRIORITY[acc] ? s.reason : acc),
        signals[i][0].reason
      );
      return { record: records[i], reason: best as ClusterReason };
    });
    for (const m of members) result.reasonCounts[m.reason] = (result.reasonCounts[m.reason] ?? 0) + 1;

    const recs = members.map((m) => m.record);
    const market = modeOf(recs.map((r) => r.market));
    const target = idxs.map((i) => targets[i]).find((t): t is TargetDef => Boolean(t)) ?? null;

    // Stage: most advanced ladder signal across all records, with a stall read
    // off the most recent record and dormancy read off the heartbeat.
    const recordStages: LadderStage[] = recs.map((r) => recordStage(recordText(r), r.source_type));
    const dated = [...recs].sort((a, b) => (bestDate(b) ?? '').localeCompare(bestDate(a) ?? ''));
    const latest = dated[0];
    const liveness = projectLiveness(recs, now, livenessMonths);
    result.livenessReasons[liveness.reason] = (result.livenessReasons[liveness.reason] ?? 0) + 1;
    const stage = deriveProjectStage({
      recordStages,
      latestRecordStalled: hasStallMarker(recordText(latest)),
      live: liveness.live,
    });

    // project_key: the strongest signal class present, and within it the
    // lexicographically smallest key, so the same membership always produces the
    // same key.
    const allSignals = idxs.flatMap((i) => signals[i]);
    // Seeded with Infinity, not with REASON_PRIORITY.site. Seeding with site
    // assumed site was the weakest reason; once 'name' ranked below it, a
    // project whose only signals were names computed strongest = site, matched
    // no signal, and produced an UNDEFINED project_key - the upsert key. Same
    // latent assumption as the per-record reason seed, in the second place it
    // was written.
    const strongest = allSignals.reduce(
      (acc, s) => Math.min(acc, REASON_PRIORITY[s.reason]),
      Number.POSITIVE_INFINITY
    );
    const projectKey = allSignals
      .filter((s) => REASON_PRIORITY[s.reason] === strongest)
      .map((s) => s.key)
      .sort()[0];

    // THE NAMING RULE (agents/scraper/project-naming): target, then applicant
    // plus venue type, then site plus venue type, then a cleaned title. Which
    // source fired is kept, so the register can show its own confidence.
    const venueType = modeOf(recs.map((r) => r.venue_type));
    const named = deriveProjectName({
      targetName: target ? targetProjectName(target, market) : null,
      records: recs,
      venueType,
      // Office addresses are excluded here as well as from clustering. A law
      // firm's address or a city hall is not a project's site, so it must not
      // become a project's NAME either: "3560 Lennox Road leisure development"
      // named a mitigation bank after its filing agent's office.
      siteKeysByRecord: recs.map((r) =>
        siteKeys(r).filter((s) => !suppressed.has(`site:${marketKey(r)}:${s}`))
      ),
    });

    const derived = deriveSummary(
      recs.map((r) => ({
        url: r.url,
        title: r.title ?? null,
        raw_content: r.raw_content ?? null,
        source: r.source ?? null,
        published_date: r.published_date ?? null,
      }))
    );

    result.projects.push({
      project_key: projectKey,
      name: named.name,
      name_source: named.source,
      market,
      country: modeOf(recs.map((r) => r.country)),
      region_state: modeOf(recs.map((r) => r.region_state)),
      stage,
      development_category: modeOf(recs.map((r) => r.development_category)),
      venue_type: modeOf(recs.map((r) => r.venue_type)),
      primary_applicant: modeOf(recs.map((r) => r.applicant)),
      primary_representative: modeOf(recs.map((r) => r.representative)),
      last_activity: liveness.lastActivity,
      next_milestone: liveness.nextMilestone,
      first_seen: recs.map((r) => r.first_seen).filter(Boolean).sort()[0] ?? null,
      // RECOMPUTED FROM THE MEMBERS ON EVERY RUN, which is what makes it update
      // when a record is attached: a project that gains a ZAP filing gains the
      // brief that filing carries. A hand-written summary is protected the same
      // way a hand-set name is, by manual_overrides in project-write.
      summary: derived?.summary ?? null,
      summary_source: derived ? 'derived' : null,
      summary_url: derived?.sourceUrl ?? null,
      record_count: recs.length,
      live: liveness.live,
      liveness_reason: liveness.reason,
      members,
    });
  }

  // ---- Pass 5: make the names distinct --------------------------------------
  //
  // Run over the finished project set, because a collision is a property of the
  // set and not of any one project: deriveProjectName sees one project's records
  // and cannot know that another project two markets' worth of rows away landed
  // on the same string. Six Nashville TIF resolutions each produced a perfectly
  // reasonable name and the six together were unreadable.
  //
  // Derived on every run from the same inputs, like the name itself, so it is
  // idempotent: a project already carrying "(RS2026-2083)" collides with nothing
  // on the next run, and a project that stops colliding (its twin was dismissed)
  // loses the suffix rather than keeping a scar.
  const renames = disambiguateNames(
    result.projects.map((p) => ({
      name: p.name,
      market: p.market,
      project_key: p.project_key,
      caseNumbers: p.members.flatMap((m) => caseRoots(m.record).roots.map((r) => r.toUpperCase())),
      date: p.last_activity,
    }))
  );
  for (const r of renames) result.projects[r.index].name = r.to;
  result.namesDisambiguated = renames;
  const stillByName = new Map<string, number>();
  for (const p of result.projects) {
    const k = `${p.market ?? ''}|${p.name.toLowerCase()}`;
    stillByName.set(k, (stillByName.get(k) ?? 0) + 1);
  }
  for (const n of stillByName.values()) if (n > 1) result.namesStillColliding += n;

  result.projects.sort((a, b) => b.record_count - a.record_count);
  return result;
}
