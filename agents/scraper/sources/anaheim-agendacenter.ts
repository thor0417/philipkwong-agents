// ANAHEIM'S PLANNING COMMISSION, ON THE HOST THAT ANSWERS.
//
// THE FINDING THIS EXISTS FOR. BRIEF-U-READER-3-ANAHEIM.md, measured 2026-09-11
// over every Anaheim record: all 51 records sitting on a Granicus AgendaViewer
// url are CITY COUNCIL items, and every one of those urls answers 302 with a 14
// byte body into local.anaheim.net, which answers nothing from this egress. The
// conclusion drawn from that had been "Anaheim needs the hosted runner". It is
// true of the Council half and false of the other one.
//
// Anaheim publishes through TWO hosts. The PLANNING COMMISSION is on
// www.anaheim.net/AgendaCenter, which answers 200 here, and all 44 of its 2025
// and 2026 meetings open from this machine. The corpus held a document for 11 of
// them. So the gap was an adapter pointed at the wrong host for half a market,
// not an egress wall, and closing it needs no runner and no secret.
//
// ---------------------------------------------------------------------------
// ONE MEETING, TWO DOCUMENTS, AND ONLY THE SECOND CARRIES A DECISION
// ---------------------------------------------------------------------------
//
// AgendaCenter files each meeting twice:
//
//   Agenda    the programme, published before the meeting. 44 of these.
//             Measured: 0 are titled ACTION AGENDA and 0 carry vote language.
//   Minutes   NOT minutes. It opens "CITY OF ANAHEIM PLANNING COMMISSION
//             ACTION AGENDA" and carries the roll call, the motion and the
//             vote. 33 of these.
//
// Measured through the reader (diagnostics/anaheim-action-vocab.ts):
//
//   over the 33 action agendas   486 facts   51 commission_action   52 the_vote
//   over the 44 agendas          338 facts    0 commission_action    0 the_vote
//
// So the ACTION AGENDA is preferred wherever it exists and the agenda is the
// fallback: it holds everything the agenda holds plus the decision, and a
// decision is the one criterion between Anaheim and the market standard
// (verify:market-standard: 11 party, 2 facts, 0 decision).
//
// AND THE SAME ITEM MUST NOT LAND TWICE. leads.url is the primary key, so
// capturing the agenda in week one and the action agenda in week three under
// their own urls would file one hearing as two records, one of them without the
// vote. The MeetingRef carries an identityUrl keyed on the MEETING, so the
// second pass updates the first and moves primary_document_url onto the document
// that carries the decision.
//
// ---------------------------------------------------------------------------
// THE LISTING IS NOT CATEGORY-CLEAN, SO THE DOCUMENT DECIDES
// ---------------------------------------------------------------------------
//
// The CivicPlus search route returned a Public Library Board agenda under the
// Planning Commission category id. Every fetched document is checked for
// PLANNING COMMISSION in its own first page before a single lead is built from
// it, because a date match against the wrong body is exactly how a wrong meeting
// becomes a finding.
//
// WHAT THIS DOES NOT TOUCH. The Granicus lane in agenda-portal.ts still reads
// Anaheim CITY COUNCIL and still reports `kept 0` from this machine, correctly:
// Council is not published on AgendaCenter at all and the weekly hosted runner
// is the only path to it. See CLAUDE.md.

import type { NormalizedLead } from './types';
import { sourceIso } from './source-date';
import { leadsFromAgendaText, type MeetingRef } from './agenda-portal';
import { fetchPdfPages } from './pdf-agenda';
import { fetchText } from './http';

const HOST = 'https://www.anaheim.net';
const INDEX = `${HOST}/AgendaCenter`;
const ANAHEIM = 'Anaheim, CA';

// How far back to list. Two calendar years covers the corpus the register holds
// and costs one listing fetch each.
function years(now: Date): string[] {
  const y = now.getUTCFullYear();
  return [String(y - 1), String(y)];
}

export interface AgendaCenterStats {
  categoryId: string | null;
  meetingsListed: number;
  actionAgendas: number;
  agendasOnly: number;
  documentsRead: number;
  wrongBody: number;
  unreadable: number;
  itemsKept: number;
}

export const anaheimAgendaCenterStats: AgendaCenterStats = {
  categoryId: null,
  meetingsListed: 0,
  actionAgendas: 0,
  agendasOnly: 0,
  documentsRead: 0,
  wrongBody: 0,
  unreadable: 0,
  itemsKept: 0,
};

/**
 * The Planning Commission's category id, READ FROM THE INDEX rather than
 * hardcoded, so a renumbering shows up as a warning and a zero rather than as a
 * silent miss on a market we claim to cover.
 */
export function planningCommissionCategory(indexHtml: string): string | null {
  for (const m of indexHtml.matchAll(/Planning Commission/gi)) {
    const at = m.index ?? 0;
    const id = indexHtml.slice(Math.max(0, at - 400), at + 400).match(/cat(\d+)/);
    if (id) return id[1];
  }
  return null;
}

export interface AgendaCenterFile {
  dateIso: string;
  kind: 'Agenda' | 'Minutes';
  url: string;
}

/** Every ViewFile link a search result page publishes, with its meeting date. */
export function parseViewFiles(html: string): AgendaCenterFile[] {
  const out: AgendaCenterFile[] = [];
  for (const m of html.matchAll(/\/AgendaCenter\/ViewFile\/(Agenda|Minutes)\/_(\d{2})(\d{2})(\d{4})-(\d+)/g)) {
    out.push({
      // The publisher's own calendar date, read as UTC. See sources/source-date.
      dateIso: `${m[4]}-${m[2]}-${m[3]}`,
      kind: m[1] as 'Agenda' | 'Minutes',
      url: `${HOST}/AgendaCenter/ViewFile/${m[1]}/_${m[2]}${m[3]}${m[4]}-${m[5]}`,
    });
  }
  return out;
}

/** True only for a document that says on its own first page which body it is. */
export function isPlanningCommissionDocument(text: string): boolean {
  return /PLANNING\s+COMMISSION/i.test(text.slice(0, 3000));
}

export async function scrapeAnaheimAgendaCenter(now: Date = new Date()): Promise<NormalizedLead[]> {
  const indexHtml = await fetchText(INDEX);
  if (!indexHtml) {
    console.warn('Anaheim AgendaCenter: index unreachable; 0 leads.');
    return [];
  }
  const cat = planningCommissionCategory(indexHtml);
  anaheimAgendaCenterStats.categoryId = cat;
  if (!cat) {
    console.warn('Anaheim AgendaCenter: no Planning Commission category on the index; 0 leads. Check the listing.');
    return [];
  }

  // One meeting per date, the action agenda preferred over the agenda.
  const perMeeting = new Map<string, { action?: string; agenda?: string }>();
  for (const y of years(now)) {
    const url =
      `${HOST}/AgendaCenter/Search/?term=&CIDs=${cat}` +
      `&startDate=01/01/${y}&endDate=12/31/${y}&dateRange=&dateSelector=&backButton=false`;
    const html = await fetchText(url);
    if (!html) {
      console.warn(`Anaheim AgendaCenter: ${y} listing unreachable; that year contributes nothing.`);
      continue;
    }
    for (const f of parseViewFiles(html)) {
      const e = perMeeting.get(f.dateIso) ?? {};
      if (f.kind === 'Minutes') e.action ??= f.url;
      else e.agenda ??= f.url;
      perMeeting.set(f.dateIso, e);
    }
  }
  anaheimAgendaCenterStats.meetingsListed = perMeeting.size;

  const leads: NormalizedLead[] = [];
  for (const [dateIso, files] of [...perMeeting.entries()].sort()) {
    const url = files.action ?? files.agenda;
    if (!url) continue;
    if (files.action) anaheimAgendaCenterStats.actionAgendas++;
    else anaheimAgendaCenterStats.agendasOnly++;

    const pages = await fetchPdfPages(url);
    const text = (pages ?? []).join('\n');
    if (!text) {
      anaheimAgendaCenterStats.unreadable++;
      continue;
    }
    // THE DOCUMENT DECIDES WHICH BODY THIS IS. The listing does not.
    if (!isPlanningCommissionDocument(text)) {
      anaheimAgendaCenterStats.wrongBody++;
      continue;
    }
    anaheimAgendaCenterStats.documentsRead++;

    const meeting: MeetingRef = {
      jurisdictionLabel: ANAHEIM,
      body: 'Planning Commission',
      // The same value the Granicus lane gives an Anaheim Planning Commission
      // meeting (bodySourceType), so one market does not carry two names for the
      // same kind of document.
      sourceType: 'Planning/Zoning Minutes',
      dateIso: sourceIso(dateIso),
      agendaUrl: url,
      // ONE IDENTITY PER MEETING, so the action agenda updates the agenda's items
      // rather than filing the same hearing a second time.
      identityUrl: `${HOST}/AgendaCenter/anaheim-planning-commission/${dateIso}`,
      source: 'anaheim-agendacenter',
      hasPrimaryDocument: true,
    };
    const got = leadsFromAgendaText(meeting, text);
    anaheimAgendaCenterStats.itemsKept += got.length;
    leads.push(...got);
  }

  console.log(
    `Anaheim AgendaCenter: category ${cat}, ${anaheimAgendaCenterStats.meetingsListed} meetings listed ` +
      `(${anaheimAgendaCenterStats.actionAgendas} with an action agenda, ${anaheimAgendaCenterStats.agendasOnly} agenda only), ` +
      `${anaheimAgendaCenterStats.documentsRead} read, ${anaheimAgendaCenterStats.wrongBody} refused as another body, ` +
      `${anaheimAgendaCenterStats.unreadable} unreadable -> ${leads.length} item leads.`
  );
  return leads;
}
