// CONFOTUR (Dominican Republic) incentive-approval signals — best-effort.
//
// CONFOTUR grants the 15-year tourism tax exemption that DR projects need before
// banks will fund them, so every approval is a named, incentivized project
// pre-funding. The official channels are gated: the CONFOTUR/MITUR sites are a
// JS SPA (empty shell to a fetcher) and HTTP 500 to bots, and the authoritative
// resolutions are irregular Gaceta Oficial PDFs. The realistic channel is DR
// tourism trade press (WordPress RSS), which reports the approval batches with
// project name + province (developer usually only in the Gaceta PDF).
//
// From some runtimes the trade-press host is itself WAF-gated (HTTP 403). This
// adapter tries the configured RSS feeds with a browser-like request and, on a
// block/empty response, logs the access type and returns [] WITHOUT throwing.
// Point CONFOTUR_FEEDS at a reachable feed/mirror to enable it.
//
// signal_type 'incentive_approval', regulator 'CONFOTUR', country DO.

import type { NormalizedLead } from './types';
import { toIso } from './types';

const FEEDS = (
  process.env.CONFOTUR_FEEDS ??
  'https://infoturdominicano.com/?s=confotur&feed=rss2,https://infoturdominicano.com/tag/confotur/feed/'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// Keep only items that are about CONFOTUR classifications/approvals.
const CONFOTUR_RE = /confotur|clasificaci[oó]n|exenci[oó]n|incentiv/i;

function cdata(s: string): string {
  return s
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

function field(item: string, tag: string): string {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(item);
  return m ? cdata(m[1]) : '';
}

// DR provinces, so a lead carries its location even when the developer is absent.
const DR_PROVINCES = [
  'La Altagracia', 'Punta Cana', 'Bavaro', 'Bávaro', 'Puerto Plata', 'Samana', 'Samaná',
  'Miches', 'La Romana', 'Bayahibe', 'Pedernales', 'Barahona', 'Santo Domingo',
  'Santiago', 'Sosua', 'Sosúa', 'Cabarete', 'Las Terrenas', 'Montecristi', 'Azua',
];
function provinceFor(text: string): string | null {
  for (const p of DR_PROVINCES) if (new RegExp(`\\b${p}\\b`, 'i').test(text)) return p;
  return null;
}

async function fetchFeed(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'es-DO,es;q=0.9',
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      console.warn(`CONFOTUR: feed HTTP ${res.status} (${url}).`);
      return null;
    }
    return await res.text();
  } catch (error) {
    console.warn(`CONFOTUR: feed fetch failed (${String(error).slice(0, 60)}).`);
    return null;
  }
}

export async function scrapeConfotur(): Promise<NormalizedLead[]> {
  const byUrl = new Map<string, NormalizedLead>();
  let gated = 0;
  for (const feed of FEEDS) {
    const xml = await fetchFeed(feed);
    if (!xml) {
      gated++;
      continue;
    }
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((m) => m[1]);
    for (const item of items) {
      const title = field(item, 'title');
      const link = field(item, 'link');
      if (!title || !link || byUrl.has(link)) continue;
      const description = field(item, 'description');
      if (!CONFOTUR_RE.test(`${title} ${description}`)) continue;
      const province = provinceFor(`${title} ${description}`);
      byUrl.set(link, {
        title,
        url: link,
        raw_content: [`CONFOTUR tourism-incentive approval (DR).`, `Title: ${title}`, description].filter(Boolean).join('\n'),
        company: null, // developer typically only in the Gaceta PDF
        location: province ?? 'Dominican Republic',
        deadline: null,
        value_estimate: null,
        source: 'confotur',
        country: 'DO',
        signal_type: 'incentive_approval',
        regulator: 'CONFOTUR',
        project_description: description.slice(0, 600),
        signal_date: toIso(field(item, 'pubDate'))?.slice(0, 10) ?? null,
      });
    }
  }

  const leads = [...byUrl.values()];
  if (leads.length === 0) {
    console.warn(
      `CONFOTUR: 0 signals (${gated}/${FEEDS.length} feeds gated/unreachable from this runtime; official source is JS/PDF-gated). Set CONFOTUR_FEEDS to a reachable feed to enable.`
    );
  } else {
    console.log(`CONFOTUR: ${leads.length} incentive-approval signals`);
  }
  return leads;
}
