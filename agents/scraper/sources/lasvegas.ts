// Part C: City of Las Vegas (NV) agenda capture. Las Vegas publishes through
// PrimeGov, whose public JSON API lists meetings per year and exposes each
// meeting's HTML agenda by template id -- both fetchable with a plain HTTP GET, no
// browser. City Council + Planning Commission agendas 2025 to present are split
// into individual items and gated exactly like the Anaheim lane (shared
// agenda-portal helpers). Top Gun is EXPECTED to be absent: the attraction
// relocated OUT of the city to unincorporated Clark County (4815 S Las Vegas Blvd
// at Russell Road), so it is captured through the Clark County Legistar lane, not
// here. Zero city Top Gun hits is the correct result, not a failure.
//
// On any single-meeting failure this logs and continues.

import type { NormalizedLead } from './types';
import type { SourceType } from '../../../lib/taxonomy';
import { fetchText, htmlToText, leadsFromAgendaText, type MeetingRef } from './agenda-portal';
import { bypassesGate } from '../targets';

const UA = 'Mozilla/5.0 (compatible; philipkwong-agents/1.0 +scraper)';
const LV = 'Las Vegas, NV';
const API = 'https://lasvegas.primegov.com/api/v2/PublicPortal';
const HTML_AGENDA = (templateId: number): string =>
  `https://lasvegas.primegov.com/Portal/Meeting?meetingTemplateId=${templateId}`;
const YEARS = [2025, 2026];
const BODIES = /^(city council|planning commission)/i;

interface PrimeGovDoc {
  templateId: number;
  templateName: string;
  compileOutputType: number;
}
interface PrimeGovMeeting {
  id: number;
  title: string;
  dateTime: string | null;
  date: string | null;
  documentList: PrimeGovDoc[];
}

async function listYear(year: number): Promise<PrimeGovMeeting[]> {
  try {
    const res = await fetch(`${API}/ListArchivedMeetings?year=${year}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) {
      console.warn(`Las Vegas: ListArchivedMeetings ${year} -> HTTP ${res.status}.`);
      return [];
    }
    const data = (await res.json()) as unknown;
    return Array.isArray(data) ? (data as PrimeGovMeeting[]) : [];
  } catch (error) {
    console.warn(`Las Vegas: list ${year} failed (${String(error).slice(0, 70)}).`);
    return [];
  }
}

// Pick the meeting's HTML-agenda template id: prefer the "HTML Agenda" document,
// then any agenda document. Returns null when the meeting has no agenda doc.
function agendaTemplateId(m: PrimeGovMeeting): number | null {
  const docs = m.documentList ?? [];
  const html = docs.find((d) => /html agenda/i.test(d.templateName));
  if (html) return html.templateId;
  const any = docs.find((d) => /agenda/i.test(d.templateName));
  return any ? any.templateId : null;
}

function sourceTypeFor(title: string): SourceType {
  return /planning/i.test(title) ? 'Planning/Zoning Minutes' : 'Council Agenda';
}

export interface LasVegasStats {
  meetingsListed: number;
  meetingsFetched: number;
  itemsKept: number;
  bypassHits: number;
}
export const lasVegasStats: LasVegasStats = { meetingsListed: 0, meetingsFetched: 0, itemsKept: 0, bypassHits: 0 };

export async function scrapeLasVegasAgendas(): Promise<NormalizedLead[]> {
  const meetings: PrimeGovMeeting[] = [];
  for (const y of YEARS) meetings.push(...(await listYear(y)));
  const relevant: MeetingRef[] = [];
  for (const m of meetings) {
    if (!BODIES.test(m.title ?? '')) continue;
    const tid = agendaTemplateId(m);
    if (tid == null) continue;
    const iso = m.dateTime ? new Date(m.dateTime).toISOString() : m.date ? new Date(m.date).toISOString() : null;
    if (!iso || Number.isNaN(Date.parse(iso))) continue;
    relevant.push({
      jurisdictionLabel: LV,
      body: /planning/i.test(m.title) ? 'Planning Commission' : 'City Council',
      sourceType: sourceTypeFor(m.title),
      dateIso: iso,
      agendaUrl: HTML_AGENDA(tid),
    });
  }
  lasVegasStats.meetingsListed = relevant.length;
  const councils = relevant.filter((r) => r.body === 'City Council').length;
  console.log(
    `Las Vegas: ${relevant.length} Council/Planning meetings listed 2025+ on PrimeGov (${councils} council, ${relevant.length - councils} planning).`
  );

  const leads: NormalizedLead[] = [];
  const CONC = 4;
  let next = 0;
  async function worker(): Promise<void> {
    while (next < relevant.length) {
      const meeting = relevant[next++];
      const html = await fetchText(meeting.agendaUrl);
      if (!html) continue;
      lasVegasStats.meetingsFetched++;
      const got = leadsFromAgendaText(meeting, htmlToText(html));
      for (const l of got) {
        if (bypassesGate(`${l.title}\n${l.raw_content}`)) lasVegasStats.bypassHits++;
        leads.push(l);
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  lasVegasStats.itemsKept = leads.length;
  console.log(
    `Las Vegas: ${lasVegasStats.meetingsFetched} agendas fetched -> ${leads.length} item/meeting leads (${lasVegasStats.bypassHits} target bypass hits; Top Gun expected 0 in-city).`
  );
  return leads;
}
