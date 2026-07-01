// UNDP procurement notices source.
//
// procurement-notices.undp.org server-renders its notice list as anchor "cards"
// (view_notice.cfm?notice_id=...), each with labelled cells: Title, Ref No, UNDP
// Office/Country, Process, Deadline, Posted. Keyless, no JS needed for the list.
// The feed is mixed (goods / works / consulting / grants); relevance is left to
// the orchestrator prefilter, which keeps the advisory/feasibility notices. On
// failure it logs and returns [] without throwing.

import type { NormalizedLead } from './types';

const HOME = process.env.UNDP_URL ?? 'https://procurement-notices.undp.org/';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// UNDP dates read "14-Aug-26". Build a UTC ISO string, or null if unparseable.
function parseUndpDate(s: string): string | null {
  const m = s.match(/(\d{1,2})-([A-Za-z]{3})-(\d{2})/);
  if (!m) return null;
  const mon = MONTHS[m[2].toLowerCase()];
  if (mon === undefined) return null;
  const d = new Date(Date.UTC(2000 + Number(m[3]), mon, Number(m[1])));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const strip = (s: string): string => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// Label -> value pairs from one notice card's cells.
function cells(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(
    /vacanciesTable__cell__label">\s*(.*?)\s*<\/div>\s*<span>(.*?)<\/span>/gis
  )) {
    const label = strip(m[1]);
    const value = strip(m[2]);
    if (label) out[label] = value;
  }
  return out;
}

export async function scrapeUndp(): Promise<NormalizedLead[]> {
  let html: string;
  try {
    const res = await fetch(HOME, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      console.warn(`UNDP: HTTP ${res.status}; skipping (0 leads).`);
      return [];
    }
    html = await res.text();
  } catch (error) {
    console.warn(`UNDP: fetch failed (${String(error).slice(0, 80)}); skipping (0 leads).`);
    return [];
  }

  const byUrl = new Map<string, NormalizedLead>();
  for (const m of html.matchAll(
    /<a\s+href="(view_notice\.cfm\?notice_id=\d+)"[^>]*vacanciesTableLink[^>]*>(.*?)<\/a>/gis
  )) {
    const link = `https://procurement-notices.undp.org/${m[1]}`;
    if (byUrl.has(link)) continue;
    const c = cells(m[2]);
    const title = c['Title'];
    if (!title) continue;
    // "UNDP Country Office/TOGO" -> TOGO
    const office = c['UNDP Office/Country'] ?? '';
    const country = office.includes('/') ? office.slice(office.lastIndexOf('/') + 1).trim() : office;
    byUrl.set(link, {
      title,
      url: link,
      raw_content: [
        `UNDP procurement notice: ${title}`,
        `Office/Country: ${office || 'n/a'}`,
        `Process: ${c['Process'] ?? 'n/a'}`,
        `Reference: ${c['Ref No'] ?? ''}`,
        `Deadline: ${c['Deadline'] ?? ''}`,
        `Posted: ${c['Posted'] ?? ''}`,
      ].join('\n'),
      company: null,
      location: country || null,
      deadline: parseUndpDate(c['Deadline'] ?? ''),
      value_estimate: null,
      source: 'undp',
    });
  }

  const leads = [...byUrl.values()];
  if (leads.length === 0) {
    console.warn('UNDP: no notice cards parsed (markup changed or JS-rendered). Skipping (0 leads).');
  } else {
    console.log(`UNDP: ${leads.length} procurement notices`);
  }
  return leads;
}
