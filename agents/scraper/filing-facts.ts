// READING A CLARK COUNTY AGENDA SHEET FOR EVERYTHING EXCEPT THE CONTACTS.
//
// WHY CLARK AND WHY ONLY CLARK. Measured over 155 readable documents across
// seven jurisdictions: 87 of them are Clark County, and Clark is the only
// publisher whose documents carry a form. Anaheim publishes a meeting agenda,
// Oakland an ordinance, Phoenix a liquor-licence data sheet, Nashville a grant
// summary. A reader written against "government documents" would be written
// against nothing. This is written against ONE form, which is why it can be
// strict.
//
// THE FORM, as Clark prints it:
//
//   07/07/26 PC AGENDA SHEET
//   PUBLIC HEARING
//   APP. NUMBER/OWNER/DESCRIPTION OF REQUEST
//   UC-25-0896-HAPPY MINER, LLC:
//   HOLDOVER USE PERMIT for office as a principal use...
//   Generally located north of Desert Inn Road and west of Pawnee Drive within Winchester.
//   RELATED INFORMATION:
//   APN: 162-11-411-112
//   LAND USE PLAN: WINCHESTER/PARADISE - NEIGHBORHOOD COMMERCIAL
//   BACKGROUND:
//   Project Description
//   • General Summary
//   • Site Address: 1700 E. Desert Inn Road
//   • Site Acreage: 2.16
//   • Number of Units: 200
//   • Number of Stories: 15
//   • Building Height (feet): 192
//   • Square Feet: 31,000 (Office Building)/211,250 (Multi-Family Residential)
//   • Parking Required/Provided: 278/315
//   ...
//   Staff Recommendation
//   Approval of use permit...; denial of waivers #1, #2... This item will be
//   forwarded to the Board of County Commissioners' meeting for final action on
//   August 5, 2026 at 9:00 a.m.
//   PRELIMINARY STAFF CONDITIONS:
//   Comprehensive Planning
//   • Certificate of Occupancy shall not be issued without...
//   TAB/CAC: Whitney - approval.  APPROVALS: 4  PROTESTS: 5
//   PLANNING COMMISSION ACTION: June 16, 2026 – HELD – To 07/07/26
//
// THE GENERAL SUMMARY BLOCK IS THE PRIZE and it is why this is worth doing at
// all. It is a LABELLED form, not prose: the document itself says which number
// is the storey count and which is the height, so nothing has to be guessed from
// a regex over free text. "Square Feet: 31,000 (Office Building)/211,250
// (Multi-Family Residential)" is floor area BY USE, stated, which is a thing the
// brief asked for and which no press article has ever carried.
//
// THE SAME DISCIPLINE AS press-facts, and for the same reason. Every fact
// carries the LABEL the document used, the VERBATIM string, and the LINE it was
// printed on. verifyFilingFacts asserts every display is still findable in the
// source before anything is stored, so a reader bug becomes a refusal rather
// than a wrong number under a county link.
//
// NO PARTIES. contact-labels owns those and already reads them. Nothing here
// names a person or a firm, which is the whole point of "everything except
// contacts": the party layer has a rule that does not bend and this file has no
// business near it.

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
  | 'rooms' | 'lots' | 'existing_land_use' | 'unit_size' | 'sustainability';

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
function norm(text: string): string {
  return text.replace(/[ \t ]+/g, ' ');
}

function tidyLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function num(raw: string): number | null {
  const n = Number(raw.replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// ---- THE GENERAL SUMMARY BLOCK ----------------------------------------------
//
// Each is a bullet whose label the document prints and whose value follows a
// colon. The label is matched EXACTLY as Clark writes it, including the unit in
// brackets, because that bracket is the document telling us the unit rather than
// us assuming one.
// EVERY FIELD THE FORM USES, enumerated from the corpus rather than guessed,
// with the number of the 18 agenda sheets carrying each:
//
//   Site Acreage 16   Site Address 15   Project Type 12   Square Feet 10
//   Parking Required/Provided 9   Number of Stories 8   Building Height 8
//   Existing Land Use 4   Number of Units 3   Density 3   Sustainability 3
//   Open Space 2   Minimum/Maximum Unit Size 2   Number of Lots 1
//   Number of Rooms 1   Site Addresses 1   Parking Provided 1
//
// NUMBER OF ROOMS IS IN THE FORM AND IN ONE DOCUMENT. That one document is Heart
// Hotel, where the filing states 752 - the same number four publications
// reported. It is worth reading precisely because a filing saying it outranks an
// article saying it, and it is worth being honest that 1 in 18 is not coverage.
const SUMMARY_FIELDS: { kind: FilingFactKind; label: RegExp; numeric: boolean }[] = [
  // "Address" or "Addresses". NOT /Addresses?/, which is "Addresse" plus an
  // optional s and matches neither - it cost this field 8 of its 9 documents
  // between two runs of the measurement, which is why the measurement is run
  // after every change to the list rather than once at the end.
  { kind: 'site_address', label: /Site Address(?:es)?/i, numeric: false },
  { kind: 'site_acreage', label: /Site Acreage/i, numeric: true },
  { kind: 'project_type', label: /Project Type/i, numeric: false },
  { kind: 'existing_land_use', label: /Existing Land Use/i, numeric: false },
  { kind: 'rooms', label: /Number of Rooms/i, numeric: true },
  { kind: 'units', label: /Number of Units/i, numeric: true },
  { kind: 'lots', label: /Number of Lots/i, numeric: true },
  { kind: 'density', label: /Density \(du\/ac\)/i, numeric: true },
  { kind: 'stories', label: /Number of Stories/i, numeric: true },
  { kind: 'height_feet', label: /Building Height \(feet\)/i, numeric: true },
  { kind: 'floor_area', label: /Square Feet/i, numeric: false },
  { kind: 'unit_size', label: /Minimum\/Maximum Unit Size \(square feet\)/i, numeric: false },
  { kind: 'open_space', label: /Open Space (?:Required\/)?Provided/i, numeric: false },
  { kind: 'parking', label: /Parking (?:Required\/)?Provided/i, numeric: false },
  { kind: 'sustainability', label: /Sustainability (?:Required\/)?Provided/i, numeric: false },
];

// A VALUE THAT WRAPS IS FINISHED ON THE NEXT LINE, and the form tells you when
// with a bracket it has not closed:
//
//   • Building Height (feet): 317 (Hotel Tower to Roof)/272.5 (First Hotel Parapet)/70 (Hotel
//   Podium)/295 (Sky Venue)/93 (Parking Garage)/41 (Venue Buildings)
//
// Read one line at a time that is "70 (Hotel", which is not a height. An
// UNBALANCED BRACKET is the signal, and it is a precise one: it continues only
// while the document itself is mid-parenthesis, so "Sustainability
// Required/Provided: 7/7.5" - balanced, complete - does not swallow the heading
// on the line after it.
function balanced(s: string): boolean {
  let depth = 0;
  for (const c of s) {
    if (c === '(') depth++;
    else if (c === ')') depth--;
  }
  return depth <= 0;
}

const WRAP_MAX_LINES = 3;

function completeValue(text: string, from: number, first: string): string {
  let value = first;
  if (balanced(value)) return value;
  const rest = text.slice(from).split('\n').slice(1, 1 + WRAP_MAX_LINES);
  for (const line of rest) {
    if (/^\s*[•·▪]/.test(line)) break;
    value += ` ${line.trim()}`;
    if (balanced(value)) break;
  }
  return value;
}

function readSummary(text: string): FilingFact[] {
  const out: FilingFact[] = [];
  for (const f of SUMMARY_FIELDS) {
    // The value runs to the end of the line, or to the next bullet where the PDF
    // put two on one line, and then across the wrap if the brackets say so.
    const re = new RegExp(`[•·]?\\s*(${f.label.source})\\s*:\\s*([^\\n•·]{1,160})`, 'i');
    const m = re.exec(text);
    if (!m) continue;
    const display = tidyLine(completeValue(text, m.index, m[2]));
    if (!display || /^(n\/?a|none|tbd|-)$/i.test(display)) continue;
    out.push({
      kind: f.kind,
      label: tidyLine(m[1]),
      display,
      // FIRST NUMBER ONLY, and only where the field is a single quantity.
      // "Square Feet: 31,000 (Office)/211,250 (Multi-Family)" is not one number
      // and must not be reduced to one; its display carries the breakdown.
      value: f.numeric ? num((/[\d,.]+/.exec(display) ?? [''])[0]) : null,
      line: tidyLine(`${m[1]}: ${display}`),
    });
  }
  return out;
}

// ---- WHERE ------------------------------------------------------------------
const APN_LINE = /\bAPN\s*:?\s*\n?\s*((?:\d{3}-\d{2}-\d{3}(?:-\d{3})?)(?:\s*[;,and]+\s*\d{3}-\d{2}-\d{3}(?:-\d{3})?)*)/i;
// "Generally located north of Desert Inn Road and west of Pawnee Drive within
// Winchester." The town at the end is the unincorporated town, which is a real
// geography Clark uses and which the corpus has nowhere else.
const LOCATED = /Generally\s+located\s+([^.\n]{10,220})\./i;
const WITHIN_TOWN = /\bwithin\s+([A-Z][A-Za-z' ]{2,28}?)\s*\.?\s*(?:[A-Z]{2}\/|$)/;
const LAND_USE_PLAN = /LAND USE PLAN\s*:?\s*\n?\s*([^\n]{3,120})/i;
// "on 2.16 acres in a CR (Commercial Resort) Zone"
const ZONE = /\bin\s+an?\s+([A-Z]{1,3}-?\d?\s*\([^)]{3,40}\))\s*Zone\b/;

function readWhere(text: string): FilingFact[] {
  const out: FilingFact[] = [];
  const apn = APN_LINE.exec(text);
  if (apn) {
    out.push({ kind: 'apn', label: 'APN', display: tidyLine(apn[1]), value: null, line: tidyLine(apn[0]) });
  }
  const loc = LOCATED.exec(text);
  if (loc) {
    const display = tidyLine(loc[1]);
    out.push({ kind: 'cross_streets', label: 'Generally located', display, value: null, line: tidyLine(loc[0]) });
    const town = WITHIN_TOWN.exec(display);
    if (town) {
      out.push({ kind: 'town', label: 'within', display: tidyLine(town[1]), value: null, line: display });
    }
  }
  const lup = LAND_USE_PLAN.exec(text);
  if (lup) {
    out.push({ kind: 'land_use_plan', label: 'LAND USE PLAN', display: tidyLine(lup[1]), value: null, line: tidyLine(lup[0]) });
  }
  const zone = ZONE.exec(text);
  if (zone) {
    out.push({ kind: 'zone', label: 'Zone', display: tidyLine(zone[1]), value: null, line: tidyLine(zone[0]) });
  }
  return out;
}

// ---- DECISION AND CALENDAR --------------------------------------------------
//
// RANKED FIRST because it is the only future hearing date in the system. The
// corpus holds 242 deadlines and every one is a foreign tender closing date; not
// one government record carries a future date of any kind. The date is in the
// document or it is nowhere.
const DECISION_PATTERNS: { kind: FilingFactKind; label: string; re: RegExp }[] = [
  {
    kind: 'staff_recommendation',
    label: 'Staff Recommendation',
    re: /Staff\s+Recommendation\s*\n\s*([^\n]{5,300}(?:\n[^\n]{5,300}){0,3}?)(?=\n\s*(?:If this request|PRELIMINARY|CONDITIONS|TAB\/CAC|\n))/i,
  },
  {
    kind: 'next_hearing',
    label: 'forwarded for final action',
    re: /forwarded\s+to\s+the\s+([^\n]{4,80}?)\s*(?:meeting\s+)?for\s+final\s+action\s+on\s+([A-Z][a-z]+\s+\d{1,2},?\s+\d{4}(?:\s+at\s+[\d:]+\s*[ap]\.?m\.?)?)/i,
  },
  {
    kind: 'commission_action',
    label: 'PLANNING COMMISSION ACTION',
    re: /PLANNING COMMISSION ACTION\s*:?\s*([^\n]{4,160})/i,
  },
  {
    kind: 'board_action',
    label: 'COUNTY COMMISSION ACTION',
    re: /(?:BOARD OF COUNTY COMMISSIONERS?|COUNTY COMMISSION|BCC)\s+ACTION\s*:?\s*([^\n]{4,160})/i,
  },
  {
    kind: 'held_to',
    label: 'HELD',
    re: /\bHELD\s*[-–—]\s*To\s*([\d/]{6,10})/i,
  },
  {
    kind: 'tab_cac',
    label: 'TAB/CAC',
    re: /TAB\/CAC\s*:?\s*([^\n]{3,120})/i,
  },
  {
    kind: 'protests',
    label: 'APPROVALS / PROTESTS',
    re: /(APPROVALS\s*:?\s*\d+\s*PROTESTS\s*:?\s*\d+)/i,
  },
];

function readDecision(text: string): FilingFact[] {
  const out: FilingFact[] = [];
  for (const p of DECISION_PATTERNS) {
    const m = p.re.exec(text);
    if (!m) continue;
    // next_hearing captures the body and the date separately; the display is the
    // date, because that is the fact, and the body goes in the label so the
    // reader knows who is sitting.
    const display = p.kind === 'next_hearing' ? tidyLine(m[2]) : tidyLine(m[1]);
    if (!display) continue;
    out.push({
      kind: p.kind,
      label: p.kind === 'next_hearing' ? `${p.label}: ${tidyLine(m[1])}` : p.label,
      display,
      value: null,
      line: tidyLine(m[0]),
    });
  }
  return out;
}

// ---- CONDITIONS OF APPROVAL --------------------------------------------------
//
// DISCRETE ITEMS, AND THE DELIMITER IS A BULLET UNDER A DEPARTMENT HEADING, not
// a number. Measured: 28 of 87 Clark documents carry a conditions heading and
// the median count of NUMBERED items under it is zero. Reading them as a
// numbered list finds nothing; reading them as bullets under "Comprehensive
// Planning", "Public Works - Development Review", "Department of Aviation" finds
// all of them AND keeps the reviewing department, which is worth more than the
// flat list would have been.
const CONDITIONS_HEAD = /(PRELIMINARY STAFF CONDITIONS|CONDITIONS OF APPROVAL|^\s*CONDITIONS\s*:)/im;
const BULLET = /^[ \t]*[\u2022\u00b7\u25aa-][ \t]*(.+)$/;
const CONDITION_MIN = 12;
const CONDITIONS_MAX = 60;

// THE DEPARTMENTS, ENUMERATED FROM THE CORPUS RATHER THAN GUESSED. Every
// department heading appearing under a conditions block in the sample, with the
// number of documents it appears in:
//
//   Comprehensive Planning                                15
//   Public Works - Development Review                     15
//   Fire Prevention Bureau                                13
//   Clark County Water Reclamation District (CCWRD)       13
//   Department of Aviation                                 5
//   Building Department - Addressing                       3
//   Southern Nevada Health District (SNHD) - Engineering    2
//
// A CLOSED LIST IS THE RIGHT SHAPE HERE and a heading-detector is not, which is
// what the first version tried. The form wraps mid-clause, so a heading arrives
// glued to the tail of the bullet above it - "...within the right-of-way.
// Building Department - Addressing" - and every general rule for spotting a
// Title Case heading either misses that or eats half the conditions. Reading a
// department we have never seen as part of the condition text is a cosmetic
// loss; splitting a condition on a phrase that turned out not to be a heading is
// a wrong quotation under a county link.
//
// A department in Clark's form and absent here shows up as its conditions being
// grouped under the previous one, which is visible in the measurement rather
// than silent.
const DEPARTMENTS = [
  'Comprehensive Planning',
  'Public Works - Development Review',
  'Public Works - Construction Division',
  'Fire Prevention Bureau',
  'Clark County Water Reclamation District (CCWRD)',
  'Department of Aviation',
  'Building Department - Addressing',
  'Southern Nevada Health District (SNHD) - Engineering',
];

// Where the conditions block ends and the rest of the sheet resumes.
const AFTER_CONDITIONS =
  /^\s*(TAB\/CAC|APPROVALS\s*:|PROTESTS\s*:|PLANNING COMMISSION ACTION|COUNTY COMMISSION ACTION|BOARD OF COUNTY|Prior Land Use|PRIOR LAND USE|APPLICANT\s*:|CONTACT\s*:)/i;

function readConditions(rawText: string): FilingFact[] {
  const at = rawText.search(CONDITIONS_HEAD);
  if (at === -1) return [];
  let body = rawText.slice(at);
  // A department name can arrive glued to the tail of the wrapped bullet above
  // it. Putting it back on its own line first is what makes the walk below
  // simple, and it is a formatting repair rather than a reading: the text is
  // unchanged, only where the line breaks fall.
  // ONLY WHERE A BULLET FOLLOWS IT. A department name also appears INSIDE
  // conditions - "Applicant to coordinate with Public Works - Development Review
  // for all driveways on Las Vegas Boulevard" - and splitting on that truncated
  // the condition to "Applicant to coordinate with" and opened a phantom group.
  // A heading is always followed by the first bullet of its own list; a mention
  // inside a sentence never is.
  for (const dept of DEPARTMENTS) {
    const esc = dept.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    body = body.replace(new RegExp(`\\s*(${esc})\\s*(?=\\s*[\u2022\u00b7\u25aa])`, 'g'), '\n$1\n');
  }

  const out: FilingFact[] = [];
  let group: string | null = null;
  let current: string | null = null;

  const flush = (): void => {
    if (!current) return;
    const display = tidyLine(current);
    current = null;
    if (display.length < CONDITION_MIN) return;
    if (out.length >= CONDITIONS_MAX) return;
    out.push({ kind: 'condition', label: 'condition', display, value: null, line: display, group });
  };

  for (const raw of body.split('\n')) {
    const line = raw.replace(/\u00a0/g, ' ');
    if (/^\s*$/.test(line)) continue;
    if (AFTER_CONDITIONS.test(line)) break;
    const asDept = DEPARTMENTS.find((d) => tidyLine(line) === d);
    if (asDept) {
      flush();
      group = asDept;
      continue;
    }
    const b = BULLET.exec(line);
    if (b) {
      flush();
      current = b[1];
      continue;
    }
    // Most lines are a continuation: the form wraps at about 90 characters
    // mid-clause, so a condition is several lines and only the first has a bullet.
    if (current) current += ` ${line.trim()}`;
  }
  flush();
  return out;
}

// ---- THE READER --------------------------------------------------------------

/** True when the text is a Clark County agenda sheet, which is the only form this reads. */
export function isClarkAgendaSheet(text: string): boolean {
  return /AGENDA SHEET/i.test(text) && /APP\.\s*NUMBER|RELATED INFORMATION/i.test(text);
}

export function readFilingFacts(rawText: string): FilingFact[] {
  const text = norm(rawText);
  return [
    ...readDecision(text),
    ...readConditions(text),
    ...readWhere(text),
    ...readSummary(text),
  ];
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
    lots: 'lots',
    existing_land_use: 'existing land use',
    unit_size: 'unit size',
    sustainability: 'sustainability',
  }[kind];
}
