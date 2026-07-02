// FONATUR (Mexico) land-acquisition signals source — parseable press channel.
//
// FONATUR's parcel CATALOG (fonatur.mx/terrenos-venta) is IP/geo-gated and needs
// a headless browser, so it is out of reach here. The gob.mx PRESS channel is
// static HTML and reachable, and it is the better signal anyway: each public
// land tender ("Licitación Pública de lotes") gets its own press release. There
// is no clean feed, so discovery crawls the press archive index (paginated),
// keeps the land-offering articles, and parses each.
//
// A FONATUR land buyer is the earliest findable developer signal in Mexico.
// signal_type = 'land_acquisition', regulator = 'FONATUR', country MX.
// On any failure it logs and returns [] without throwing.

import type { NormalizedLead } from './types';

const BASE = 'https://www.gob.mx';
const ARCHIVE = `${BASE}/fonatur/es/archivo/prensa`;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const PAGES = Number(process.env.FONATUR_PAGES ?? '4');

// Land-offering markers (Spanish). A press release about a lot tender/sale/
// auction; excludes the infrastructure / cleanup / program releases that
// dominate the feed.
const LAND_RE = /licitaci[oó]n|lotes|subasta|enajenaci[oó]n|venta de lote|desincorporaci[oó]n/i;

// CIP / resort centre -> Mexican state, so the lead carries the state.
const CIP_STATE: Record<string, string> = {
  huatulco: 'Oaxaca',
  cancun: 'Quintana Roo',
  'cancún': 'Quintana Roo',
  cozumel: 'Quintana Roo',
  'playa del carmen': 'Quintana Roo',
  'los cabos': 'Baja California Sur',
  'san jose del cabo': 'Baja California Sur',
  loreto: 'Baja California Sur',
  'litibu': 'Nayarit',
  'litibú': 'Nayarit',
  nayarit: 'Nayarit',
  'nuevo vallarta': 'Nayarit',
  ixtapa: 'Guerrero',
  zihuatanejo: 'Guerrero',
  acapulco: 'Guerrero',
  'playa espiritu': 'Sinaloa',
  'teacapan': 'Sinaloa',
};

const MONTHS: Record<string, string> = {
  enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
  julio: '07', agosto: '08', septiembre: '09', setiembre: '09', octubre: '10',
  noviembre: '11', diciembre: '12',
};

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

// "03 de abril de 2026" -> "2026-04-03"; null if not found.
function parseSpanishDate(text: string): string | null {
  const m = /(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})/i.exec(text);
  if (!m) return null;
  const mm = MONTHS[m[2].toLowerCase()];
  if (!mm) return null;
  return `${m[3]}-${mm}-${m[1].padStart(2, '0')}`;
}

function stateFor(text: string): string | null {
  const low = text.toLowerCase();
  for (const [cip, state] of Object.entries(CIP_STATE)) {
    if (low.includes(cip)) return state;
  }
  return null;
}

async function get(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*', 'Accept-Language': 'es-MX,es;q=0.9' },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function titleOf(html: string): string {
  const t = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '';
  // gob.mx titles are "Article | Fondo Nacional... | Gobierno | gob.mx"
  return stripTags(t).split('|')[0].trim();
}

function bodyExcerpt(html: string): string {
  const desc = /<meta[^>]+name="description"[^>]+content="([^"]+)"/i.exec(html)?.[1];
  return stripTags(desc ?? html).slice(0, 600);
}

export async function scrapeFonatur(): Promise<NormalizedLead[]> {
  // 1. Crawl the paginated press archive, collecting land-offering article slugs.
  const slugs = new Set<string>();
  for (let page = 1; page <= PAGES; page++) {
    const idx = await get(`${ARCHIVE}?idiom=es&order=DESC&page=${page}`);
    if (!idx) break;
    const hrefs = [...idx.matchAll(/href="(\/fonatur\/prensa\/[^"?]+)/gi)].map((m) => m[1]);
    let found = 0;
    for (const h of hrefs) {
      if (LAND_RE.test(h)) {
        slugs.add(h);
        found++;
      }
    }
    if (hrefs.length === 0) break;
    void found;
  }

  // 2. Fetch each land article and build a signal.
  const leads: NormalizedLead[] = [];
  for (const slug of slugs) {
    const url = `${BASE}${slug}?idiom=es`;
    const html = await get(url);
    if (!html) continue;
    const title = titleOf(html) || 'FONATUR licitación de lotes';
    const excerpt = bodyExcerpt(html);
    const both = `${title}\n${excerpt}`;
    const state = stateFor(both);
    // The publish date lives in the article body, not the meta description, so
    // parse it from the full page (first Spanish date is the publish date).
    const signalDate = parseSpanishDate(html);
    leads.push({
      title,
      url,
      raw_content: [
        `FONATUR land tender (licitación pública de lotes).`,
        `Title: ${title}`,
        state ? `State: ${state}` : '',
        excerpt,
      ]
        .filter(Boolean)
        .join('\n'),
      company: null, // buyer is the state; the developer is the (unknown) winning bidder
      location: state ?? 'Mexico',
      deadline: null,
      value_estimate: null,
      source: 'fonatur',
      country: 'MX',
      signal_type: 'land_acquisition',
      regulator: 'FONATUR',
      project_description: excerpt,
      signal_date: signalDate,
    });
  }

  console.log(`FONATUR: ${leads.length} land-offering signals (from ${slugs.size} land articles across ${PAGES} archive pages)`);
  return leads;
}
