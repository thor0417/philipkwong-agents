// Shared helpers for municipal agenda portals (Part B Anaheim / Granicus, Part C
// Las Vegas / PrimeGov) plus the Anaheim adapter. A municipal agenda is fetched,
// reduced to text, and split into individual numbered agenda items; each item that
// passes the government gate or a target bypass term becomes its own government
// lead with the meeting date, the source_type, and a link to the agenda with an
// item reference in raw_content. When an agenda resists clean item splitting, the
// meeting agenda itself is captured as one lead (honestly, per the brief).
//
// On any single-meeting failure this logs and continues, never crashing the run.

import type { NormalizedLead } from './types';
import type { SourceType } from '../../../lib/taxonomy';
import { governmentGate } from '../../../lib/taxonomy';
import { bypassHits, bypassesGate } from '../targets';

const UA = 'Mozilla/5.0 (compatible; philipkwong-agents/1.0 +scraper)';
const FETCH_TIMEOUT_MS = 45000;
const ITEM_EXCERPT_CHARS = 2600;
const MAX_ITEMS_PER_MEETING = 40;

export async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/json,*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`Agenda portal: ${url} -> HTTP ${res.status}, skipped.`);
      return null;
    }
    return await res.text();
  } catch (error) {
    console.warn(`Agenda portal: fetch failed for ${url} (${String(error).slice(0, 70)}).`);
    return null;
  }
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;|&#8216;|&rsquo;|&lsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#9654;/g, ' ')
    .replace(/&#8212;|&#8211;|&mdash;|&ndash;/g, '-')
    .replace(/&#\d+;/g, ' ')
    // Drop control / replacement characters (Word-export smart punctuation that
    // decoded as U+FFFD) and collapse dot-leaders so titles read cleanly.
    .replace(/[\u0000-\u001F\u007F-\u009F\uFFFD]/g, ' ')
    .replace(/\.{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface AgendaItem {
  seq: number; // running 1-based index across the whole agenda (unique)
  num: string; // the printed item number (may restart per section)
  text: string; // the item's text, bounded
}

// Split agenda text into numbered items. Markers are `N. ` where N is a small
// integer at a token boundary; a segment runs to the next marker. Section headers
// restart numbering, so the running seq (not the printed number) keys uniqueness.
export function splitNumberedAgenda(text: string): AgendaItem[] {
  const re = /(?:^|[\s;:.)])(\d{1,3})\.\s+(?=[A-Z(])/g;
  const marks: { num: string; start: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const num = parseInt(m[1], 10);
    if (num < 1 || num > 80) continue;
    marks.push({ num: m[1], start: m.index + m[0].indexOf(m[1]) });
  }
  const items: AgendaItem[] = [];
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].start;
    const end = i + 1 < marks.length ? marks[i + 1].start : text.length;
    const body = text.slice(start, end).replace(/\s+/g, ' ').trim();
    if (body.length < 25) continue;
    items.push({ seq: items.length + 1, num: marks[i].num, text: body.slice(0, ITEM_EXCERPT_CHARS) });
  }
  return items;
}

export interface MeetingRef {
  jurisdictionLabel: string;
  body: string; // 'City Council' | 'Planning Commission'
  sourceType: SourceType;
  dateIso: string | null;
  agendaUrl: string;
}

function targetHitLine(text: string): string {
  const hits = bypassHits(text);
  if (!hits.length) return '';
  return `Target-term hits: ${[...new Set(hits.map((h) => h.term))].join(', ')}`;
}

// Build the item/meeting leads for one meeting agenda already fetched to text.
export function leadsFromAgendaText(meeting: MeetingRef, text: string): NormalizedLead[] {
  const items = splitNumberedAgenda(text);
  const leads: NormalizedLead[] = [];
  const base = {
    company: meeting.jurisdictionLabel,
    location: meeting.jurisdictionLabel,
    deadline: null,
    value_estimate: null,
    source: 'agenda-portal',
    source_type: meeting.sourceType,
    primary_document_url: meeting.agendaUrl,
    has_primary_document: false as boolean,
    published_date: meeting.dateIso,
  };

  let kept = 0;
  for (const it of items) {
    if (kept >= MAX_ITEMS_PER_MEETING) break;
    const verdict = governmentGate(it.text);
    const bypass = bypassesGate(it.text);
    if (!verdict.matched && !bypass) continue;
    kept++;
    const title = it.text.replace(/\s+/g, ' ').trim().slice(0, 200);
    const hitLine = targetHitLine(it.text);
    leads.push({
      ...base,
      title,
      url: `${meeting.agendaUrl}#item-${it.seq}`,
      raw_content: [
        `${meeting.body} agenda item ${it.num} - ${meeting.jurisdictionLabel}`,
        `Meeting date: ${meeting.dateIso ?? '(unknown)'}`,
        `Source type: ${meeting.sourceType}`,
        `Agenda: ${meeting.agendaUrl} (item ${it.seq})`,
        `Gate: ${bypass ? 'bypass' : verdict.reason}`,
        hitLine,
        `\n--- item text ---\n${it.text}`,
      ]
        .filter(Boolean)
        .join('\n'),
    });
  }

  // Fallback: agenda did not split into gated items but the meeting as a whole is
  // relevant (gate or target). Capture the meeting agenda itself as one lead.
  if (leads.length === 0) {
    const whole = text.slice(0, 6000);
    if (governmentGate(whole).matched || bypassesGate(whole)) {
      const hitLine = targetHitLine(whole);
      leads.push({
        ...base,
        title: `${meeting.body} Agenda - ${meeting.dateIso ?? 'undated'} (${meeting.jurisdictionLabel})`.slice(0, 200),
        url: meeting.agendaUrl,
        raw_content: [
          `${meeting.body} agenda - ${meeting.jurisdictionLabel}`,
          `Meeting date: ${meeting.dateIso ?? '(unknown)'}`,
          `Source type: ${meeting.sourceType}`,
          `Agenda: ${meeting.agendaUrl}`,
          `Capture: meeting-level (agenda did not split into individual gated items)`,
          hitLine,
          `\n--- agenda excerpt ---\n${whole}`,
        ]
          .filter(Boolean)
          .join('\n'),
      });
    }
  }
  return leads;
}

// ---- Part B: Anaheim (Granicus) --------------------------------------------
// Anaheim City Council + Planning Commission both publish through Granicus
// view_id=2, one <tr> per meeting: Name (body), Date, and an Agenda link
// (AgendaViewer.php?view_id=2&event_id=NNNN). Fully fetchable; no browser.

const ANAHEIM = 'Anaheim, CA';
const ANAHEIM_VIEWPUBLISHER = 'https://anaheim.granicus.com/ViewPublisher.php?view_id=2';
const ANAHEIM_SINCE = Date.parse('2025-01-01');

function bodySourceType(body: string): SourceType {
  return /planning/i.test(body) ? 'Planning/Zoning Minutes' : 'Council Agenda';
}

// Parse the Granicus meeting table into meeting refs (Council + Planning, 2025+).
// The page carries two row shapes: an "upcoming" table (cells tagged
// headers="Name"/"Date") and the large archived listing (plain <td> cells). This
// reads both by scanning each <tr> for a body name, a date, and an Agenda link.
export function parseAnaheimMeetings(html: string): MeetingRef[] {
  const rows = html.split(/<tr[\s>]/i).slice(1);
  const out: MeetingRef[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const agM = row.match(/href="([^"]*AgendaViewer\.php[^"]*)"/i);
    if (!agM) continue;
    const bodyM = row.match(/>\s*(City Council|Planning Commission)[^<]*</i);
    if (!bodyM) continue;
    const body = bodyM[1].replace(/\s+/g, ' ').trim();
    const dateM = row.match(/>\s*([A-Za-z]{3,9} \d{1,2}, \d{4})/);
    const dateIso = dateM ? new Date(dateM[1]).toISOString() : null;
    if (!dateIso || Number.isNaN(Date.parse(dateIso)) || Date.parse(dateIso) < ANAHEIM_SINCE) continue;
    let agendaUrl = agM[1];
    if (agendaUrl.startsWith('//')) agendaUrl = 'https:' + agendaUrl;
    if (seen.has(agendaUrl)) continue;
    seen.add(agendaUrl);
    out.push({
      jurisdictionLabel: ANAHEIM,
      body: /planning/i.test(body) ? 'Planning Commission' : 'City Council',
      sourceType: bodySourceType(body),
      dateIso,
      agendaUrl,
    });
  }
  return out;
}

export interface AgendaPortalStats {
  meetingsListed: number;
  meetingsFetched: number;
  itemsKept: number;
  bypassHits: number;
}
export const anaheimStats: AgendaPortalStats = { meetingsListed: 0, meetingsFetched: 0, itemsKept: 0, bypassHits: 0 };

export async function scrapeAnaheimAgendas(): Promise<NormalizedLead[]> {
  const listing = await fetchText(ANAHEIM_VIEWPUBLISHER);
  if (!listing) {
    console.warn('Anaheim: Granicus ViewPublisher unreachable; 0 leads.');
    return [];
  }
  const meetings = parseAnaheimMeetings(listing);
  anaheimStats.meetingsListed = meetings.length;
  console.log(`Anaheim: ${meetings.length} Council/Planning meetings listed (2025+) on Granicus.`);

  const leads: NormalizedLead[] = [];
  // Bounded concurrency to be polite to the portal.
  const CONC = 4;
  let next = 0;
  async function worker(): Promise<void> {
    while (next < meetings.length) {
      const meeting = meetings[next++];
      const html = await fetchText(meeting.agendaUrl);
      if (!html) continue;
      anaheimStats.meetingsFetched++;
      const text = htmlToText(html);
      const got = leadsFromAgendaText(meeting, text);
      for (const l of got) {
        if (bypassesGate(`${l.title}\n${l.raw_content}`)) anaheimStats.bypassHits++;
        leads.push(l);
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  anaheimStats.itemsKept = leads.length;
  console.log(
    `Anaheim: ${anaheimStats.meetingsFetched} agendas fetched -> ${leads.length} item/meeting leads (${anaheimStats.bypassHits} with a target bypass hit).`
  );
  return leads;
}
