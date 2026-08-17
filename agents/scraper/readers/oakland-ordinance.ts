// THE OAKLAND ORDINANCE AND AGENDA-REPORT READER.
//
// OAKLAND'S STRENGTH IS THE DEAL, NOT THE BUILDING, and the measurement is
// unambiguous about it. Over 18 readable documents, median 7 pages and 15,602
// characters - three times a Clark agenda sheet:
//
//   appropriation language        78%      any dollar amount             72%
//   street address                72%      development agreement         61%
//   a zoning district code        61%      purchase or sale price        56%
//   CEQA                          56%      "authorize the City Admin..." 44%
//   square footage                44%      General Plan designation      33%
//   acreage                       28%      effective date                39%
//
//   room counts                    0%      seats                          0%
//   parking spaces                 0%      storeys                        0%
//   labelled party role            0%      staff report heading           0%
//
// So Oakland answers "what was agreed, for how much, and when does it take
// effect" and never answers "how big is the building". A reader that went
// looking for a room count in Oakland would return nothing and would have been
// written on a guess.
//
// THE COLISEUM IS THE CORPUS. 4 of 5 live Oakland projects are the Coliseum
// complex disposition, and the documents are the ordinances that sell it:
// "$105,000,000 purchase price", "The City would receive $50 million for the
// Arena Parcel", "the simultaneous sale of the Arena Parcel for the lump sum
// payment of $50 million". Those are the facts a client wants and none of them
// is in the corpus today.
//
// NO PARTY LAYER, AND THE MEASUREMENT SAYS WHY. Not one Oakland document carries
// a labelled role. 56% name a legal-suffix entity and 39% use "the developer" as
// a bare role word, so the entity is there and the ROLE is not attached to it in
// any form a reader could trust. The one exception is the counterparty of a
// named agreement - "by and between the City and OAC" - which is the agreement's
// own statement of who it binds, and even that is stored as the clause rather
// than as two parties.

import { norm, tidyLine, num, type FilingFact, type FilingFactKind } from './core';

export function isOaklandDocument(text: string): boolean {
  return /\bCITY OF OAKLAND\b|\bC\.M\.S\.\b|\bOAKLAND CITY COUNCIL\b/i.test(text);
}

// A CODE AMENDMENT IS NOT A PROJECT, and reading one as a project is the second
// defect this lane produced before anything printed. Oakland's "2026
// Miscellaneous Planning Code Amendments" is a rewrite of Title 17: it is full
// of square footages, addresses and zone codes, and every one of them is a
// THRESHOLD IN A RULE rather than a fact about a building. Read as a project it
// gave that entry "floor area 800", "floor area 3,000", "floor area 150" and
// "address 1475 14th Avenue" - the ADU size limits and a worked example from the
// code, printed as if they described a development.
//
// The tell is the document's own subject. A planning code amendment says so in
// its heading, and it says so about itself rather than about a site.
const CODE_AMENDMENT =
  /\b(planning code amendments?|zoning (?:code|update) amendments?|amendments? to (?:the )?(?:oakland )?(?:planning|municipal) code|Title 17[^\n]{0,40}amend|general plan update)\b/i;

export function isCodeAmendment(text: string): boolean {
  // Only the front of the document. A project ordinance may CITE the code far
  // down the page without being an amendment to it.
  return CODE_AMENDMENT.test(text.slice(0, 2500));
}

interface Field {
  kind: FilingFactKind;
  label: string;
  re: RegExp;
  numeric?: boolean;
  /** Reject a match that is real text but not the fact. */
  reject?: (m: RegExpExecArray) => boolean;
}

const FIELDS: Field[] = [
  // ---- the deal, which is what Oakland is for -----------------------------
  {
    kind: 'purchase_price', label: 'purchase price',
    // "One Hundred Five Million Dollar ($105,000,000) purchase price" and
    // "$50 million for the Arena Parcel" are both real and phrased differently.
    re: /(\$[\d,]{6,15}(?:\.\d{2})?|\$[\d.]{1,6}\s+million)\s*(?:\)\s*)?(?=[^\n]{0,40}\b(?:purchase price|sale price|lump sum|would receive|payment)\b)|\b(?:purchase price|sale price|lump sum payment)\b[^\n]{0,40}?(\$[\d,]{6,15}|\$[\d.]{1,6}\s+million)/i,
  },
  {
    kind: 'agreement', label: 'named agreement',
    re: /\b((?:Disposition and (?:Sale|Development)|Purchase and Sale|Exclusive Negotiating|Development|Lease Disposition|Community Benefits)\s+Agreement)\b/i,
  },
  {
    kind: 'counterparty', label: 'by and between',
    // The agreement's own statement of who it binds. Stored as the clause: who
    // is buyer and who is seller is not stated in a form a reader can trust.
    re: /\bby and between\s+([^\n.]{8,150}?)(?=,\s*(?:as amended|dated)|\.)/i,
  },
  {
    kind: 'money_other', label: 'bond or fund amount',
    re: /\b(?:not to exceed|Measure\s+[A-Z]{1,2}\s+bond funds?(?:\s+of)?)\s*[^\n]{0,30}?(\$[\d,]{6,15}|\$[\d.]{1,6}\s+million)/i,
  },
  // ---- where ---------------------------------------------------------------
  {
    kind: 'site_address', label: 'located at',
    re: /\bproperty located at\s+(\d{2,6}\s+[^\n,(]{4,60}?)(?=\s*(?:,|\(|located in|in the City))/i,
  },
  {
    kind: 'apn', label: 'Assessor Parcel Number',
    re: /\bAssessor'?s?\s+Parcel\s+Number\s*[:#]?\s*([\d-]{7,20})|\bAPN\s*[:#]\s*([\d-]{7,20})/i,
  },
  {
    kind: 'zone', label: 'zoning district',
    re: /\b((?:C|R|M|S|D)-[A-Z]{0,3}-?\d{1,2}(?:\s+[A-Z][a-z]+){0,3}\s+(?:Zone|Zoning District|Combining Zone))\b/,
  },
  {
    kind: 'site_acreage', label: 'acres',
    re: /\b(?:approximately\s+)?([\d.,]{1,7})[\s-]acres?\b/i, numeric: true,
  },
  {
    kind: 'floor_area', label: 'square feet',
    re: /\b([\d,]{3,12})\s*(?:gross\s+)?square\s+feet\b/i,
  },
  // ---- when ----------------------------------------------------------------
  {
    kind: 'effective_date', label: 'effective date',
    re: /\bEffective Date\.?\s*(This ordinance shall become effective[^\n.]{0,90}\.)/i,
  },
  {
    kind: 'nyc_completed', label: 'closing by',
    re: /\b(?:would|shall|will)\s+close\s+(?:as soon as|no later than|by)\s+([A-Z][a-z]+\s+\d{4}|[A-Z][a-z]+\s+\d{1,2},\s+\d{4})/i,
  },
  // ---- what must happen -----------------------------------------------------
  {
    kind: 'staff_recommendation', label: 'Staff Recommends',
    re: /\bStaff Recommends? That The (?:City Council|Council)\s*([^\n]{10,240}?)(?=\s*(?:EXECUTIVE SUMMARY|BACKGROUND|$))/i,
  },
  {
    kind: 'the_vote', label: 'vote',
    re: /\bPASSED BY THE FOLLOWING VOTE:\s*([^\n]{5,200}?)(?=\s*(?:ATTEST|$))/i,
  },
  {
    kind: 'environmental', label: 'CEQA',
    re: /\b(certified the Environmental Impact Report[^\n.]{0,90}|Categorically Exempt[^\n.]{0,70}|exempt from CEQA[^\n.]{0,70})/i,
  },
];

export function readOaklandFacts(rawText: string): FilingFact[] {
  const text = norm(rawText);
  if (!isOaklandDocument(text)) return [];
  // See isCodeAmendment. Every number in a code amendment is a rule, not a site.
  if (isCodeAmendment(text)) return [];
  const out: FilingFact[] = [];
  for (const f of FIELDS) {
    const m = f.re.exec(text);
    if (!m) continue;
    if (f.reject?.(m)) continue;
    // The first non-empty capture, or the whole match where the pattern has no
    // group worth isolating.
    const captured = m.slice(1).find((g) => g !== undefined && g !== '');
    const display = tidyLine(captured ?? m[0]);
    if (!display || display.length < 2) continue;
    out.push({
      kind: f.kind,
      label: f.label,
      display,
      value: f.numeric ? num(display) : null,
      line: tidyLine(m[0]),
    });
  }
  return out;
}
