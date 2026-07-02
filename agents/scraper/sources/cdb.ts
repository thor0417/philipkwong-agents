// Caribbean Development Bank (CDB) procurement notices source — parseable.
//
// No procurement JSON/RSS/OCDS feed exists, but the procurement-notices listing
// is plain server-rendered HTML (verified reachable with a browser UA, no JS
// wall), so it is scraped with the regex-HTML approach used elsewhere in
// sources/. The listing table already carries every field: role/service (title
// + link), sector, country, notice type, and a <time> deadline. Volume is low
// (a handful of open notices) but the niche fit is high: notices are almost all
// consultancy for institutional strengthening, policy manuals, and market
// studies. country drives LATAM_CARIB tagging (cdb is a name-derived source).
// On any failure it logs and returns [] without throwing.

import type { NormalizedLead } from './types';
import { toIso } from './types';

const BASE = 'https://www.caribank.org';
const LISTING = `${BASE}/work-with-us/procurement/procurement-notices`;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
// The listing paginates with ?page=N; follow a few pages, stopping when empty.
const MAX_PAGES = Number(process.env.CDB_PAGES ?? '3');

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;|&rsquo;|&#8217;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

// Inner HTML of the <td> whose `headers` attribute contains the given key.
function cell(row: string, key: string): string {
  const re = new RegExp(`headers="[^"]*${key}[^"]*"[^>]*>([\\s\\S]*?)<\\/td>`, 'i');
  return re.exec(row)?.[1] ?? '';
}

// Contract-award notices are closed; drop them (defensive — the open listing is
// mostly live consultancy, but the type column can carry awards).
function isAward(type: string): boolean {
  return /award/i.test(type);
}

function parseRows(html: string): NormalizedLead[] {
  const out: NormalizedLead[] = [];
  for (const m of html.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)) {
    const row = m[1];
    const roleCell = cell(row, 'cdb-role-service');
    const anchor = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(roleCell);
    if (!anchor) continue; // header row / no notice link
    const href = anchor[1];
    const title = stripTags(anchor[2]);
    if (!title || !href) continue;

    const sector = stripTags(cell(row, 'sector-tag'));
    const country = stripTags(cell(row, 'cdb-country-tag'));
    const type = stripTags(cell(row, 'cdb-contract-awards-type'));
    if (isAward(type)) continue;

    const dateCell = cell(row, 'date-of-approval');
    const datetime = /<time[^>]+datetime="([^"]+)"/i.exec(dateCell)?.[1] ?? null;

    const url = href.startsWith('http') ? href : `${BASE}${href}`;
    out.push({
      title,
      url,
      raw_content: [
        `CDB procurement notice: ${title}`,
        `Country: ${country}`,
        `Sector: ${sector}`,
        `Type: ${type}`,
      ].join('\n'),
      company: null,
      location: country || null,
      deadline: toIso(datetime),
      value_estimate: null,
      source: 'cdb',
    });
  }
  return out;
}

async function fetchPage(page: number): Promise<NormalizedLead[]> {
  const url = page === 0 ? LISTING : `${LISTING}?page=${page}`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      console.warn(`CDB: page ${page} returned HTTP ${res.status}.`);
      return [];
    }
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('html')) {
      console.warn(`CDB: page ${page} non-HTML response (${ct}); gated/changed.`);
      return [];
    }
    return parseRows(await res.text());
  } catch (error) {
    console.warn(`CDB: page ${page} fetch failed (${String(error).slice(0, 80)}).`);
    return [];
  }
}

export async function scrapeCdb(): Promise<NormalizedLead[]> {
  const byUrl = new Map<string, NormalizedLead>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const leads = await fetchPage(page);
    if (leads.length === 0) break; // no more rows
    let added = 0;
    for (const l of leads) {
      if (!byUrl.has(l.url)) {
        byUrl.set(l.url, l);
        added++;
      }
    }
    if (added === 0) break; // page repeated the previous set
  }

  const leads = [...byUrl.values()];
  if (leads.length === 0) {
    console.warn('CDB: no parseable procurement rows (gated or markup changed). Skipping (0 leads).');
  } else {
    console.log(`CDB: ${leads.length} procurement notices`);
  }
  return leads;
}
