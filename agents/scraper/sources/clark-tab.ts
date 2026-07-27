// Clark County (NV) Town Advisory Board capture.
//
// WHY THIS EXISTS. The Clark County Legistar client publishes exactly 12 bodies
// (Board of Commissioners, Planning Commission + Briefing, Zoning Commission,
// Redevelopment Agency, Water Reclamation District, Debt Management Commission,
// Emergency Meeting, Special Meeting, Police Fatality Review, Transform Clark
// County Workshop, Zoning Workshop). The Town Advisory Boards are NOT among them
// and cannot be added by widening the Legistar pull: the county does not publish
// TAB records to Legistar at all. They are published as agenda / minutes PDFs on
// clarkcountynv.gov, one page per board.
//
// This matters because the TAB is the FIRST public hearing a Strip-corridor
// entitlement gets: the Clark County staff reports carry a "TAB/CAC: Paradise -
// approval" line, meaning the board already heard and voted on the item before it
// reached the Zoning Commission. Both the Heart Hotel parcel (former SkyVue, east
// of Las Vegas Boulevard South) and the Top Gun parcel (4815 S Las Vegas Blvd at
// Russell Road) sit in Paradise.
//
// Add a board by adding ONE line to BOARDS. Each board degrades independently: an
// unreachable page or an unparseable PDF logs and contributes zero.

import type { NormalizedLead } from './types';
import type { SourceType } from '../../../lib/taxonomy';
import { fetchText, leadsFromAgendaText, type MeetingRef } from './agenda-portal';
import { fetchPdfPages } from './pdf-agenda';
import { bypassesGate } from '../targets';

const CLARK = 'Clark County, NV';
const SOURCE = 'clark-tab';
// Agendas/minutes older than this are historical; the lane captures current
// entitlement activity. Matches the Anaheim / Las Vegas lanes' 2025+ window.
const SINCE = Date.parse('2025-01-01');
// Documents fetched per board per run (most recent first). Bounds the run.
const MAX_DOCS_PER_BOARD = Number(process.env.CLARK_TAB_MAX_DOCS ?? '16');

// ---- CONFIG: boards (SWAPPABLE) ---------------------------------------------
// `page` is the board's public page on clarkcountynv.gov, which lists every
// agenda and minutes PDF it has published. `reason` records WHY the board is
// here. Paradise and Winchester are the two Strip-corridor boards: Paradise
// covers the Heart Hotel and Top Gun parcels, Winchester covers the Strip
// frontage immediately north of them.
interface TabBoard {
  name: string;
  page: string;
  reason: string;
}
const BOARDS: TabBoard[] = [
  {
    name: 'Paradise Town Advisory Board',
    page: 'https://www.clarkcountynv.gov/government/departments/administrative_services/town___liaison_services/paradise-tab',
    reason: 'Heart Hotel (former SkyVue) and Top Gun (4815 S Las Vegas Blvd) parcels both sit in Paradise.',
  },
  {
    name: 'Winchester Town Advisory Board',
    page: 'https://www.clarkcountynv.gov/government/departments/administrative_services/town___liaison_services/winchester-tab',
    reason: 'Strip frontage north of the Paradise parcels; the Winchester/Paradise land use plan is shared.',
  },
];

interface TabDoc {
  url: string;
  fileName: string;
  kind: 'Agenda' | 'Minutes';
  dateIso: string;
}

// Parse the meeting date out of a published file name. The county writes the date
// as a trailing digit run: MMDDYY (Paradise-Agenda-071426.pdf) or MMDDYYYY
// (Paradise-Agenda-07282026.pdf). Anything else (a bylaws or roster PDF, or a
// typo'd 7-digit run) returns null and is skipped rather than guessed at.
export function tabDocDate(fileName: string): string | null {
  const runs = fileName.match(/\d{6,8}/g);
  if (!runs) return null;
  for (const run of runs) {
    let mm: number, dd: number, yyyy: number;
    if (run.length === 6) {
      mm = Number(run.slice(0, 2));
      dd = Number(run.slice(2, 4));
      yyyy = 2000 + Number(run.slice(4, 6));
    } else if (run.length === 8) {
      mm = Number(run.slice(0, 2));
      dd = Number(run.slice(2, 4));
      yyyy = Number(run.slice(4, 8));
    } else {
      continue;
    }
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || yyyy < 2000 || yyyy > 2100) continue;
    const d = new Date(Date.UTC(yyyy, mm - 1, dd));
    if (Number.isNaN(d.getTime())) continue;
    return d.toISOString();
  }
  return null;
}

// Every agenda / minutes PDF the board page links, newest first. Cancelled
// meetings (CANX in the file name) are skipped: they carry no items.
export function parseTabDocs(html: string, pageUrl: string): TabDoc[] {
  const out: TabDoc[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+\.pdf)["']/gi)) {
    let url: string;
    try {
      url = new URL(m[1], pageUrl).toString();
    } catch {
      continue;
    }
    if (seen.has(url)) continue;
    const fileName = decodeURIComponent(url.split('/').pop() ?? '');
    if (/canx|cancel/i.test(fileName)) continue;
    const kind = /minutes/i.test(fileName) ? 'Minutes' : /agenda/i.test(fileName) ? 'Agenda' : null;
    if (!kind) continue; // bylaws, rosters, boundary maps
    const dateIso = tabDocDate(fileName);
    if (!dateIso || Date.parse(dateIso) < SINCE) continue;
    seen.add(url);
    out.push({ url, fileName, kind, dateIso });
  }
  return out.sort((a, b) => Date.parse(b.dateIso) - Date.parse(a.dateIso));
}

export interface ClarkTabStats {
  docsListed: number;
  docsFetched: number;
  itemsKept: number;
  bypassHits: number;
  perBoard: Record<string, number>;
}
export const clarkTabStats: ClarkTabStats = {
  docsListed: 0,
  docsFetched: 0,
  itemsKept: 0,
  bypassHits: 0,
  perBoard: {},
};

// A TAB record is an advisory recommendation on a zoning/entitlement application,
// so its document type is Planning/Zoning Minutes either way (the agenda lists the
// applications to be heard; the minutes record the vote).
const TAB_SOURCE_TYPE: SourceType = 'Planning/Zoning Minutes';

async function scrapeBoard(board: TabBoard): Promise<NormalizedLead[]> {
  const html = await fetchText(board.page);
  if (!html) {
    console.warn(`Clark TAB: ${board.name} page unreachable; 0 leads.`);
    return [];
  }
  const docs = parseTabDocs(html, board.page).slice(0, MAX_DOCS_PER_BOARD);
  clarkTabStats.docsListed += docs.length;
  console.log(`Clark TAB: ${board.name} -> ${docs.length} agenda/minutes PDFs (2025+).`);

  const leads: NormalizedLead[] = [];
  for (const doc of docs) {
    const pages = await fetchPdfPages(doc.url);
    if (!pages) continue;
    clarkTabStats.docsFetched++;
    const meeting: MeetingRef = {
      jurisdictionLabel: CLARK,
      body: board.name,
      sourceType: TAB_SOURCE_TYPE,
      dateIso: doc.dateIso,
      agendaUrl: doc.url,
      source: SOURCE,
      // The agendaUrl IS the fetched PDF, so the primary document is real.
      hasPrimaryDocument: true,
    };
    const got = leadsFromAgendaText(meeting, pages.join('\n').replace(/\s+/g, ' ').trim());
    for (const l of got) {
      if (bypassesGate(`${l.title}\n${l.raw_content}`)) clarkTabStats.bypassHits++;
      leads.push(l);
    }
    clarkTabStats.perBoard[board.name] = (clarkTabStats.perBoard[board.name] ?? 0) + got.length;
  }
  return leads;
}

export async function scrapeClarkTabAgendas(): Promise<NormalizedLead[]> {
  const settled = await Promise.allSettled(BOARDS.map(scrapeBoard));
  const leads: NormalizedLead[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') leads.push(...r.value);
    else console.error('Clark TAB board rejected:', r.reason);
  }
  clarkTabStats.itemsKept = leads.length;
  console.log(
    `Clark TAB: ${clarkTabStats.docsFetched} of ${clarkTabStats.docsListed} documents parsed -> ` +
      `${leads.length} item/meeting leads across ${BOARDS.length} boards (${clarkTabStats.bypassHits} target bypass hits).`
  );
  return leads;
}
