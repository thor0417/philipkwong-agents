// HAND-SUPPLIED IDENTIFIERS, AND THE ONE PLACE THAT DECIDES WHAT ONE IS.
//
// Four routes into a project's own documents are opened by an identifier a
// person can find in ninety seconds and a scraper cannot derive. Philip supplied
// a ULURP number by hand once and nothing recorded it, so it had to be found
// again. This is where the answer lives.
//
// WHY A VOCABULARY FILE RATHER THAN A LOOSE OBJECT. Three layers touch this: a
// person writes it, a reader routes on it, and a document may cite it. A set of
// strings that three layers must agree on is a vocabulary, and a vocabulary
// invented at each call site drifts within a month - which is the argument
// lib/taxonomy makes for itself and applies here unchanged.
//
// IT IMPORTS NOTHING. Same rule as lib/dead-feeds and lib/corpus-scope: an
// import-free file can be read across the package split, so the dashboard's
// detail pane and the agent runtime read ONE definition rather than a mirrored
// copy that goes stale. See experimental.externalDir in dashboard/next.config.js.

/** The keys a hand-supplied identifier may use. Closed on purpose. */
export const IDENTIFIER_KEYS = ['sch', 'apn', 'sunbiz', 'ulurp'] as const;
export type IdentifierKey = (typeof IDENTIFIER_KEYS)[number];

export interface IdentifierSpec {
  key: IdentifierKey;
  /** What a person calls it, for a form label and a document line. */
  label: string;
  /** The authority that issues it. Never our name for it where it has one. */
  issuer: string;
  /** What it opens, in one line, so entering one has a visible point. */
  opens: string;
  /**
   * The shape the issuer actually uses. A value that fails this is REFUSED
   * rather than stored: a mistyped identifier routes to somebody else's
   * document, which is worse than an absent one.
   */
  shape: RegExp;
  /** A real example from the corpus, so the form field can show one. */
  example: string;
}

export const IDENTIFIERS: readonly IdentifierSpec[] = [
  {
    key: 'sch',
    label: 'CEQAnet SCH number',
    issuer: 'California State Clearinghouse',
    opens:
      'a 55-field CSV at ceqanet.lci.ca.gov carrying parcel number, total acres, ' +
      'cross streets and the approval decision and date',
    // YYYYMM then four digits, anchored on year and month so a parcel number or
    // a phone number cannot pass.
    shape: /^(?:19|20)\d{2}(?:0[1-9]|1[0-2])\d{4}$/,
    example: '2023100503',
  },
  {
    key: 'apn',
    label: "Assessor's parcel number",
    issuer: 'the county assessor',
    opens: 'the assessor record: who owns the parcel and what it last sold for',
    // Deliberately loose on separators and group lengths: every county formats
    // its own, and Clark, Orange and Maricopa disagree. Digits and hyphens only,
    // at least two groups, so a street address cannot pass.
    shape: /^\d{2,4}(?:-\d{2,4}){1,4}$/,
    example: '234-161-04',
  },
  {
    key: 'sunbiz',
    label: 'Sunbiz document number',
    issuer: 'the Florida Division of Corporations',
    opens: "the entity's registered agent and its authorized persons",
    // A letter then eleven digits (L19000282957), or the older six-digit form.
    shape: /^(?:[A-Z]\d{11}|\d{6})$/,
    example: 'L19000282957',
  },
  {
    key: 'ulurp',
    label: 'ULURP application number',
    issuer: 'the New York City Department of City Planning',
    opens: 'the City Planning Commission report, where one has been voted on',
    shape: /^\d{6}[A-Z]{2,4}$/,
    example: '250108MMK',
  },
];

const BY_KEY = new Map(IDENTIFIERS.map((s) => [s.key, s]));

export function identifierSpec(key: string): IdentifierSpec | null {
  return BY_KEY.get(key as IdentifierKey) ?? null;
}

/** The stored shape. Absent keys are absent, never empty strings. */
export type ManualIdentifiers = Partial<Record<IdentifierKey, string>>;

/**
 * Read what is stored, refusing anything that is not a known key carrying a
 * value of the issuer's own shape.
 *
 * FAILS CLOSED, AND ON EVERY VALUE INDEPENDENTLY. A row carrying one good SCH
 * and one malformed APN yields the SCH. Discarding the whole map because one
 * value is wrong would lose curation to protect against a typo, which is the
 * wrong trade for a column only a person writes.
 */
export function readManualIdentifiers(raw: unknown): ManualIdentifiers {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: ManualIdentifiers = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const spec = BY_KEY.get(k as IdentifierKey);
    if (!spec) continue;
    if (typeof v !== 'string') continue;
    const s = v.trim().toUpperCase();
    if (!s || !spec.shape.test(s)) continue;
    out[spec.key] = s;
  }
  return out;
}

/**
 * Whether a value is storable under a key, for the form that accepts it.
 * Returns the normalised value or null, never a boolean, because the caller
 * needs the normalised form and asking twice is how the two drift.
 */
export function normalizeIdentifier(key: string, value: string): string | null {
  const spec = BY_KEY.get(key as IdentifierKey);
  if (!spec) return null;
  const s = String(value ?? '').trim().toUpperCase();
  return s && spec.shape.test(s) ? s : null;
}

/** The URL a stored identifier opens, or null where the route needs a fetch. */
export function identifierUrl(key: IdentifierKey, value: string): string | null {
  switch (key) {
    case 'sch':
      return `https://ceqanet.lci.ca.gov/Search?Sch=${encodeURIComponent(value)}&OutputFormat=CSV`;
    case 'ulurp':
      // The report is published under the six-digit stem, not the full number.
      return `https://www.nyc.gov/assets/planning/download/pdf/about/cpc/${value.slice(0, 6)}.pdf`;
    case 'sunbiz':
      return `https://search.sunbiz.org/Inquiry/CorporationSearch/SearchResultDetail?inquirytype=DocumentNumber&directionType=Initial&searchNameOrder=${encodeURIComponent(value)}`;
    case 'apn':
      // NO URL. An APN is scoped to a county and every assessor has its own
      // route; inventing one here would build a link to the wrong county's
      // parcel. The value is stored and the route is the reader's problem.
      return null;
  }
}
