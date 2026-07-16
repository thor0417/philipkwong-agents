// Serper search source (GLI Tier 3 intelligence lane).
//
// CURATED TRADE PRESS ONLY. This replaces the whole-web, multi-region Serper
// pass. The GLI queries now run only against a curated domain list using batched
// `site:` operators (one query per term per batch of domains, joined with OR),
// and every query is date-restricted to a recency window (Serper tbs date range).
// The result is a small, current market-intelligence feed from the trade press
// and giga-project authorities, not whole-web news noise (Facebook / YouTube /
// TV news / stale articles are structurally excluded because they are not in the
// curated list). This lane is intelligence, not leads.
//
// Budget: searches = terms x batches, where batches = ceil(domains / batchSize).
// batchSize is grown at plan time until the product is under MAX_SEARCHES_PER_RUN.
// The count is logged and enforced.
//
// Adapter does NO relevance filtering (per the source contract): it normalizes
// the organic results (capturing each result's date into published_date where
// Serper exposes it) and hands them back with source 'gli_serper'. The GLI lane
// (gli.ts) applies the recency gate, inclusion gate, venue/signal tagging, and
// project dedup.
//
// Graceful degrade: if the key is missing, or any query returns a non-200, it
// logs and continues (never throws), returning whatever it gathered.

import type { NormalizedLead } from './types';

const API_KEY = process.env.SERPER_API_KEY;

const ENDPOINT = 'https://google.serper.dev/search';

// Hard ceiling on searches issued per run. The batch size is grown until the
// planned search count sits under this; it also backstops the run loop.
const MAX_SEARCHES_PER_RUN = 120;

// Recency window (days). Every query is date-restricted to this window via Serper
// tbs, and every result is gated on its published date downstream (gli.ts).
// Exported so the lane's date gate uses the same window. Tunable.
export const RECENCY_WINDOW_DAYS = Number(process.env.RECENCY_WINDOW_DAYS ?? '90');

// Target domains per batched site: query. Grown at plan time (planBatchSize) to
// keep the total search count under the ceiling; never shrunk below this.
const DOMAINS_PER_QUERY = Number(process.env.SERPER_DOMAINS_PER_QUERY ?? '8');

// Curated trade-press / authority domains for the intelligence lane. EDITABLE.
// Groups: leisure/attractions trade, hospitality trade, gaming trade, Middle East
// business / construction / tourism press, Gulf giga-project authorities,
// Asia-Pacific travel trade, and hotel-investment data houses.
const CURATED_DOMAINS = [
  // Leisure / attractions trade press
  'blooloop.com',
  'attractionsmanagement.com',
  'parkworld-online.com',
  'inparkmagazine.com',
  'iaapa.org',
  'themeparx.com',
  'amusementtoday.com',
  // Hospitality trade press
  'hospitalitynet.org',
  'hotelnewsresource.com',
  'hotelmanagement.net',
  'tophotelnews.com',
  // Gaming trade press
  'ggbmagazine.com',
  'asgam.com',
  'casinobeats.com',
  // Middle East business / construction / tourism press
  'arabianbusiness.com',
  'zawya.com',
  'meed.com',
  'constructionweekonline.com',
  'hoteliermiddleeast.com',
  'gulfbusiness.com',
  'meconstructionnews.com',
  // Gulf giga-project / tourism authorities
  'neom.com',
  'qiddiya.com',
  'diriyah.sa',
  'redseaglobal.com',
  'visitsaudi.com',
  'dctabudhabi.ae',
  'visitqatar.com',
  // Asia-Pacific travel trade
  'ttrweekly.com',
  'traveldailynews.asia',
  'ttgasia.com',
  // Hotel-investment data houses
  'hvs.com',
  'str.com',
  'skift.com',
  'hospitalityinvestor.com',
];

// Number of Serper searches issued by the most recent scrapeSerper call, for the
// run report. Reset at the start of each call.
let lastSearchCount = 0;
export function lastSerperSearchCount(): number {
  return lastSearchCount;
}

interface SerperOrganic {
  title?: string;
  link?: string;
  snippet?: string;
  // Serper exposes a human-readable date on some organic results ("3 days ago",
  // "Dec 12, 2025", ...). Absent on many; those leads are treated as undated.
  date?: string;
}

interface SerperResponse {
  organic?: SerperOrganic[];
  message?: string;
}

// The smallest batch size (>= DOMAINS_PER_QUERY) that keeps terms x batches under
// the ceiling. Grows the batch (fewer, wider queries) if the term list is large.
function planBatchSize(termCount: number, domainCount: number): number {
  let size = Math.max(1, DOMAINS_PER_QUERY);
  let batches = Math.ceil(domainCount / size);
  while (termCount * batches >= MAX_SEARCHES_PER_RUN && size < domainCount) {
    size++;
    batches = Math.ceil(domainCount / size);
  }
  return size;
}

// Split the curated domains into batches of `size`.
function batchDomains(size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < CURATED_DOMAINS.length; i += size) {
    out.push(CURATED_DOMAINS.slice(i, i + size));
  }
  return out;
}

// Serper tbs custom date range for the recency window: cd_min = now - window,
// cd_max = now (US M/D/YYYY, as Google expects). Coarse pre-filter; the exact
// day-level gate is applied on published_date downstream.
function tbsRecency(days: number): string {
  const now = new Date();
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const fmt = (d: Date): string => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  return `cdr:1,cd_min:${fmt(from)},cd_max:${fmt(now)}`;
}

// Parse a Serper date string into an ISO timestamp, or null when absent /
// unparseable. Handles both relative ("3 days ago") and absolute ("Dec 12, 2025")
// forms.
const REL_MS: Record<string, number> = {
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000,
};
function parseSerperDate(raw?: string): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const rel = s.match(/^(\d+)\s+(hour|day|week|month|year)s?\s+ago$/i);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const ms = REL_MS[rel[2].toLowerCase()];
    if (ms) return new Date(Date.now() - n * ms).toISOString();
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// The snippet is the raw_content per the source contract; the display domain is
// appended as a short provenance line so the GLI classifier can weigh the source.
function buildContent(item: SerperOrganic): string {
  const parts = [item.snippet ?? ''];
  if (item.link) {
    try {
      parts.push(`Source: ${new URL(item.link).hostname}`);
    } catch {
      /* non-URL link: skip provenance line */
    }
  }
  return parts.filter(Boolean).join('\n');
}

// One Serper call (date-restricted). Returns organic results, or [] on any
// failure (logged).
async function runQuery(q: string, tbs: string): Promise<SerperOrganic[]> {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'X-API-KEY': API_KEY as string, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, tbs }),
    });
    if (!res.ok) {
      let detail = '';
      try {
        const errBody = (await res.json()) as SerperResponse;
        detail = errBody.message ? ` - ${errBody.message}` : '';
      } catch {
        /* ignore body parse errors */
      }
      console.error(`Serper "${q.slice(0, 60)}" failed: HTTP ${res.status}${detail}`);
      return [];
    }
    const data = (await res.json()) as SerperResponse;
    return data.organic ?? [];
  } catch (error) {
    console.error(`Serper "${q.slice(0, 60)}" error:`, error);
    return [];
  }
}

export async function scrapeSerper(queries: string[]): Promise<NormalizedLead[]> {
  lastSearchCount = 0;
  if (!API_KEY) {
    console.warn('Serper: SERPER_API_KEY not set, skipping source.');
    return [];
  }
  if (queries.length === 0) {
    console.warn('Serper: no queries configured, skipping source.');
    return [];
  }

  const batchSize = planBatchSize(queries.length, CURATED_DOMAINS.length);
  const batches = batchDomains(batchSize);
  const tbs = tbsRecency(RECENCY_WINDOW_DAYS);

  // Plan: every term against every curated-domain batch (site:a OR site:b ...).
  const plan: string[] = [];
  for (const term of queries) {
    for (const batch of batches) {
      const sites = batch.map((d) => `site:${d}`).join(' OR ');
      plan.push(`${term} (${sites})`);
    }
  }

  const byUrl = new Map<string, NormalizedLead>();
  let searches = 0;

  for (const q of plan) {
    if (searches >= MAX_SEARCHES_PER_RUN) {
      console.warn(
        `Serper: reached the hard ceiling of ${MAX_SEARCHES_PER_RUN} searches; ` +
          `stopping (planned ${plan.length}).`
      );
      break;
    }
    searches++;
    const items = await runQuery(q, tbs);
    for (const item of items) {
      if (!item.title || !item.link) continue;
      if (byUrl.has(item.link)) continue;
      byUrl.set(item.link, {
        title: item.title,
        url: item.link,
        raw_content: buildContent(item),
        company: null,
        location: null,
        deadline: null,
        published_date: parseSerperDate(item.date),
        value_estimate: null,
        source: 'gli_serper',
      });
    }
  }

  lastSearchCount = searches;
  const leads = [...byUrl.values()];
  console.log(
    `Serper (curated intelligence): ${searches} searches ` +
      `(${queries.length} terms x ${batches.length} domain batches of ${batchSize}, ` +
      `${CURATED_DOMAINS.length} curated domains, last ${RECENCY_WINDOW_DAYS}d); ` +
      `${leads.length} unique results.`
  );
  return leads;
}
