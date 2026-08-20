// THE ANAHEIM PLANNING COMMISSION / CITY COUNCIL ACTION AGENDA READER.
//
// ANAHEIM PUBLISHES A MEETING RECORD, NOT A PROJECT DOCUMENT, and that decides
// what can be read. Measured over 10 readable agendas: CEQA 90%, acreage 90%,
// a roll call 80%, a staff-report reference 70%, an @anaheim.net email 100%,
// and ZERO room counts, seats, parking spaces, residential units, purchase
// prices or labelled parties.
//
// TWO MEASURED FALSE POSITIVES THIS READER REFUSES TO USE, and they are the
// reason the vocabulary pass came before the reader:
//
//   "street address" hits 100% of documents - and the address is 200 South
//   Anaheim Boulevard, the COUNCIL CHAMBER. Reading it as a project address
//   would put the city hall's address under every Anaheim project.
//
//   "N feet" hits 40% - and it is "approximately 1,075 feet north of East La
//   Palma Avenue", a DISTANCE TO A CROSS STREET, not a building height. Read as
//   height it would print a 1,075-foot building in Anaheim.
//
// So the reader keys on the ITEM BLOCK and its own sentence, never on a pattern
// loose in the page:
//
//   ITEM NO. 3   DEVELOPMENT APPLICATION NO. 2025-00012
//   Location: This approximately 0.51-acre property is located at 1189 N.
//     Fountain Way, at the northwest corner of a cul-de-sac on North Fountain
//     Way, approximately 1,075 feet north of East La Palma Avenue.
//   Request: To approve a conditional use permit to permit a church...
//   Environmental Determination: The Planning Commission will consider whether
//     the proposed action is Categorically Exempt under CEQA Section 15301...
//   Project Planner: Nicholas Barrera NBarrera@anaheim.net
//   Resolution No. PC2025-028
//
// THE PROJECT PLANNER IS CITY STAFF AND IS LABELLED AS SUCH. Anaheim names a
// planner on every agenda with a working city email, which is the only reliable
// contact path in the whole Anaheim corpus - and they are a case officer, not a
// party to the project. Stored as 'case_planner', never as an applicant. Same
// shape as the PETITIONER defect and refused for the same reason.

import { norm, tidyLine, num, type FilingFact, type FilingFactKind } from './core';

export function isAnaheimAgenda(text: string): boolean {
  return /CITY OF ANAHEIM/i.test(text) && /(ACTION AGENDA|PLANNING COMMISSION|CITY COUNCIL)/i.test(text);
}

// SPANISH AGENDAS ARE SKIPPED, NOT READ BADLY. Anaheim publishes every agenda in
// both languages and both are captured; the report already prefers the English
// twin where it exists. A reader keyed on "Location:" and "Request:" would find
// nothing in the Spanish one anyway, but saying so is better than an empty
// result that reads like a coverage gap.
const SPANISH = /\b(ORDEN DEL D[IÍ]A|Concejal|Determinar que|sobre la base de la evidencia)\b/i;

export function isSpanishAgenda(text: string): boolean {
  return SPANISH.test(text);
}

// ---- the item block ---------------------------------------------------------
// One agenda carries several items. Each is read on its own, because an agenda
// with a hotel item and a church item must not merge their acreage.
const ITEM = /ITEM\s+NO\.\s*(\d{1,2})\s+((?:DEVELOPMENT APPLICATION|CONDITIONAL USE PERMIT|VARIANCE|TENTATIVE)[^\n]{0,80})/gi;

// AND A LINE END IS NOT A VALUE END EITHER, WHICH IS WHERE THIS ONE ACTUALLY
// CAME FROM. The document says "Categorically Exempt from the provisions of the
// California \nEnvironmental  Quality  Act  (CEQA)  pursuant  to  State \nCEQA
// Guidelines  Section  15301..." - a table column in a PDF, wrapped every eight
// words. norm() collapses spaces and tabs and deliberately keeps newlines, so
// every pattern written with [^\n] stopped at the first wrap. Found by reading
// the source document, after two rounds of widening the window changed nothing.
//
// Every prose field here had it, so every prose field is fixed: the patterns
// read across the wrap and tidyLine collapses the whitespace, which is the same
// normalisation verifyFilingFacts applies before checking a display against the
// document. The item block still bounds the search and the clip below bounds the
// value.
//
// A FIXED CHARACTER WINDOW ENDS WHERE THE COUNTER RUNS OUT, NOT WHERE THE
// SENTENCE DOES. The CEQA pattern took 60 characters after "Categorically
// Exempt", and a client document printed "Categorically Exempt from the
// provisions of the California" - a value cut in the middle of the name of the
// act, which reads as a system that does not know what it captured.
//
// The window is widened and the capture is then cut back to a boundary INSIDE
// it, so what is stored ends where the value ends. Every result is a verbatim
// PREFIX of the matched text and therefore still a verbatim substring of the
// document, which is what verifyFilingFacts requires: nothing appended, no
// ellipsis, no reassembly. See the golden case
// a-character-window-is-not-a-sentence-end.
//
// THE FIRST SENTENCE END, NOT THE LAST. The first cut of this took the last
// period in the window and produced "...and Section 15315, Class 15 (Minor Land
// Divisions). Approved Resolution No" - it had cut at the full stop inside
// "No.", which is worse than the truncation it replaced. A captured value is one
// sentence; where the window runs past the end of it, the end of it is where the
// value stops.
//
// A period only ends a sentence when a capital or the end of the string follows
// it, and not when the word before it is one of the abbreviations these agendas
// use. Where no sentence end is found the last clause boundary is taken instead,
// and where there is none of those either the text is returned untouched.
const ABBREV = /\b(No|Nos|St|Ave|Blvd|Rd|Dr|Ste|Inc|Corp|Co|Dept|Div|Sec|Ft|Approx|vs|U\.S|[A-Z])$/;

function clipToClause(s: string): string {
  const SENTENCE = /\.(?=\s+[A-Z(]|\s*$)/g;
  let m: RegExpExecArray | null;
  SENTENCE.lastIndex = 0;
  while ((m = SENTENCE.exec(s)) !== null) {
    // Short is allowed: "Section 15061(b)(3)." is a whole value at 19
    // characters, and a minimum of 20 sent it on to swallow "Resolution No.
    // ______ Staff Report Attachment 1 - Draft Planning Commission..." The
    // abbreviation list is what keeps a mid-value full stop from ending it, and
    // it does that job without a length rule on top.
    if (ABBREV.test(s.slice(0, m.index))) continue;
    if (m.index < 8) continue;
    return s.slice(0, m.index).trimEnd();
  }
  const ENDS: [RegExp, boolean][] = [
    [/;(?=\s|$)/g, true],
    [/\)(?=\s|$)/g, false],
    [/,(?=\s|$)/g, true],
  ];
  for (const [re, drop] of ENDS) {
    let last = -1;
    let hit: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((hit = re.exec(s)) !== null) last = hit.index;
    // A boundary in the first third is punctuation inside the value rather than
    // the end of it, so it is not treated as one.
    if (last > s.length / 3) return s.slice(0, drop ? last : last + 1).trimEnd();
  }
  return s;
}

const FIELDS: { kind: FilingFactKind; label: string; re: RegExp; numeric?: boolean; clip?: boolean }[] = [
  {
    kind: 'site_acreage', label: 'Location (acreage)',
    re: /(?:approximately\s+)?([\d.]+)[\s-]acre\b/i, numeric: true,
  },
  {
    kind: 'site_address', label: 'Location',
    // Anchored on "located at", never on a bare address, so the Council Chamber
    // in the page header can never be read as a project site.
    re: /\blocated at\s+([\d]{2,6}[^,.]{4,70}?)(?=\s*(?:,|\.|\s+at the|\s+within|\s+approximately|\s+Request))/i,
  },
  {
    kind: 'cross_streets', label: 'Location (cross street)',
    // THIS ONE KEEPS ITS LINE BOUND, and it is the exception that proves the
    // rule above. A cross street is a phrase rather than a sentence and has no
    // terminator of its own, so reading across the wrap ran it on: "at the
    // northwest corner of East Stanley Cup Way and South River Road within the
    // OCVIBE project, in an area" and "approximately 800 feet south of Lincoln
    // Avenue Request: To approve a conditional use perm". Measured on the
    // re-capture, and reverted.
    re: /\b(?:at the\s+[a-z]+\s+corner of\s+[^.\n]{6,80}|approximately\s+[\d,]+\s+feet\s+(?:north|south|east|west)\s+of\s+[^.\n]{4,60})/i,
  },
  {
    kind: 'action_sought', label: 'Request',
    re: /\bRequest:\s*([\s\S]{10,300}?)(?=\s*(?:Environmental Determination|Project Planner|Resolution|ITEM NO|$))/i,
  },
  {
    kind: 'environmental', label: 'Environmental Determination',
    re: /\bEnvironmental Determination:\s*([\s\S]{10,400}?)(?=\s*(?:Request:|Project Planner|Resolution|ITEM NO|$))/i,
    clip: true,
  },
  {
    kind: 'ceqa_class', label: 'CEQA',
    re: /\b(?:Categorically Exempt|Class\s+\d+|Section\s+15\d{3})[\s\S]{0,300}/i,
    clip: true,
  },
  {
    kind: 'resolution', label: 'Resolution No.',
    re: /\bResolution No\.\s*(PC\d{4}-\d{2,3}|\d{4}-\d{1,3})/i,
  },
  {
    kind: 'case_planner', label: 'Project Planner',
    re: /\bProject Planner:\s*([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,2}\s+[\w.+-]+@anaheim\.net)/i,
  },
];

/**
 * AN AGENDA IS ABOUT MANY PROJECTS AND A RECORD IS ABOUT ONE.
 *
 * THE DEFECT THIS SIGNATURE EXISTS TO PREVENT, caught in the measurement before
 * anything printed. One Anaheim agenda carries eight items. Reading it and
 * handing the result to whichever project the record belongs to gave OCVibe
 * "DEVELOPMENT APPLICATION NO. 2024-00076, 1.39 acres, approximately 406 feet
 * north of South Street" - a different item on the same page, about a different
 * site, printed under OCVibe's name with a link to a real city agenda.
 *
 * It is the same shape as the press round-up that gave Heart Hotel "US$20
 * billion", and it has to be refused the same way: the caller must say WHICH
 * item this record is, and where the agenda does not carry that item the answer
 * is nothing.
 *
 * `application` is the record's own reference - Anaheim writes it into the lead
 * title as "DEVELOPMENT APPLICATION NO. 2024-00076". Passing null reads every
 * item and is for MEASUREMENT ONLY, never for a project entry.
 */
export function readAnaheimFacts(
  rawText: string,
  opts: { application?: string | null; allItems?: boolean } = {}
): FilingFact[] {
  const text = norm(rawText);
  if (!isAnaheimAgenda(text) || isSpanishAgenda(text)) return [];

  // The blocks: from one ITEM NO. to the next, or to the end.
  const bounds: { n: string; head: string; at: number }[] = [];
  ITEM.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ITEM.exec(text)) !== null) bounds.push({ n: m[1], head: tidyLine(m[2]), at: m.index });

  const out: FilingFact[] = [];
  const all = bounds.length
    ? bounds.map((b, i) => ({ ...b, text: text.slice(b.at, bounds[i + 1]?.at ?? text.length) }))
    : [];

  // THE SELECTION, and its honest negative. An application number identifies the
  // item; where the caller gives one and the agenda does not carry it, this
  // agenda is not about that record and returns nothing.
  const wanted = opts.application ? /(\d{4}-\d{4,5})/.exec(opts.application)?.[1] ?? null : null;
  const blocks = opts.allItems
    ? all
    : wanted
      ? all.filter((b) => b.text.includes(wanted))
      : [];

  for (const b of blocks) {
    out.push({
      kind: 'application_no', label: `ITEM NO. ${b.n}`, display: b.head, value: null,
      line: tidyLine(`ITEM NO. ${b.n} ${b.head}`),
    });
    for (const f of FIELDS) {
      const hit = f.re.exec(b.text);
      if (!hit) continue;
      const captured = tidyLine(hit[1] ?? hit[0]);
      const display = f.clip ? clipToClause(captured) : captured;
      if (!display) continue;
      out.push({
        kind: f.kind,
        label: f.label,
        display,
        value: f.numeric ? num(display) : null,
        line: tidyLine(hit[0]),
        group: `ITEM NO. ${b.n}`,
      });
    }
  }
  return out;
}
