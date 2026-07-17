// Asian Development Bank (ADB) consulting opportunities source.
//
// Keyless RSS: ADB publishes Consulting Services Recruitment Notices (CSRN) via
// FeedBurner. Every item is, by definition, an invitation for expressions of
// interest for an ADB-financed advisory/consulting assignment, so the notice
// header describes exactly that (the RSS title is only the role/assignment name
// and the body is empty). Relevance is left to the orchestrator prefilter. On
// failure it logs and returns [] without throwing.

import type { NormalizedLead } from './types';
import { toIso } from './types';

const FEED_URL = process.env.ADB_URL ?? 'https://feeds.feedburner.com/adb-csrn';
const ATTEMPTS = Number(process.env.ADB_ATTEMPTS ?? '3');
const UA = 'Mozilla/5.0 (compatible; philipkwong-agents/1.0 +scraper)';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Strip CDATA wrappers and collapse whitespace.
function clean(s: string): string {
  return s
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(item: string, name: string): string {
  const m = item.match(new RegExp(`<${name}[^>]*>(.*?)</${name}>`, 's'));
  return m ? clean(m[1]) : '';
}

// The CSRN category packs "Date: .. |Project Number: .. |Status: .. |Countries:
// .. |Sectors: ..". Pull one labelled field out of it.
function metaField(category: string, label: string): string {
  const part = category.split('|').find((p) => p.trim().toLowerCase().startsWith(label.toLowerCase()));
  if (!part) return '';
  return part.slice(part.indexOf(':') + 1).trim();
}

async function fetchFeed(): Promise<string | null> {
  for (let i = 1; i <= ATTEMPTS; i++) {
    try {
      const res = await fetch(FEED_URL, {
        headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml' },
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) return await res.text();
      console.error(`ADB: HTTP ${res.status} (attempt ${i})`);
    } catch (error) {
      console.warn(`ADB: fetch attempt ${i} failed (${String(error).slice(0, 60)})`);
    }
    if (i < ATTEMPTS) await sleep(1500);
  }
  return null;
}

export async function scrapeAdb(): Promise<NormalizedLead[]> {
  const xml = await fetchFeed();
  if (!xml) {
    console.warn('ADB: feed unreachable after retries; skipping (0 leads).');
    return [];
  }

  const byUrl = new Map<string, NormalizedLead>();
  for (const m of xml.matchAll(/<item>(.*?)<\/item>/gs)) {
    const item = m[1];
    const title = tag(item, 'title');
    const link = tag(item, 'link');
    if (!title || !link) continue;
    if (byUrl.has(link)) continue;
    const category = tag(item, 'category');
    const country = metaField(category, 'Countries');
    const sectors = metaField(category, 'Sectors');
    // The category packs a "Date: YYYY-MM-DD" posting date; capture it as the
    // notice publication date (the feed exposes no bid deadline).
    const posted = toIso(metaField(category, 'Date'));
    byUrl.set(link, {
      title,
      url: link,
      raw_content: [
        'ADB Consulting Services Recruitment Notice: an invitation for expressions of interest for an advisory / consulting assignment.',
        `Assignment: ${title}`,
        `Country: ${country || 'multiple'}`,
        `Sector: ${sectors || 'n/a'}`,
        category ? `Notice: ${category}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      company: null,
      location: country || null,
      // The feed carries the posting date, not a bid deadline; keep deadline null
      // so the orchestrator does not drop the notice as expired, and record the
      // posting date as published_date (the notice's age signal).
      deadline: null,
      published_date: posted,
      value_estimate: null,
      source: 'adb',
    });
  }

  const leads = [...byUrl.values()];
  console.log(`ADB: ${leads.length} consulting recruitment notices`);
  return leads;
}
