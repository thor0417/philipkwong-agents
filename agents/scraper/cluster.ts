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
  published_date?: string | null;
  deadline?: string | null;
  first_seen?: string | null;
  milestone_date?: string | null;
  venue_type?: string | null;
  development_category?: string | null;
}

export type ClusterReason = 'target' | 'case-family' | 'entity' | 'site' | 'manual';

// Priority order. Lower is stronger; this IS the brief's rule order.
const REASON_PRIORITY: Record<Exclude<ClusterReason, 'manual'>, number> = {
  target: 0,
  'case-family': 1,
  entity: 2,
  site: 3,
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
];

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

export function isContainerRecord(r: ClusterRecord): boolean {
  const url = r.url ?? '';
  if (url.includes('#event-')) return true;
  if (url.includes('#item')) return false;
  return CONTAINER_TITLE_RE.test(r.title ?? '');
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
  const text = recordText(r);
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
  return { rule: rule.label, roots: [...found] };
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

// ---- The engine -------------------------------------------------------------

export interface ClusteredProject {
  project_key: string;
  name: string;
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
  // Citywide / city-initiated legislation whose case signals were suppressed.
  citywideRecordsDropped: number;
  omnibusRecordsDropped: number;
  officeAddressesDropped: { key: string; records: number; market: string }[];
  skippedDismissed: number;
  // Why each project is live or dormant (Part F).
  livenessReasons: Record<string, number>;
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

// A cluster with no target term is named from its most descriptive record: the
// EARLIEST one, because the originating filing is the one that states what the
// project is, where later records only reference it. Philip can rename any
// project by hand and the rename is recorded and never overwritten (Part E).
function nameFromRecords(records: ClusterRecord[]): string {
  const sorted = [...records].sort((a, b) => {
    const da = bestDate(a) ?? '';
    const db = bestDate(b) ?? '';
    return da.localeCompare(db);
  });
  for (const r of sorted) {
    const cleaned = cleanTitle(r.title ?? '');
    if (cleaned.length >= 12) return cleaned;
  }
  return cleanTitle(sorted[0]?.title ?? '') || 'Untitled project';
}

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
  const records = input.filter((r) => r.status !== 'dismissed');

  const result: ClusterResult = {
    projects: [],
    unclustered: [],
    reasonCounts: {},
    casePatternsFound: {},
    fuzzyMerges: [],
    containerRecords: 0,
    citywideRecordsDropped: 0,
    omnibusRecordsDropped: 0,
    officeAddressesDropped: [],
    skippedDismissed,
    livenessReasons: {},
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
    const target = bestTargetForClustering(text);
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
    const citywide = roots.length > 0 && isCitywideRecord(r);
    if (citywide) result.citywideRecordsDropped++;
    if (citywide) {
      // no case signals
    } else if (roots.length > MAX_CASE_ROOTS_PER_RECORD) {
      result.omnibusRecordsDropped++;
    } else {
      for (const root of roots) sigs.push({ key: `case:${mk}:${root}`, reason: 'case-family' });
    }

    // 3. Entity (market-scoped).
    const entity = entityOf(r);
    if (entity) sigs.push({ key: `entity:${mk}:${entity}`, reason: 'entity' });

    // 4. Site (market-scoped).
    for (const s of siteKeys(r)) {
      const key = `site:${mk}:${s}`;
      if (s.startsWith('addr:')) addressCounts.set(key, (addressCounts.get(key) ?? 0) + 1);
      sigs.push({ key, reason: 'site' });
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
      const best = signals[i].reduce<Exclude<ClusterReason, 'manual'>>(
        (acc, s) => (REASON_PRIORITY[s.reason] < REASON_PRIORITY[acc] ? s.reason : acc),
        'site'
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
    const strongest = allSignals.reduce(
      (acc, s) => Math.min(acc, REASON_PRIORITY[s.reason]),
      REASON_PRIORITY.site
    );
    const projectKey = allSignals
      .filter((s) => REASON_PRIORITY[s.reason] === strongest)
      .map((s) => s.key)
      .sort()[0];

    result.projects.push({
      project_key: projectKey,
      name: target ? targetProjectName(target, market) : nameFromRecords(recs),
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
      record_count: recs.length,
      live: liveness.live,
      liveness_reason: liveness.reason,
      members,
    });
  }

  result.projects.sort((a, b) => b.record_count - a.record_count);
  return result;
}
