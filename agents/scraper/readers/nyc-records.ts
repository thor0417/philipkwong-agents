// THE NEW YORK READER. ZAP, CEQR and the City Record.
//
// NEW YORK HAS NO DOCUMENTS AND THAT IS SETTLED: 151 records, 4 with a readable
// document, and the five City Record notices that claim one are .docx. What it
// has instead is 1,058 to 2,315 characters of captured text per record - more
// than a Clark agenda sheet's General Summary block - which nothing has ever
// read. 93 live projects, 35% of the register, depend on it.
//
// WHAT IS BEING READ, STATED PLAINLY. The header of each raw_content is
// `Label: value` pairs our own adapters wrote. The LABELS are the city's own
// field names as captured (ZAP's `certified_referred`, CEQR's milestone list);
// the VALUES are the city's. So this is a re-read of captured structure, not a
// second source, and every fact still cites the city page the record carries.
// Where a value came from prose rather than a label, the reader says so by
// storing the clause it was printed in.
//
// MEASURED BEFORE IT WAS WRITTEN, over 39 ZAP, 63 CEQR and 49 City Record
// records. Every label below appears at the share noted; nothing here is a
// guess about what New York might write.
//
//   ZAP           Primary applicant 100%  Review type 100%  Borough 100%
//                 Council district 100%   Current milestone 100%
//                 Actions 97%   Community district 97%   CEQR number 92%
//                 Application filed 74%   ULURP numbers 72%
//                 Certified / referred 69%   APPROVED 51%   Completed 21%
//   CEQR          CEQR number 100%  Lead agency 100%  Borough 100%
//                 Milestones 100% (dated)   Project description 98%
//   City Record   Agency 100%  Notice type 100%  Hearing / meeting date 96%
//                 Notice text 78%   Address 61%
//
// THE FINDING THAT CHANGES A STANDING CLAIM. "We can say what was filed and
// reviewed in New York, never what was approved" has been in the coverage notes
// since the Council's Legistar returned 403. ZAP carries an `Approved` date on
// 51% of its records and a `Project status` on 100%. The Council feed is still
// dead; the land use approval is not, and it was sitting in a column.

import {
  norm, tidyLine, num, type FilingFact, type FilingFactKind,
} from './core';

/** True when the text is one of the three New York record shapes. */
export function isNycRecord(text: string): 'zap' | 'ceqr' | 'city-record' | null {
  if (/NYC land use application \(ZAP/i.test(text)) return 'zap';
  if (/NYC environmental review \(CEQR\)/i.test(text)) return 'ceqr';
  if (/NYC City Record notice/i.test(text)) return 'city-record';
  return null;
}

// ---- THE HEADER ------------------------------------------------------------
// Each is the label as the adapter wrote it, matched exactly. A label absent
// from a record is absent, not defaulted.
interface HeaderField { kind: FilingFactKind; label: string; numeric?: boolean }

const HEADER: HeaderField[] = [
  // decision and calendar, first because it is what no report can state today
  { kind: 'nyc_approved', label: 'Approved' },
  { kind: 'nyc_certified', label: 'Certified / referred' },
  { kind: 'nyc_filed', label: 'Application filed' },
  { kind: 'nyc_completed', label: 'Completed' },
  { kind: 'nyc_milestone', label: 'Current milestone' },
  { kind: 'nyc_milestone_date', label: 'Current milestone date' },
  { kind: 'nyc_milestones', label: 'Milestones' },
  { kind: 'nyc_status', label: 'Project status' },
  { kind: 'next_hearing', label: 'Hearing / meeting date' },
  { kind: 'nyc_notice_type', label: 'Notice type' },
  { kind: 'nyc_published', label: 'Published in the City Record' },
  { kind: 'nyc_environmental_milestone', label: 'Latest environmental milestone' },
  // instrument
  { kind: 'nyc_review_type', label: 'Review type' },
  { kind: 'nyc_ulurp', label: 'ULURP numbers' },
  { kind: 'nyc_ceqr_number', label: 'CEQR number' },
  { kind: 'nyc_actions', label: 'Actions' },
  { kind: 'nyc_agency', label: 'Lead agency' },
  { kind: 'nyc_agency', label: 'Agency' },
  { kind: 'nyc_ceqr_type', label: 'CEQR type' },
  // where
  { kind: 'nyc_borough', label: 'Borough' },
  { kind: 'nyc_community_district', label: 'Community district' },
  { kind: 'nyc_council_district', label: 'Council district', numeric: true },
  { kind: 'site_address', label: 'Address' },
];

// The value runs to the end of the line, or to the next `Label:` where the
// adapter put several on one line - which it does, because raw_content is
// assembled as a single paragraph in some adapters and line-broken in others.
// THE LOOKAHEAD REQUIRES THE COLON, and that is the whole of it. Without it the
// value stopped at any WORD that also begins a label: ZAP's milestone reads
// "EIS - Project Completed", and "Project" begins "Project status", so the fact
// stored was "EIS - Project" - a milestone cut in half at the moment it became
// informative. "Milestones: Draft Scope of Work 2023-03-01; DEIS & FEIS..." lost
// everything after the ampersand the same way.
//
// A label is a label when it is followed by a colon. Nothing else distinguishes
// one from an ordinary word, because these are English words: Actions, Agency,
// Borough, Completed, Notice.
// THE LIST MUST BE COMPLETE, and a missing entry does not degrade - it deletes.
//
// `CEQR lead agency` was missing, and the cost was the whole of `CEQR type`: 92
// ZAP records carry the label and 1 stored the fact. In real raw_content the
// fields are newline-separated, so the value pattern cannot cross into the next
// field and the lookahead is the ONLY way the match can close. With the next
// label absent from this list there is nothing to close on, so the field reads
// as nothing at all rather than as too much.
//
// It survived the diagnostics because nyc-vocab counts `Label:` occurrences and
// never runs the reader, and it survived a synthetic single-line test because
// with spaces instead of newlines the value can run on and close at a LATER
// label - swallowing "CEQR" but still matching. It was caught by comparing the
// stored per-field rate against the measured one, which is the whole reason that
// comparison is printed.
//
// So the list below is the FULL set of labels the three adapters write,
// enumerated from the corpus by diagnostics/nyc-vocab rather than from memory.
const NEXT_LABEL =
  '(?=\\s+(?:Approved|Certified\\s*/\\s*referred|Application filed|Completed|' +
  'Current milestone(?: date)?|Milestones|Project status|Project brief|' +
  'Project description|Project page|Notice page|Notice document|' +
  'Hearing\\s*/\\s*meeting date|Notice type|Notice|Published in the City Record|' +
  'Latest environmental milestone|Review type|ULURP numbers|' +
  'CEQR lead agency|CEQR number|CEQR type|Actions|Lead agency|Agency|Borough|' +
  'Community district|Council district|Address|Applicant type|Primary applicant|' +
  'Public status|Record date taken from|ZAP project id|Gate|Target-term hits|' +
  'Section|Request id|Financing Amount)\\s*:|$)';

function readHeader(text: string): FilingFact[] {
  const out: FilingFact[] = [];
  for (const f of HEADER) {
    const esc = f.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const re = new RegExp(`\\b${esc}\\s*:\\s*([^\\n]{1,220}?)${NEXT_LABEL}`, 'i');
    const m = re.exec(text);
    if (!m) continue;
    const display = tidyLine(m[1]);
    // A PLACEHOLDER IS NOT A VALUE. ZAP's address field offers a dropdown and
    // stores the literal string "Address Not Listed In The Dropdown" when the
    // filer could not find their site in it. Printed as an address under a
    // project name, that reads as though we captured something.
    if (!display) continue;
    if (/^(n\/?a|none|null|unknown|tbd|-)$/i.test(display)) continue;
    if (/^address not listed/i.test(display)) continue;
    // A label that appears twice in the list (Lead agency / Agency both map to
    // nyc_agency) must not produce two facts for one record.
    if (out.some((o) => o.kind === f.kind)) continue;
    out.push({
      kind: f.kind,
      label: f.label,
      display,
      value: f.numeric ? num(display) : null,
      line: tidyLine(`${f.label}: ${display}`),
    });
  }
  return out;
}

// ---- THE PROSE -------------------------------------------------------------
//
// THIS IS WHERE THE SCALE IS AND THERE IS NOT MUCH OF IT. Measured: square
// footage in 19 of 151 records, dwelling units in 7, storeys in 14, hotel rooms
// in 3, seats in 5, parking in 5. Reported rather than inflated - New York's
// captured text is procedurally rich and dimensionally thin, which is the
// opposite of Clark and worth knowing before anything is promised on it.
//
// EACH CARRIES THE CLAUSE IT CAME FROM, because unlike Clark's labelled bullets
// a number in a paragraph means nothing without the words around it: "1,400
// units of 100 percent affordable housing, local retail, a 250-room hotel and a
// 25,000-seat soccer stadium" is four facts and one sentence, and dropping the
// sentence would leave four bare numbers under a project name.
interface ProseField { kind: FilingFactKind; label: string; re: RegExp; numeric?: boolean }

const PROSE: ProseField[] = [
  {
    kind: 'floor_area', label: 'square feet',
    re: /\b([\d,]{3,12}(?:\.\d+)?)\s*(?:gross\s+)?(?:square[- ]?(?:feet|foot)|gsf|sf)\b/i,
  },
  {
    kind: 'floor_area', label: 'million square feet',
    re: /\b([\d.]{1,6})\s*million\s*square[- ]?(?:feet|foot)\b/i,
  },
  {
    kind: 'units', label: 'dwelling units',
    re: /\b([\d,]{1,7})\s+(?:dwelling\s+units|units\s+of\s+(?:\d+\s+percent\s+)?affordable\s+housing|residential\s+units)\b/i,
    numeric: true,
  },
  {
    kind: 'rooms', label: 'hotel rooms',
    re: /\b([\d,]{2,7})[- ](?:hotel\s+)?rooms?\b|\b([\d,]{2,7})\s+hotel\s+rooms\b/i,
    numeric: true,
  },
  {
    kind: 'seats', label: 'seats',
    re: /\b([\d,]{2,9})[- ]seat\b|\bseating capacity of\s+([\d,]{2,9})\b/i,
    numeric: true,
  },
  {
    kind: 'stories', label: 'storeys',
    re: /\b(\d{1,3})[- ]?stor(?:y|ies|ey|eys)\b/i,
    numeric: true,
  },
  {
    kind: 'parking', label: 'parking spaces',
    re: /\b([\d,]{1,7})\s+parking spaces\b/i,
    numeric: true,
  },
  {
    kind: 'site_acreage', label: 'acres',
    re: /\b([\d.,]{1,8})\s+acres\b/i,
    numeric: true,
  },
  {
    kind: 'nyc_block_lot', label: 'Block and Lot',
    re: /\bBlock\s+\d{1,5},?\s+Lots?\s+[\d,\s]{1,24}(?:and\s+\d{1,5})?/i,
  },
  {
    kind: 'nyc_financing', label: 'Financing Amount',
    re: /\bFinancing Amount:\s*(\$[\d,]{3,15}(?:\s+in\s+[^\n.]{0,60})?)/i,
  },
  {
    kind: 'nyc_affordable', label: 'percent affordable',
    re: /\b(\d{1,3}\s*percent\s+affordable)\b/i,
  },
];

// The clause the value sits in, cut at the sentence boundaries around it and
// capped. Same contract as press-facts: the window is taken AROUND the match so
// the printed value is always inside its own printed evidence.
const CLAUSE_CAP = 260;

function clauseFor(text: string, at: number, display: string): string {
  const start = Math.max(0, text.lastIndexOf('. ', at) + 1);
  let end = text.indexOf('. ', at);
  if (end === -1) end = text.length;
  const sentence = tidyLine(text.slice(start, Math.min(end + 1, text.length)));
  if (sentence.length <= CLAUSE_CAP) return sentence;
  const off = sentence.indexOf(display);
  if (off === -1) return sentence.slice(0, CLAUSE_CAP);
  const room = Math.floor((CLAUSE_CAP - display.length) / 2);
  const from = Math.max(0, off - room);
  const to = Math.min(sentence.length, from + CLAUSE_CAP);
  return `${from > 0 ? '...' : ''}${sentence.slice(from, to).trim()}${to < sentence.length ? '...' : ''}`;
}

// The description is the only part of the text that is prose. Reading the scale
// patterns over the WHOLE record would match the header's own identifiers - a
// ULURP number is digits and a council district is a small integer - so the
// prose pass is bounded to the paragraph the adapter labelled as such.
const PROSE_BLOCK = /(?:Project brief|Project description|Notice)\s*:\s*([\s\S]{20,4000}?)(?=\s+(?:Latest environmental|Milestones|Review type|Primary applicant|Applicant type|Borough|Council district|Current milestone|Project status|Public status|Record date|Gate|Target-term|Project page|Notice page|Notice document|Published)\b|$)/i;

function readProse(text: string): FilingFact[] {
  const block = PROSE_BLOCK.exec(text);
  if (!block) return [];
  const prose = block[1];
  const out: FilingFact[] = [];
  for (const f of PROSE) {
    const m = f.re.exec(prose);
    if (!m) continue;
    // The display is the WHOLE match, not the capture group: "250-room" reads
    // as a room count and "250" alone does not.
    const display = tidyLine(m[0]);
    if (out.some((o) => o.kind === f.kind)) continue;
    const captured = m.slice(1).find(Boolean) ?? display;
    out.push({
      kind: f.kind,
      label: f.label,
      display,
      value: f.numeric ? num(captured) : null,
      line: clauseFor(prose, m.index ?? 0, display),
    });
  }
  return out;
}

// ---- THE APPLICANT LINE, WHICH IS NOT A PARTY LAYER -------------------------
//
// ZAP writes `Primary applicant: <name>` on every record and the adapter already
// stores it in the applicant column, so this reader does NOT re-read it. What it
// does read is the CO-APPLICANT phrasing in the brief, which the column cannot
// hold and which the entry has nowhere to put today:
//
//   "Co-applicants Queens Development Group, LLC, City Football Stadium Group,
//    LLC and the New York City Economic Development Corporation request a
//    series of land use actions..."
//
// STORED AS THE CLAUSE, NOT AS NAMES. Splitting that into three parties with a
// role each is exactly the inference standing rule 1 forbids, and the same shape
// as the PETITIONER defect. The clause is what the city wrote; who is which is
// not ours to decide.
const CO_APPLICANTS = /\bCo-?applicants?\s+([^.]{10,240}?)(?=\s+(?:request|seek|propose|are\s+seeking)\b)/i;

function readCoApplicants(text: string): FilingFact[] {
  const m = CO_APPLICANTS.exec(text);
  if (!m) return [];
  return [{
    kind: 'nyc_co_applicants',
    label: 'Co-applicants',
    display: tidyLine(m[1]),
    value: null,
    line: tidyLine(m[0]),
  }];
}

export function readNycFacts(rawText: string): FilingFact[] {
  const text = norm(rawText);
  if (!isNycRecord(text)) return [];
  return [...readHeader(text), ...readCoApplicants(text), ...readProse(text)];
}
