// COMPANIES AS ENTITIES, not strings.
//
// applicant, representative and presented_by are free text on the lead row, so
// three questions a partner brief is built from cannot be asked at all:
//
//   every project this developer has filed
//   what else this architect designed
//   which entitlements this attorney has carried
//
// "KULIK RIVER CAPITAL, LLC" and "Kulik River Capital LLC" are one company and
// two strings, so even COUNTING is wrong before the question is asked.
//
// ONE NORMALISER, NOT TWO. Everything here reuses the clusterer's own
// functions - normalizeEntity, isGenericEntity, entitiesMatchFuzzily - rather
// than reimplementing them. A second normaliser would drift from the first, and
// then the company register and the project register would disagree about who a
// party is, which is worse than not having the company register.
//
// ---- WHERE A PARTY COMES FROM, and where it does not ------------------------
//
//   applicant       258 records  -> role 'applicant'
//   presented_by     63 records  -> role 'presenter'
//   representative   59 records  -> role 'representative'
//   "OWNER:" in text 50 records  -> role 'owner'
//
// THERE IS NO owner COLUMN. The brief names one, and the schema has never had
// it. Rather than skip the role, it is parsed from the record text, where Las
// Vegas and Clark County write it explicitly ("APPLICANT: LIVCO - OWNER: CITY OF
// LAS VEGAS"). That is a real, published field in the source document even
// though it is not a column here.
//
// `company` IS DELIBERATELY NOT USED, despite being populated on 807 records,
// because it is not a party. On government records it holds the JURISDICTION
// ("Anaheim, CA", "Las Vegas, NV", "Metropolitan Council") and on intelligence
// records it holds the PROJECT or venue ("Six Flags Bahrain", "Disney Abu Dhabi
// Theme Park Resort", "Mattel Wonder Indoor Waterparks"). Harvesting it would
// fill the company register with cities and theme parks.
//
// 'architect' and 'agent' are in the role vocabulary and are NOT populated by
// this extractor: no field or published pattern distinguishes an architect from
// any other representative in this corpus. They are reserved for a source that
// states them, and left empty rather than guessed at.

import {
  normalizeEntity,
  isGenericEntity,
  entitiesMatchFuzzily,
  entitySimilarity,
} from './cluster';
import type { CompanyRole } from '../../lib/taxonomy';

export interface PartyMention {
  role: CompanyRole;
  // As the source spells it, for display.
  name: string;
  // The identity, via the clusterer's normaliser.
  normalized: string;
}

export interface PartySource {
  applicant?: string | null;
  representative?: string | null;
  presented_by?: string | null;
  title?: string | null;
  raw_content?: string | null;
}

// "OWNER: THE HOWARD HUGHES COMPANY, LLC - For possible action..."
//
// Stops at a dash or a newline because that is how these lines are punctuated,
// and bounded at 80 characters so a missing delimiter cannot swallow a
// paragraph into a company name.
const OWNER_RE = /\bOWNER\s*:\s*([^\n\-–—]{3,80})/gi;

// Trim the trailing clause an agenda line runs into, AND the street address a
// Clark County staff report prints inside the representative field.
//
// The address is not cosmetic, it is an identity bug. "KAEMPFER CROWELL,
// JENNIFER LAZOVICH, 1980 FESTIVAL PLAZA DRIVE #650" normalises to a key
// containing the address, so the same firm filing from a different suite number
// would become a SECOND company. Cutting at the first comma followed by a house
// number removes it before normalisation, which is the only point at which it
// still matters.
function tidy(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/\b(for possible action|et al\.?)\b.*$/i, '')
    .replace(/,\s*\d{2,6}\s+[A-Za-z].*$/, '')
    .trim()
    .replace(/[,;:.]+$/, '')
    .trim();
}

// A STRICTER BAR THAN CLUSTERING'S, deliberately, and layered on top rather than
// changed inside it.
//
// isGenericEntity anchors "department of" to the START of the name, because it
// must not kill "City Parkway V" - the Las Vegas redevelopment corporation that
// ties the Museum of Art records together. That anchoring is correct for
// clustering and measured, so it is not touched here.
//
// It also lets "Florida Department of Transportation" through, which the first
// live run put in the top ten most active companies. A state DOT is exactly the
// department the brief says never to create a company from.
//
// The asymmetry is justified: a clustering false positive merges two records and
// is visible in the register; a company false positive puts a government agency
// in a partner brief as though it were a developer. So a company must clear the
// clusterer's bar AND these.
const GENERIC_PARTY_PATTERNS: RegExp[] = [
  // The institutional forms, matched ANYWHERE rather than only at the start.
  /\b(department|ministry|bureau|agency|authority|commission|administration) of\b/,
  // Governing bodies. The clusterer catches "board of commissioners" only; a
  // CFTOD "Board of Supervisors" presenter reached the top-ten list on the first
  // live run, which is how this one was found.
  /\bboard of (supervisors|directors|commissioners|trustees|education|governors)\b/,
  /\b(oversight|improvement|assessment|special) district\b/,
  /\b(department of transportation|dot|fdot|ndot|caltrans|usace|army corps)\b/,
  /\b(school|water|fire|sewer|irrigation|conservation|transit|library|park) district\b/,
  /\b(state|federal|county|municipal|regional) (of|government|agency|authority)\b/,
  // "<something> Authority" is a public body in US local government almost
  // without exception. Southern Nevada Water Authority and the Las Vegas
  // Convention and Visitors Authority both slipped past the line above, which
  // required a jurisdiction word IMMEDIATELY before 'authority'.
  /\b(water|power|energy|utility|utilities|transit|transportation|housing|port|airport|redevelopment|convention|visitors|tourism|sports|flood|drainage) (and \w+ )?authority\b/,
  /\bunited states\b|\bu\.?s\.? (department|government|army|navy)\b/,
  // A bare public-body noun with no distinguishing name in front of it.
  /^(town advisory board|advisory board|planning commission|city clerk)$/,
  // Tourism and civic promotion bodies. Caught separately because
  // normalizeEntity splits on " and " and keeps the FIRST party, so "Las Vegas
  // Convention and Visitors Authority" normalises to "las vegas convention" -
  // with the word 'authority' already gone before any pattern above can see it.
  /\b(convention|visitors bureau|chamber of commerce|tourism board)\b/,
];

export function isGenericParty(normalized: string): boolean {
  if (isGenericEntity(normalized)) return true;
  return GENERIC_PARTY_PATTERNS.some((p) => p.test(normalized));
}

// A single field can name several parties ("Anaheim Real Estate Partners, LLC,
// TS Anaheim, LLC, and FCD, LLC"). normalizeEntity takes the FIRST named party,
// and this deliberately does the same rather than splitting.
//
// Splitting looks easy and is not: " and " sits inside "Brown, Brown &
// Premsrirut" as punctuation, and a comma separates a company from its own legal
// suffix as often as it separates two companies. A wrong split invents a company
// that does not exist, which is worse than recording one of two real ones. The
// backfill reports how many records carried a co-applicant list so the size of
// what is skipped is visible rather than silent.
export function hasCoParties(value: string | null | undefined): boolean {
  if (!value) return false;
  return /,\s*(?:llc|l\.l\.c|inc|lp|llp|ltd|corp)\b.*\b(?:and|&)\b/i.test(value) || /;\s*\S/.test(value);
}

function mention(role: CompanyRole, raw: string | null | undefined): PartyMention | null {
  if (!raw) return null;
  const name = tidy(String(raw));
  if (!name) return null;
  const normalized = normalizeEntity(name);
  // THE STOPLIST, reused from clustering rather than restated. It refuses a
  // city, a county, a department, a school or water district, a housing or
  // redevelopment authority, a utility board, and any bare institutional word -
  // and it refuses them on the WHOLE name, so "City Parkway V" (the Las Vegas
  // redevelopment corporation) survives a rule that kills "City of Las Vegas".
  if (!normalized || isGenericParty(normalized)) return null;
  return { role, name, normalized };
}

export function extractParties(r: PartySource): PartyMention[] {
  const out: PartyMention[] = [];
  const push = (m: PartyMention | null): void => {
    if (m && !out.some((o) => o.role === m.role && o.normalized === m.normalized)) out.push(m);
  };
  push(mention('applicant', r.applicant));
  push(mention('representative', r.representative));
  push(mention('presenter', r.presented_by));

  const text = `${r.title ?? ''}\n${r.raw_content ?? ''}`;
  const re = new RegExp(OWNER_RE.source, OWNER_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) push(mention('owner', m[1]));
  return out;
}

// ---- Fuzzy consolidation ----------------------------------------------------

export interface FuzzyMerge {
  kept: string;
  merged: string;
  similarity: number;
}

// Fold near-identical names onto one identity, using the clusterer's matcher and
// therefore its guards: both names at least 10 characters, an identical first
// token, and 0.90 normalised similarity. Those guards are why this is safe to
// run GLOBALLY rather than per market - a company is the same company in every
// market, whereas a project is not.
//
// Normalisation alone already collapses the real cases ("KULIK RIVER CAPITAL,
// LLC" and "Kulik River Capital LLC" are identical after normalizeEntity), so
// this pass exists for OCR drift and singular/plural slips. Every merge it makes
// is returned so it can be judged rather than trusted.
export function consolidate(names: string[]): {
  canonical: Map<string, string>;
  merges: FuzzyMerge[];
} {
  const unique = [...new Set(names)].sort();
  const canonical = new Map<string, string>(unique.map((n) => [n, n]));
  const merges: FuzzyMerge[] = [];
  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      const a = canonical.get(unique[i]) as string;
      const b = canonical.get(unique[j]) as string;
      if (a === b) continue;
      if (!entitiesMatchFuzzily(a, b)) continue;
      // The shorter name wins, because the longer one usually carries a suffix
      // or a fragment the shorter one already dropped.
      const [keep, drop] = a.length <= b.length ? [a, b] : [b, a];
      for (const [k, v] of canonical) if (v === drop) canonical.set(k, keep);
      merges.push({ kept: keep, merged: drop, similarity: Number(entitySimilarity(a, b).toFixed(3)) });
    }
  }
  return { canonical, merges };
}

// The stoplist, for the report. Stated rather than described, so what is refused
// is inspectable.
export const GENERIC_PARTY_EXAMPLES = [
  'City of Las Vegas                    (clusterer stoplist)',
  'County of Clark                      (clusterer stoplist)',
  'Board of County Commissioners        (clusterer stoplist)',
  'Anaheim Housing Authority            (clusterer stoplist)',
  'Florida Department of Transportation (company stoplist: "department of"',
  '                                      matched anywhere, not only at the start)',
  'Clark County School District         (company stoplist)',
  'Southern Nevada Water Authority      (company stoplist)',
];
