// LATAM_CARIB region group. Mexico and the Caribbean are the origination
// territory for the development-project push (Grant Leisure International,
// Panorama Worldwide). Any lead whose project country is in this group is
// region-tagged 'LATAM_CARIB' so the dashboard can filter to it across lanes.
//
// Region is derived per lead, not per source: the development banks and TED are
// multi-country, so a World Bank RFP in Mexico must tag LATAM_CARIB while one in
// Kenya keeps its source region. Country is taken from an explicit ISO code when
// the source sets one (IADB, signal sources), else inferred from the free-text
// location for the country-scoped international sources below.

import type { NormalizedLead } from './sources/types';

export const LATAM_CARIB = 'LATAM_CARIB';

// ISO-3166 alpha-2 codes in scope this phase.
export const LATAM_CARIB_CODES = new Set([
  'MX', 'JM', 'BS', 'BB', 'TT', 'DO', 'LC', 'AG', 'GD', 'KN', 'VC', 'DM',
  'BZ', 'GY', 'SR', 'HT', 'CU', 'PR', 'KY', 'TC', 'VG', 'AW', 'CW',
]);

// Country NAME -> ISO code. World Bank / IADB / CDB expose a country name (often
// upper-cased, sometimes with "St." or unaccented spellings), so grouping must
// match on name. Keys are normalized (lower-cased, accents stripped). Ordered by
// length at match time so "dominican republic" wins over "dominica".
const NAME_TO_CODE: Record<string, string> = {
  mexico: 'MX',
  jamaica: 'JM',
  bahamas: 'BS',
  'the bahamas': 'BS',
  barbados: 'BB',
  'trinidad and tobago': 'TT',
  'trinidad & tobago': 'TT',
  trinidad: 'TT',
  'dominican republic': 'DO',
  'saint lucia': 'LC',
  'st lucia': 'LC',
  'st. lucia': 'LC',
  'antigua and barbuda': 'AG',
  'antigua & barbuda': 'AG',
  antigua: 'AG',
  grenada: 'GD',
  'saint kitts and nevis': 'KN',
  'st kitts and nevis': 'KN',
  'st. kitts and nevis': 'KN',
  'st kitts': 'KN',
  'saint vincent and the grenadines': 'VC',
  'st vincent and the grenadines': 'VC',
  'st. vincent and the grenadines': 'VC',
  'st vincent': 'VC',
  dominica: 'DM',
  belize: 'BZ',
  guyana: 'GY',
  suriname: 'SR',
  haiti: 'HT',
  cuba: 'CU',
  'puerto rico': 'PR',
  'cayman islands': 'KY',
  cayman: 'KY',
  'turks and caicos': 'TC',
  'turks and caicos islands': 'TC',
  'british virgin islands': 'VG',
  'virgin islands (british)': 'VG',
  aruba: 'AW',
  curacao: 'CW',
};

// Match longest name first so substrings ("dominica" in "dominican republic")
// do not steal the match.
const NAME_KEYS = Object.keys(NAME_TO_CODE).sort((a, b) => b.length - a.length);

// International, country-scoped sources whose free-text location IS a country
// name we can map. City/province-level sources (adzuna BC, samgov "Jamaica, NY")
// are excluded to avoid false LATAM_CARIB tags.
const NAME_DERIVED_SOURCES = new Set([
  'worldbank',
  'iadb',
  'cdb',
  'ungm',
  'adb',
  'afdb',
  'undp',
  'tedeu',
]);

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritical marks
    .toLowerCase()
    .trim();
}

// Map a free-text location to an ISO code, or null. Tries an exact match on the
// whole string first, then a longest-name substring match.
function codeForLocationName(location: string | null | undefined): string | null {
  if (!location) return null;
  const n = normalize(location);
  if (NAME_TO_CODE[n]) return NAME_TO_CODE[n];
  for (const key of NAME_KEYS) {
    // Whole-word boundary so "guyana" does not match inside "french guiana", etc.
    const re = new RegExp(`(^|[^a-z])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`);
    if (re.test(n)) return NAME_TO_CODE[key];
  }
  return null;
}

// The lead's ISO country code: explicit `country` first, then name inference for
// the country-scoped international sources.
export function countryCodeOf(lead: NormalizedLead): string | null {
  if (lead.country) return lead.country.toUpperCase();
  if (NAME_DERIVED_SOURCES.has(lead.source)) return codeForLocationName(lead.location);
  return null;
}

export function isLatamCarib(lead: NormalizedLead): boolean {
  const code = countryCodeOf(lead);
  return !!code && LATAM_CARIB_CODES.has(code);
}

// Region for a lead: 'LATAM_CARIB' when its project country is in the group,
// else the source's default region.
export function regionFor(lead: NormalizedLead, sourceRegion: string): string {
  return isLatamCarib(lead) ? LATAM_CARIB : sourceRegion;
}

// Per-source default region for tender leads (before the per-lead country
// override in regionFor). Shared by the orchestrator and the standalone
// opportunity lane so both resolve regions identically.
export const SOURCE_REGION: Record<string, string> = {
  tenderned: 'NL',
  tedeu: 'EU',
  iadb: 'GLOBAL',
  cdb: 'GLOBAL',
  gebiz: 'SG',
  ungm: 'GLOBAL',
  worldbank: 'GLOBAL',
  adb: 'GLOBAL',
  afdb: 'GLOBAL',
  undp: 'GLOBAL',
  canadabuys: 'CA',
  adzuna: 'CA',
  jooble: 'CA',
  reed: 'UK',
  careerjet: 'CA',
  arbeitnow: 'EU',
  jsearch: 'CA',
  samgov: 'US',
  texasesbd: 'US',
  austender: 'AU',
  uktenders: 'UK',
  thailandgpp: 'TH',
  googleplaces: 'GLOBAL',
};

// The source's default region, or 'GLOBAL' when unmapped.
export const regionOf = (source: string): string => SOURCE_REGION[source] ?? 'GLOBAL';

// Priority Mexican states, flagged in the run report. Detected from the lead
// text (signal sources carry the state in the location; bank notices name it in
// the description). Canonical names, matched accent- and case-insensitively.
export const MX_PRIORITY_STATES = [
  'Quintana Roo',
  'Baja California Sur',
  'Nayarit',
  'Jalisco',
  'Oaxaca',
  'Yucatan',
];

const MX_STATE_KEYS = MX_PRIORITY_STATES.map((s) => ({ canonical: s, norm: normalize(s) }));

// The priority Mexican state named in the text, or null. "Yucatan" also matches
// the accented "Yucatán" because both are normalized.
export function mexicanPriorityState(text: string | null | undefined): string | null {
  if (!text) return null;
  const n = normalize(text);
  for (const { canonical, norm } of MX_STATE_KEYS) {
    if (n.includes(norm)) return canonical;
  }
  return null;
}
