// THE FILING-FACT MODEL. One shape, one guard, one dedupe - and no reader.
//
// A READER PER FORM, because there is a form per publisher and no two are alike.
// Measured over 155 readable documents and 151 stored New York records: Clark
// publishes a labelled agenda sheet, New York a structured header plus a
// paragraph, Oakland an ordinance, Anaheim a meeting agenda. A single "government
// document reader" would be written against none of them.
//
// So this file owns what every reader must agree on:
//   FilingFact          the shape, including the LABEL the document used
//   verifyFilingFacts   the no-invention guard, run before any write
//   filingFactsForEntry one fact rather than several readings of it
//
// and readers/ owns the forms. A reader that does not go through the guard is
// the defect this split exists to make visible.

export type FilingFactKind =
  // decision and calendar, ranked first
  | 'staff_recommendation' | 'next_hearing' | 'commission_action' | 'board_action'
  | 'held_to' | 'tab_cac' | 'protests'
  // what must happen
  | 'condition'
  // where
  | 'apn' | 'site_address' | 'cross_streets' | 'town' | 'land_use_plan' | 'zone'
  // what
  | 'site_acreage' | 'project_type' | 'units' | 'density' | 'stories'
  | 'height_feet' | 'floor_area' | 'open_space' | 'parking'
  | 'rooms' | 'seats' | 'lots' | 'existing_land_use' | 'unit_size' | 'sustainability'
  // NEW YORK. Its own kinds rather than borrowed ones, because a ULURP number
  // is not a case reference and a CEQR milestone list is not a hearing date.
  // Where New York means the same thing as Clark it uses the SAME kind
  // (site_address, next_hearing, floor_area, units, rooms, seats, stories,
  // parking, site_acreage) so an entry can print one block, not two.
  | 'nyc_approved' | 'nyc_certified' | 'nyc_filed' | 'nyc_completed'
  | 'nyc_milestone' | 'nyc_milestone_date' | 'nyc_milestones' | 'nyc_status'
  | 'nyc_environmental_milestone' | 'nyc_notice_type' | 'nyc_published'
  | 'nyc_review_type' | 'nyc_ulurp' | 'nyc_ceqr_number' | 'nyc_ceqr_type'
  | 'nyc_actions' | 'nyc_agency' | 'nyc_borough' | 'nyc_community_district'
  | 'nyc_council_district' | 'nyc_block_lot' | 'nyc_financing'
  | 'nyc_affordable' | 'nyc_co_applicants';

export interface FilingFact {
  kind: FilingFactKind;
  /** What the DOCUMENT called it. Never our word for it where it has its own. */
  label: string;
  /** Verbatim, exactly as the document printed it. Always a substring of the text. */
  display: string;
  /** Normalised where that is meaningful. Null where it is not. */
  value: number | null;
  /** The line it was printed on, so a reader can check it without opening the PDF. */
  line: string;
  /** For a condition: the department heading it sits under. Null elsewhere. */
  group?: string | null;
}

// ---- text helpers -----------------------------------------------------------
// PDF extraction pads words with spaces and breaks lines mid-phrase. Collapsing
// runs of spaces is safe; collapsing NEWLINES is not, because the form's meaning
// is carried by its line structure.
export function norm(text: string): string {
  return text.replace(/[ \t ]+/g, ' ');
}

export function tidyLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function num(raw: string): number | null {
  const n = Number(raw.replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// ---- THE GUARD ---------------------------------------------------------------
//
// Called before anything is stored. Same contract as press-facts'
// verifyNoInvention and for the same reason: a value that is not in the document
// is a false statement about a real building carrying a link to a county page,
// and the correct response is to store nothing rather than something plausible.
//
// BOTH HALVES ARE CHECKED. The display must appear in the source text, and it
// must appear in the LINE printed beside it - the second is what press-facts
// learned the hard way, where a sentence cap taken from the front produced
// figures quoted from text that did not contain them.
// WHAT "VERBATIM" CAN MEAN IN A PDF, and the limit is worth stating rather than
// quietly assuming. Clark's agenda sheet wraps mid-clause at about 90
// characters, so a condition arrives as
//
//   "Applicant  is  advised  within  2  years  from  the  approval  date  the\n
//    application must commence or the application will expire unless extended"
//
// A display that kept those breaks would be unreadable in a document and a
// display that removes them is not a raw substring. So the guard compares on
// WHITESPACE-COLLAPSED text: every character except whitespace must match, in
// order. That still refuses a fabricated number, a reformatted one ("752 rooms"
// from a document that said "752-room"), and a value assembled from two places
// in the page. It does not refuse a line break the county's own layout put
// there, which is not a defect and cannot be avoided.
const flat = (s: string): string => s.replace(/\s+/g, ' ').trim();

export function verifyFilingFacts(facts: FilingFact[], rawText: string): FilingFact[] {
  const text = flat(norm(rawText));
  const missing = facts.filter((f) => !text.includes(flat(f.display)));
  if (missing.length) {
    throw new Error(
      `filing-facts read ${missing.length} value(s) not present in the document: ` +
        missing.map((f) => `${f.kind}="${f.display.slice(0, 60)}"`).join(', ')
    );
  }
  const unquoted = facts.filter((f) => !flat(f.line).includes(flat(f.display)));
  if (unquoted.length) {
    throw new Error(
      `filing-facts stored ${unquoted.length} value(s) whose own line does not contain them: ` +
        unquoted.map((f) => `${f.kind}="${f.display.slice(0, 60)}"`).join(', ')
    );
  }
  return facts;
}

// ---- ONE FACT, NOT THREE READINGS OF IT -------------------------------------
//
// A project holds several filings and each carries its own copy of the same
// agenda sheet furniture, wrapped differently by whatever the PDF layout did
// that day. Heart Hotel's five sheets produced the board action three times:
//
//   "June 17, 2026 - HELD - To 07/22/26 - per the"
//   "June 17, 2026 -"
//   "June 17,"
//
// All three are correct reads of the same line and two of them are useless. The
// rule is PREFIX CONTAINMENT and nothing looser: where one display is a prefix
// of another, the longer one is the same fact read more completely and the
// shorter goes. Where they merely differ, BOTH STAY - "Commercial subdivision"
// and "Resort Hotel & Recreational Facility" are two project types because they
// are two filings on one site, and collapsing them to whichever is longer would
// delete a fact rather than a duplicate.
export function filingFactsForEntry(facts: FilingFact[]): FilingFact[] {
  const kept: FilingFact[] = [];
  for (const f of facts) {
    if (f.kind === 'condition') {
      // Conditions dedupe on their own text, exactly.
      if (!kept.some((k) => k.kind === 'condition' && k.display === f.display)) kept.push(f);
      continue;
    }
    const a = flat(f.display);
    // SAME NORMALISED VALUE IS THE SAME FACT, whatever the punctuation. New York
    // writes one stadium as "25,000-seat" in the brief and "25,000 seat" in the
    // environmental description, and neither is a prefix of the other, so
    // containment alone printed the capacity twice. Where both carry a value the
    // value decides, and the longer display wins because it is the more complete
    // rendering of the same number.
    if (f.value !== null) {
      const sameValue = kept.findIndex((k) => k.kind === f.kind && k.value === f.value);
      if (sameValue > -1) {
        if (a.length > flat(kept[sameValue].display).length) kept[sameValue] = f;
        continue;
      }
    }
    const superseded = kept.findIndex((k) => k.kind === f.kind && a.startsWith(flat(k.display)));
    if (superseded > -1) {
      kept[superseded] = f;
      continue;
    }
    if (kept.some((k) => k.kind === f.kind && flat(k.display).startsWith(a))) continue;
    kept.push(f);
  }
  return kept;
}

// ---- PRESENTATION ------------------------------------------------------------
// [RECORD] because that is what it is: a figure a county filing states, not a
// figure a publication reported. The distinction is the whole provenance model.
export function filingFactLabel(kind: FilingFactKind): string {
  return {
    staff_recommendation: 'staff recommendation',
    next_hearing: 'next hearing',
    commission_action: 'commission action',
    board_action: 'board action',
    held_to: 'held to',
    tab_cac: 'town board',
    protests: 'approvals and protests',
    condition: 'condition of approval',
    apn: 'parcel',
    site_address: 'address',
    cross_streets: 'location',
    town: 'town',
    land_use_plan: 'land use plan',
    zone: 'zone',
    site_acreage: 'site',
    project_type: 'project type',
    units: 'residential units',
    density: 'density',
    stories: 'storeys',
    height_feet: 'height',
    floor_area: 'floor area',
    open_space: 'open space',
    parking: 'parking',
    rooms: 'rooms',
    seats: 'seats',
    lots: 'lots',
    existing_land_use: 'existing land use',
    unit_size: 'unit size',
    sustainability: 'sustainability',
    nyc_approved: 'approved',
    nyc_certified: 'certified / referred',
    nyc_filed: 'application filed',
    nyc_completed: 'completed',
    nyc_milestone: 'milestone',
    nyc_milestone_date: 'milestone date',
    nyc_milestones: 'milestones',
    nyc_status: 'status',
    nyc_environmental_milestone: 'latest environmental milestone',
    nyc_notice_type: 'notice type',
    nyc_published: 'published',
    nyc_review_type: 'review type',
    nyc_ulurp: 'ULURP numbers',
    nyc_ceqr_number: 'CEQR number',
    nyc_ceqr_type: 'CEQR type',
    nyc_actions: 'actions',
    nyc_agency: 'agency',
    nyc_borough: 'borough',
    nyc_community_district: 'community district',
    nyc_council_district: 'council district',
    nyc_block_lot: 'block and lot',
    nyc_financing: 'financing',
    nyc_affordable: 'affordable share',
    nyc_co_applicants: 'co-applicants',
  }[kind];
}
