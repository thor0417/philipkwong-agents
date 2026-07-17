// Conservative date extraction from a lead's own text (Brief 1, Part C).
//
// The 2011-RFP problem: a feed row with no source date whose title says "2011"
// must never render as a live opportunity. parseDateFromText scans a lead's title
// + raw_content for obvious date evidence and returns the FRESHEST (most recent)
// parseable date as an ISO string, or null when there is no clear evidence.
// Conservative by design: obvious evidence only (real date strings and in-range
// four-digit years), never invent a date.
//
// Freshest-wins rationale: a document that also references a future year (e.g. a
// "2035 vision plan") is treated as current rather than archived, so live leads
// are not wrongly buried; a row whose only date evidence is "2011" resolves to
// 2011 and is archived downstream. This nails the stale-year class the brief
// targets while minimizing false archiving. ISO strings sort chronologically, so
// "freshest" is just the lexical max of the candidates.

// Accepted year range (brief: 1990-2035). Anything outside is ignored as noise.
const MIN_YEAR = 1990;
const MAX_YEAR = 2035;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (n: number): string => String(n).padStart(2, '0');

// Build a validated ISO date-only string (YYYY-MM-DD) or null. Rejects out-of-range
// years and impossible month/day combinations so garbage never becomes a date.
function isoDate(year: number, month: number, day: number): string | null {
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(d.getTime())) return null;
  // Reject rollovers (e.g. Feb 30 -> Mar 2): the constructed date must match.
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}

const MONTH_ALT = Object.keys(MONTHS).join('|');

// Full ISO dates in the text: 2011-05-03.
const ISO_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
// "March 5, 2011" / "Mar 5 2011" / "September 2011" (day optional -> day 1).
const MDY_RE = new RegExp(`\\b(${MONTH_ALT})[a-z]*\\.?\\s+(?:(\\d{1,2})(?:st|nd|rd|th)?,?\\s+)?(\\d{4})\\b`, 'gi');
// "5 March 2011" / "5th of Mar, 2011".
const DMY_RE = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_ALT})[a-z]*\\.?,?\\s+(\\d{4})\\b`, 'gi');
// Fiscal-year forms, including the glued "FY2012" that a word-boundary year regex
// misses (no boundary between "Y" and "2"). A 2-digit fiscal year maps to 20xx.
const FY_RE = /\bfy\s?['/-]?(\d{4}|\d{2})\b/gi;
// Bare four-digit years, not part of a longer number and not money (skip "$2015"
// and "12011"). Fiscal "FY 2011" (spaced) also matches here; glued "FY2011" is
// covered by FY_RE above.
const YEAR_RE = /(?<![\d$#.,])\b(19\d{2}|20[0-3]\d)\b(?!\d)/g;
// A bare year immediately preceded by an address token ("Suite 2010", "Box 2015")
// is a location, not a date; skip it. Checked against the ~12 chars before the match.
const ADDRESS_BEFORE = /(?:suite|ste|unit|apt|apartment|room|rm|floor|fl|no|number|box|#)\s*[.:#-]?\s*$/i;

// Extract the freshest obvious date from free text as an ISO date-only string, or
// null when there is no clear evidence. Never throws.
export function parseDateFromText(text: string | null | undefined): string | null {
  const candidates = extractDateCandidates(text);
  // Freshest wins; ISO date strings sort chronologically as plain strings.
  return candidates.length ? candidates[candidates.length - 1] : null;
}

// UTC calendar day (YYYY-MM-DD) of a timestamp. Used so "future" is judged on the
// date, not the exact instant.
function utcDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// The MAX future date in the text (a milestone: opening/completion/hearing date),
// or null when no candidate is after today. "Future" is strictly after today's
// UTC day. Shares the same conservative candidate extraction as the age parser, so
// a project's "opening 2028" is caught while its past origination year is ignored.
export function parseMaxFutureDate(
  text: string | null | undefined,
  now: number = Date.now()
): string | null {
  const today = utcDay(now);
  // ISO date-only strings compare lexically as they do chronologically.
  const future = extractDateCandidates(text).filter((iso) => iso > today);
  return future.length ? future[future.length - 1] : null;
}

// All validated ISO date-only (YYYY-MM-DD) candidates found in the text, sorted
// ascending (oldest first). The single source of date evidence for both the
// freshest-wins age parser and the future-milestone parser.
export function extractDateCandidates(text: string | null | undefined): string[] {
  if (!text) return [];
  const hay = text.toLowerCase();
  const candidates: string[] = [];

  for (const m of hay.matchAll(ISO_RE)) {
    const iso = isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
    if (iso) candidates.push(iso);
  }
  for (const m of hay.matchAll(MDY_RE)) {
    const month = MONTHS[m[1].slice(0, 3)];
    const day = m[2] ? Number(m[2]) : 1;
    const iso = isoDate(Number(m[3]), month, day);
    if (iso) candidates.push(iso);
  }
  for (const m of hay.matchAll(DMY_RE)) {
    const month = MONTHS[m[2].slice(0, 3)];
    const iso = isoDate(Number(m[3]), month, Number(m[1]));
    if (iso) candidates.push(iso);
  }
  for (const m of hay.matchAll(FY_RE)) {
    const raw = m[1];
    const year = raw.length === 2 ? 2000 + Number(raw) : Number(raw);
    const iso = isoDate(year, 1, 1);
    if (iso) candidates.push(iso);
  }
  for (const m of hay.matchAll(YEAR_RE)) {
    const before = hay.slice(Math.max(0, (m.index ?? 0) - 12), m.index ?? 0);
    if (ADDRESS_BEFORE.test(before)) continue; // "Suite 2010" is an address, not a date
    const iso = isoDate(Number(m[1]), 1, 1);
    if (iso) candidates.push(iso);
  }

  // Sorted ascending so callers can take the max (freshest) or filter by date.
  candidates.sort();
  return candidates;
}
