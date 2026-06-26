// UNGM source (United Nations Global Marketplace, ungm.org).
//
// FRAGILE / best-effort but currently working. The public notice search
// (POST /Public/Notice/Search) returns server-rendered HTML table rows (no
// JSON). We parse rows for title, notice id, deadline, agency, and country.
// On any failure this logs and returns [] without throwing.

import type { NormalizedLead } from './types';

const SEARCH_URL = 'https://www.ungm.org/Public/Notice/Search';
const PAGE_SIZE = Number(process.env.UNGM_PAGE_SIZE ?? '50');
const MAX_PAGES = Number(process.env.UNGM_PAGES ?? '2');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

const clean = (s: string): string => decodeEntities(s).replace(/\s+/g, ' ').trim();

// UNGM deadlines look like "12-Jul-2026 17:00 (GMT 2.00)". Normalize the dashes
// and drop the trailing timezone note before parsing.
function parseDeadline(raw: string): string | null {
  const text = clean(raw).replace(/\(.*$/, '').trim().replace(/-/g, ' ');
  if (!text) return null;
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function fetchPage(pageIndex: number): Promise<string | null> {
  try {
    const res = await fetch(SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({
        PageIndex: pageIndex,
        PageSize: PAGE_SIZE,
        SortField: 'DatePublished',
        SortAscending: false,
      }),
    });
    if (!res.ok) {
      console.warn(`UNGM: page ${pageIndex} returned HTTP ${res.status}.`);
      return null;
    }
    return await res.text();
  } catch (error) {
    console.warn(`UNGM: page ${pageIndex} fetch failed (${String(error).slice(0, 80)}).`);
    return null;
  }
}

function parseRows(html: string, byUrl: Map<string, NormalizedLead>): void {
  const rowRe = /<div role="row" tabindex="0" data-noticeid="(\d+)" class="tableRow dataRow/g;
  const starts = [...html.matchAll(rowRe)];
  for (let i = 0; i < starts.length; i++) {
    const id = starts[i][1];
    const s = starts[i].index ?? 0;
    const e = i + 1 < starts.length ? (starts[i + 1].index ?? html.length) : html.length;
    const block = html.slice(s, e);

    const title = clean((block.match(/ungm-title ungm-title--small">([^<]+)<\/span>/) ?? [])[1] ?? '');
    if (!title) continue;

    const url = `https://www.ungm.org/Public/Notice/${id}`;
    if (byUrl.has(url)) continue;

    const deadlineRaw = (block.match(/deadline"[^>]*>\s*<span>([^<]+)</) ?? [])[1] ?? '';
    const agency = clean((block.match(/resultAgency">\s*<span>([^<]+)</) ?? [])[1] ?? '');
    // Plain table cells in order: published date, type, country. Country is last.
    const plainCells = [...block.matchAll(/<div role="cell" class="tableCell">\s*<span>([^<]+)</g)].map(
      (m) => clean(m[1])
    );
    const country = plainCells.length ? plainCells[plainCells.length - 1] : null;

    byUrl.set(url, {
      title,
      url,
      raw_content: [
        `UN tender: ${title}`,
        `Agency: ${agency || 'unknown'}`,
        `Country: ${country ?? ''}`,
        `Deadline: ${clean(deadlineRaw)}`,
      ].join('\n'),
      company: agency || null,
      location: country,
      deadline: parseDeadline(deadlineRaw),
      value_estimate: null,
      source: 'ungm',
    });
  }
}

export async function scrapeUngm(): Promise<NormalizedLead[]> {
  const byUrl = new Map<string, NormalizedLead>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const html = await fetchPage(page);
    if (!html) break;
    const before = byUrl.size;
    parseRows(html, byUrl);
    if (byUrl.size === before) break; // no new rows; stop paging
  }

  const leads = [...byUrl.values()];
  if (leads.length === 0) {
    console.warn('UNGM: no notice rows parsed (markup may have changed). 0 leads.');
  } else {
    console.log(`UNGM: ${leads.length} notices parsed across up to ${MAX_PAGES} pages`);
  }
  return leads;
}
