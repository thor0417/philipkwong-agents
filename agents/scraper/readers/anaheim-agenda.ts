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

const FIELDS: { kind: FilingFactKind; label: string; re: RegExp; numeric?: boolean }[] = [
  {
    kind: 'site_acreage', label: 'Location (acreage)',
    re: /(?:approximately\s+)?([\d.]+)[\s-]acre\b/i, numeric: true,
  },
  {
    kind: 'site_address', label: 'Location',
    // Anchored on "located at", never on a bare address, so the Council Chamber
    // in the page header can never be read as a project site.
    re: /\blocated at\s+([\d]{2,6}[^,.\n]{4,70}?)(?=\s*(?:,|\.|\s+at the|\s+within|\s+approximately|\s+Request))/i,
  },
  {
    kind: 'cross_streets', label: 'Location (cross street)',
    re: /\b(?:at the\s+[a-z]+\s+corner of\s+[^.\n]{6,80}|approximately\s+[\d,]+\s+feet\s+(?:north|south|east|west)\s+of\s+[^.\n]{4,60})/i,
  },
  {
    kind: 'action_sought', label: 'Request',
    re: /\bRequest:\s*([^\n]{10,300}?)(?=\s*(?:Environmental Determination|Project Planner|Resolution|ITEM NO|$))/i,
  },
  {
    kind: 'environmental', label: 'Environmental Determination',
    re: /\bEnvironmental Determination:\s*([^\n]{10,260}?)(?=\s*(?:Request:|Project Planner|Resolution|ITEM NO|$))/i,
  },
  {
    kind: 'ceqa_class', label: 'CEQA',
    re: /\b(?:Categorically Exempt|Class\s+\d+|Section\s+15\d{3})[^\n]{0,60}/i,
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
      const display = tidyLine(hit[1] ?? hit[0]);
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
