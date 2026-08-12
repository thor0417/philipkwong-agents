// Shared helpers for municipal agenda portals (Part B Anaheim / Granicus, Part C
// Las Vegas / PrimeGov) plus the Anaheim adapter. A municipal agenda is fetched,
// reduced to text, and split into individual numbered agenda items; each item that
// passes the government gate or a target bypass term becomes its own government
// lead with the meeting date, the source_type, and a link to the agenda with an
// item reference in raw_content. When an agenda resists clean item splitting, the
// meeting agenda itself is captured as one lead (honestly, per the brief).
//
// On any single-meeting failure this logs and continues, never crashing the run.

import { createHash } from 'node:crypto';
import type { NormalizedLead } from './types';
import type { SourceType } from '../../../lib/taxonomy';
import { bypassHits, bypassesGate } from '../targets';
import { gateDecide, admissionLabel } from '../gate-decide';
import { fetchPdfPages } from './pdf-agenda';
import { GranicusMeetingSchema, parseRecords } from './schemas';

const UA = 'Mozilla/5.0 (compatible; philipkwong-agents/1.0 +scraper)';
const FETCH_TIMEOUT_MS = 45000;
const ITEM_EXCERPT_CHARS = 2600;
const MAX_ITEMS_PER_MEETING = 40;

// fetch and HTML-to-text now live in ./http, one implementation for every
// adapter. Re-exported here so the existing imports across the agenda lanes keep
// working and nothing had to be touched to move them.
export { fetchText, htmlToText } from './http';
import { fetchText, htmlToText } from './http';

export interface AgendaItem {
  seq: number; // running 1-based index across the whole agenda (unique)
  num: string; // the printed item number (may restart per section)
  text: string; // the item's full text, bounded (kept for raw_content)
  subject: string; // the item's own subject line, which is what the gate judges
}

// Split agenda text into numbered items. Markers are `N. ` where N is a small
// integer at a token boundary; a segment runs to the next marker. Section headers
// restart numbering, so the running seq (not the printed number) keys uniqueness.
//
// Some agendas number their hearings `ITEM NO. 1` with no trailing period on the
// number (Anaheim's Planning Commission is the case that surfaced this), which
// the bare `N.` marker cannot see. Those markers are tried FIRST and, when the
// document uses them, they alone define the split: an agenda written that way
// carries stray `N.` sequences in its boilerplate that would fragment it.
const ITEM_NO_RE = /\bITEM\s+NO\.?\s*(\d{1,3})[.:]?\s+(?=[A-Z(])/g;

// The bare `N.` marker. The lookahead accepts a DIGIT as well as a capital,
// which is the boundary bug this replaced: Las Vegas numbers its items
// "31. 24-0653 - APPLICANT/OWNER: ...", where the case number after the item
// number starts with a digit. The old lookahead required [A-Z(], so every such
// marker was invisible and the preceding item swallowed its neighbours until it
// hit the 2,600-character cap. Measured on the stored corpus: 28 of 95 Las Vegas
// items and 19 of 82 Anaheim items were sitting at that cap.
//
// `\.\s+` still requires whitespace after the dot, so "1.34 acres" and
// "APN 125-21-101" cannot be read as markers.
const NUMBERED_RE = /(?:^|[\s;:.)])(\d{1,3})\.\s+(?=[A-Z0-9(])/g;

// Agenda item numbers ascend. Keeping only a monotonically increasing run from
// the first marker rejects the stray "2." that appears inside a body ("1) expand
// the district; 2. the parking garage") without needing to understand the prose.
function monotonic(marks: { num: string; start: number }[]): { num: string; start: number }[] {
  const kept: { num: string; start: number }[] = [];
  let last = -Infinity;
  for (const mark of marks) {
    const n = parseInt(mark.num, 10);
    if (n <= last) continue;
    kept.push(mark);
    last = n;
  }
  return kept;
}

export function splitNumberedAgenda(text: string): AgendaItem[] {
  const marks: { num: string; start: number }[] = [];
  let m: RegExpExecArray | null;
  ITEM_NO_RE.lastIndex = 0;
  while ((m = ITEM_NO_RE.exec(text)) !== null) {
    marks.push({ num: m[1], start: m.index });
  }
  if (marks.length === 0) {
    NUMBERED_RE.lastIndex = 0;
    while ((m = NUMBERED_RE.exec(text)) !== null) {
      const num = parseInt(m[1], 10);
      if (num < 1 || num > 80) continue;
      marks.push({ num: m[1], start: m.index + m[0].indexOf(m[1]) });
    }
  }
  const bounded = monotonic(marks);
  const items: AgendaItem[] = [];
  for (let i = 0; i < bounded.length; i++) {
    const start = bounded[i].start;
    const end = i + 1 < bounded.length ? bounded[i + 1].start : text.length;
    const body = text.slice(start, end).replace(/\s+/g, ' ').trim();
    if (body.length < 25) continue;
    items.push({
      seq: items.length + 1,
      num: bounded[i].num,
      text: body.slice(0, ITEM_EXCERPT_CHARS),
      subject: itemSubject(body),
    });
  }
  return items;
}

// ---- SUBJECT vs BODY --------------------------------------------------------
// The gate judges an item on its own SUBJECT. The body stays in raw_content, so
// player extraction, contacts, and the report detail lose nothing.
//
// The subject ends where the item stops describing itself and starts carrying
// process: the attachment list, the staff recommendation, the standing
// departmental boilerplate. Those phrases are the same on every item in a
// packet, which is exactly why a leisure term inside them is not evidence about
// THIS item.
const BODY_STARTS = [
  'Agenda Summary Page',
  'Location and Aerial Maps',
  'Conditions and Staff Report',
  'Supporting Documentation',
  'Staff recommends',
  'Staff Recommendation',
  'Recommendation:',
  'RECOMMENDATION',
  'BACKGROUND',
  'Background:',
  'Fiscal Impact',
  'FISCAL IMPACT',
  'Environmental Determination',
  'Resolution No.',
  'Attachment 1',
  'Project Planner',
  'COMMUNITY DEVELOPMENT',
  'The items listed below',
  'All items listed on the Consent Agenda',
];

// A subject is capped so a document with no boilerplate marker still cannot hand
// the gate a whole page. 600 characters comfortably holds the longest real
// subject seen in the corpus (Clark County's multi-clause use permits).
const SUBJECT_MAX_CHARS = 600;

export function itemSubject(itemText: string): string {
  let end = itemText.length;
  for (const marker of BODY_STARTS) {
    const i = itemText.indexOf(marker);
    if (i > 0 && i < end) end = i;
  }
  return itemText.slice(0, Math.min(end, SUBJECT_MAX_CHARS)).trim();
}

// ---- STABLE ITEM IDENTITY ---------------------------------------------------
// An item's URL is its primary key (leads.url is unique, and every write path
// upserts on it). Keying it on the parse ordinal made the identity a property of
// the PARSER rather than of the item: re-split the same document a little
// differently and item 4 becomes item 2, the upsert misses, and the same hearing
// lands twice. Measured on the stored corpus, that produced 5 redundant
// clark-tab rows across 5 Winchester agendas.
//
// The key is now derived from the item's own content:
//   1. Its case identifiers, when it prints any. A Clark County waiver is
//      WS-25-0901 in the agenda, in the minutes, and in every later filing; that
//      is the closest thing to a real identifier these documents carry.
//   2. Otherwise a hash of the normalised subject.
// Both survive a boundary shift. Neither survives a genuinely different item,
// which is the point.

// Deliberately narrow: two-to-four letters, a two-digit year, then a serial.
// Month abbreviations are excluded because "MAR-25-2026" is a date, not a case.
const CASE_ID_RE = /\b([A-Z]{2,4})-(\d{2})-(\d{3,7})\b/g;
const MONTH_ABBR = new Set(['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'SEPT', 'OCT', 'NOV', 'DEC']);

export function itemCaseIds(title: string): string[] {
  const out = new Set<string>();
  for (const m of title.toUpperCase().matchAll(CASE_ID_RE)) {
    if (MONTH_ABBR.has(m[1])) continue;
    out.add(`${m[1]}-${m[2]}-${m[3]}`);
  }
  return [...out].sort();
}

// The key MUST be computable from the stored row alone, so that a migration can
// reproduce exactly what the scraper will next write. It therefore reads the
// title (which is the subject, whitespace-collapsed and capped at 200) and
// nothing else.
export function stableItemKey(title: string): string {
  const ids = itemCaseIds(title);
  if (ids.length) return ids.join('+').toLowerCase();
  const norm = title.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return `h${createHash('sha1').update(norm).digest('hex').slice(0, 12)}`;
}

export interface MeetingRef {
  jurisdictionLabel: string;
  body: string; // 'City Council' | 'Planning Commission' | a named advisory board
  sourceType: SourceType;
  dateIso: string | null;
  agendaUrl: string;
  // Adapter tag written to the lead's source column. Defaults to 'agenda-portal'
  // (Anaheim / Las Vegas); a portal with its own identity sets its own.
  source?: string;
  // True when agendaUrl is itself the fetched primary document (a PDF agenda),
  // rather than a portal page that merely displays one.
  hasPrimaryDocument?: boolean;
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
    source: meeting.source ?? 'agenda-portal',
    source_type: meeting.sourceType,
    primary_document_url: meeting.agendaUrl,
    has_primary_document: meeting.hasPrimaryDocument ?? false,
    published_date: meeting.dateIso,
  };

  let kept = 0;
  // Two segments of one document can reduce to the same item identity when the
  // splitter cuts a long item twice. They are one item, so the longer text wins
  // rather than whichever happened to be upserted last.
  const byKey = new Map<string, number>();
  for (const it of items) {
    if (kept >= MAX_ITEMS_PER_MEETING) break;
    // THE GATE JUDGES THE SUBJECT. Its own subject, not its neighbours' text and
    // not the standing boilerplate every item in the packet carries.
    //
    // The WATCH-TERM BYPASS still reads the whole item. The two are different
    // decisions: the gate is a relevance judgement, where borrowed context is a
    // false positive, while a bypass term is a named target we have decided to
    // capture wherever it appears. A watch term in an item's body is still that
    // target showing up in this meeting.
    //
    // Both decisions route through gateDecide, so this lane and the measurement
    // harness apply one rule and every candidate is recorded during a gate audit.
    const title = it.subject.replace(/\s+/g, ' ').trim().slice(0, 200);
    const key = stableItemKey(title);
    const decision = gateDecide({
      source: base.source,
      market: meeting.jurisdictionLabel,
      key: `${meeting.agendaUrl}#item-${key}`,
      title,
      gate_text: it.subject,
      bypass_text: it.text,
      bypass_mode: 'all',
    });
    if (!decision.admitted) continue;
    const hitLine = targetHitLine(it.subject);
    const lead: NormalizedLead = {
      ...base,
      title,
      url: `${meeting.agendaUrl}#item-${key}`,
      raw_content: [
        `${meeting.body} agenda item ${it.num} - ${meeting.jurisdictionLabel}`,
        `Meeting date: ${meeting.dateIso ?? '(unknown)'}`,
        `Source type: ${meeting.sourceType}`,
        `Agenda: ${meeting.agendaUrl} (item ${it.num})`,
        `Gate: ${admissionLabel(decision)}`,
        hitLine,
        `\n--- item text ---\n${it.text}`,
      ]
        .filter(Boolean)
        .join('\n'),
    };
    const at = byKey.get(key);
    if (at !== undefined) {
      if ((lead.raw_content ?? '').length > (leads[at].raw_content ?? '').length) leads[at] = lead;
      continue;
    }
    kept++;
    byKey.set(key, leads.length);
    leads.push(lead);
  }

  // Fallback: agenda did not split into gated items but the meeting as a whole is
  // relevant (gate or target). Capture the meeting agenda itself as one lead.
  if (leads.length === 0) {
    const whole = text.slice(0, 6000);
    const meetingDecision = gateDecide({
      source: base.source,
      market: meeting.jurisdictionLabel,
      key: meeting.agendaUrl,
      title: `${meeting.body} Agenda - ${meeting.dateIso ?? 'undated'} (${meeting.jurisdictionLabel})`.slice(0, 200),
      gate_text: whole,
      bypass_mode: 'all',
    });
    if (meetingDecision.admitted) {
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
// view_id=2, one <tr> per meeting: Name (body), Date, and Agenda / Minutes
// links (AgendaViewer.php, MinutesViewer.php). Fully fetchable; no browser.
//
// REGRESSION FIXED (2026-07-27). Granicus stopped serving the agenda inline.
// AgendaViewer.php and MinutesViewer.php now 302 to one of four places, and only
// two of them are documents this runtime can actually read:
//   anaheim.granicus.com/DocumentViewer.php?file=...pdf  - reachable PDF, via a
//       docs.google.com/gview wrapper whose `url=` parameter holds the real link
//   www.anaheim.net/DocumentCenter|AgendaCenter/...      - reachable PDF
//   local.anaheim.net/docs_agend/...Agenda.html          - connection times out
//   records.anaheim.net/CityClerk/DocView.aspx           - connection times out
// The lane previously followed the redirect blind, landed on a 13 KB JavaScript
// shell or an unreachable host, reduced it to "DocumentViewer.php Loading..."
// (34 characters), and wrote nothing while reporting agendas as fetched.
//
// So a meeting is now resolved through EVERY viewer link it publishes, in order,
// until one yields items: the redirect is read manually, a gview wrapper is
// unwrapped, PDFs are parsed as PDFs, HTML is still handled as before, and a
// host that cannot be reached is counted and logged rather than silently
// producing an empty agenda.

const ANAHEIM = 'Anaheim, CA';
const ANAHEIM_VIEWPUBLISHER = 'https://anaheim.granicus.com/ViewPublisher.php?view_id=2';
const ANAHEIM_SINCE = Date.parse('2025-01-01');

function bodySourceType(body: string): SourceType {
  return /planning/i.test(body) ? 'Planning/Zoning Minutes' : 'Council Agenda';
}

// A meeting plus every viewer link its row publishes (agenda first, then
// minutes). The agendaUrl stays the citizen-facing viewer link until a document
// resolves, at which point the resolved document URL replaces it.
export interface AnaheimMeeting extends MeetingRef {
  viewerUrls: string[];
}

// Parse the Granicus meeting table into meeting refs (Council + Planning, 2025+).
// The page carries two row shapes: an "upcoming" table (cells tagged
// headers="Name"/"Date") and the large archived listing (plain <td> cells). This
// reads both by scanning each <tr> for a body name, a date, and viewer links.
export function parseAnaheimMeetings(html: string): AnaheimMeeting[] {
  const rows = html.split(/<tr[\s>]/i).slice(1);
  const out: AnaheimMeeting[] = [];
  const seen = new Set<string>();
  const abs = (u: string): string => (u.startsWith('//') ? 'https:' + u : u);
  for (const row of rows) {
    const agM = row.match(/href="([^"]*AgendaViewer\.php[^"]*)"/i);
    if (!agM) continue;
    const bodyM = row.match(/>\s*(City Council|Planning Commission)[^<]*</i);
    if (!bodyM) continue;
    const body = bodyM[1].replace(/\s+/g, ' ').trim();
    const dateM = row.match(/>\s*([A-Za-z]{3,9} \d{1,2}, \d{4})/);
    const dateIso = dateM ? new Date(dateM[1]).toISOString() : null;
    if (!dateIso || Number.isNaN(Date.parse(dateIso)) || Date.parse(dateIso) < ANAHEIM_SINCE) continue;
    const agendaUrl = abs(agM[1]);
    if (seen.has(agendaUrl)) continue;
    seen.add(agendaUrl);
    // Agenda first (the meeting's own document), then every minutes link on the
    // row: when the agenda resolves to an unreachable host, the minutes are the
    // same meeting's record and are usually on a host that answers.
    const minutes = [...row.matchAll(/href="([^"]*MinutesViewer\.php[^"]*)"/gi)].map((m) => abs(m[1]));
    out.push({
      jurisdictionLabel: ANAHEIM,
      body: /planning/i.test(body) ? 'Planning Commission' : 'City Council',
      sourceType: bodySourceType(body),
      dateIso,
      agendaUrl,
      viewerUrls: [agendaUrl, ...new Set(minutes)],
    });
  }
  // Granicus serves HTML, so the boundary is the PARSED row. Validating it
  // catches the failure that actually happened here: a listing that still
  // returns rows but no longer yields a usable agenda link or a parseable date.
  const checked = parseRecords(
    GranicusMeetingSchema,
    out.map((m) => ({ body: m.body, dateIso: m.dateIso, agendaUrl: m.agendaUrl, viewerUrls: m.viewerUrls })),
    { source: 'granicus:anaheim', endpoint: 'ViewPublisher view_id=2' }
  ).records;
  const valid = new Set(checked.map((c) => c.agendaUrl));
  return out.filter((m) => valid.has(m.agendaUrl));
}

// The document a Granicus viewer link actually points at. The viewer 302s; when
// the target is a docs.google.com/gview wrapper, the real document is its `url`
// parameter. Returns null when the viewer does not redirect at all.
export async function resolveViewerDocument(viewerUrl: string): Promise<string | null> {
  try {
    const res = await fetch(viewerUrl, {
      headers: { 'User-Agent': UA },
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const loc = res.headers.get('location');
    if (!loc) return null;
    const wrapped = loc.match(/[?&]url=([^&]+)/);
    return wrapped ? decodeURIComponent(wrapped[1]) : loc;
  } catch (error) {
    console.warn(`Agenda portal: viewer redirect failed for ${viewerUrl} (${String(error).slice(0, 60)}).`);
    return null;
  }
}

// Fetch a resolved document and reduce it to text, whether it is a PDF or HTML.
// Returns null when the host is unreachable or the document will not parse.
async function documentText(url: string): Promise<string | null> {
  if (/\.pdf(\?|$)/i.test(url) || /DocumentViewer\.php/i.test(url) || /DocumentCenter|AgendaCenter/i.test(url)) {
    const pages = await fetchPdfPages(url);
    if (!pages || pages.length === 0) return null;
    return pages.join('\n').replace(/\s+/g, ' ').trim();
  }
  const html = await fetchText(url);
  return html ? htmlToText(html) : null;
}

// Anaheim publishes a Spanish translation of the same agenda alongside the
// English one. The government gate is English, so a Spanish document under-gates
// its own meeting; it is used only when nothing else for that meeting resolves.
function isSpanish(text: string): boolean {
  return /ORDEN\s+DEL\s+D[IÍ]A|AYUNTAMIENTO/i.test(text.slice(0, 4000));
}

export interface AgendaPortalStats {
  meetingsListed: number;
  meetingsFetched: number;
  itemsKept: number;
  bypassHits: number;
  // Meetings whose every published document sits on a host this runtime cannot
  // reach. Counted and reported, never mistaken for a meeting with no items.
  meetingsUnreachable: number;
  // Documents read, by host, so a host going dark is visible in the run report.
  perDocumentHost: Record<string, number>;
}
export const anaheimStats: AgendaPortalStats = {
  meetingsListed: 0,
  meetingsFetched: 0,
  itemsKept: 0,
  bypassHits: 0,
  meetingsUnreachable: 0,
  perDocumentHost: {},
};

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
      // Try every viewer link the row published until one yields items. A
      // Spanish duplicate is held back and used only if nothing else resolves.
      let spanish: { url: string; text: string } | null = null;
      let got: NormalizedLead[] = [];
      let read = false;
      for (const viewer of meeting.viewerUrls) {
        const docUrl = (await resolveViewerDocument(viewer)) ?? viewer;
        const text = await documentText(docUrl);
        if (!text || text.length < 200) continue;
        read = true;
        const host = (() => {
          try {
            return new URL(docUrl).hostname;
          } catch {
            return '(unparseable)';
          }
        })();
        anaheimStats.perDocumentHost[host] = (anaheimStats.perDocumentHost[host] ?? 0) + 1;
        if (isSpanish(text)) {
          spanish ??= { url: docUrl, text };
          continue;
        }
        got = leadsFromAgendaText({ ...meeting, agendaUrl: docUrl, hasPrimaryDocument: true }, text);
        if (got.length > 0) break;
      }
      if (got.length === 0 && spanish) {
        got = leadsFromAgendaText({ ...meeting, agendaUrl: spanish.url, hasPrimaryDocument: true }, spanish.text);
      }
      if (!read) {
        anaheimStats.meetingsUnreachable++;
        continue;
      }
      anaheimStats.meetingsFetched++;
      for (const l of got) {
        if (bypassesGate(`${l.title}\n${l.raw_content}`)) anaheimStats.bypassHits++;
        leads.push(l);
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  anaheimStats.itemsKept = leads.length;
  console.log(
    `Anaheim: ${anaheimStats.meetingsFetched} meetings read, ${anaheimStats.meetingsUnreachable} with no reachable document ` +
      `-> ${leads.length} item/meeting leads (${anaheimStats.bypassHits} with a target bypass hit).`
  );
  console.log(`Anaheim documents read by host: ${JSON.stringify(anaheimStats.perDocumentHost)}`);
  return leads;
}
