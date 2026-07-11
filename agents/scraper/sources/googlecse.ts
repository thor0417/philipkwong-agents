// Google Custom Search source (GLI lane only).
//
// Queries a Google Programmable Search Engine restricted to a curated set of
// leisure / tourism / hospitality / attraction domains. Runs one page per query
// term (num=10) to stay well inside the free tier (100 queries/day): the GLI
// profile ships ~18 terms, so a run costs ~18 queries.
//
// Adapter does NO relevance filtering (per the source contract): it normalizes
// the Custom Search items and hands them back with source 'gli_cse'. The GLI
// lane applies the inclusion gate, venue/signal tagging, and project dedup.
//
// Graceful degrade: if the key or engine id is missing, or any query returns a
// non-200, it logs and continues (never throws), returning whatever it gathered.

import type { NormalizedLead } from './types';

const API_KEY = process.env.GOOGLE_SEARCH_API_KEY;
const ENGINE_ID = process.env.GOOGLE_SEARCH_ENGINE_ID;

const ENDPOINT = 'https://www.googleapis.com/customsearch/v1';
// Custom Search caps a page at 10 results; one page per query keeps the daily
// quota affordable.
const RESULTS_PER_QUERY = 10;

interface CseItem {
  title?: string;
  link?: string;
  snippet?: string;
  displayLink?: string;
}

interface CseResponse {
  items?: CseItem[];
  error?: { message?: string };
}

// The snippet is the raw_content per spec; the display domain is appended as a
// short provenance line so the GLI classifier can weigh the source.
function buildContent(item: CseItem): string {
  const parts = [item.snippet ?? ''];
  if (item.displayLink) parts.push(`Source: ${item.displayLink}`);
  return parts.filter(Boolean).join('\n');
}

export async function scrapeGoogleCse(queries: string[]): Promise<NormalizedLead[]> {
  if (!API_KEY || !ENGINE_ID) {
    console.warn(
      'Google CSE: GOOGLE_SEARCH_API_KEY/GOOGLE_SEARCH_ENGINE_ID not set, skipping source.'
    );
    return [];
  }

  const byUrl = new Map<string, NormalizedLead>();

  for (const q of queries) {
    const url =
      `${ENDPOINT}?key=${encodeURIComponent(API_KEY)}` +
      `&cx=${encodeURIComponent(ENGINE_ID)}` +
      `&q=${encodeURIComponent(q)}` +
      `&num=${RESULTS_PER_QUERY}`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        let detail = '';
        try {
          const body = (await res.json()) as CseResponse;
          detail = body.error?.message ? ` - ${body.error.message}` : '';
        } catch {
          /* ignore body parse errors */
        }
        console.error(`Google CSE "${q}" failed: HTTP ${res.status}${detail}`);
        continue;
      }
      const data = (await res.json()) as CseResponse;
      for (const item of data.items ?? []) {
        if (!item.title || !item.link) continue;
        if (byUrl.has(item.link)) continue;
        byUrl.set(item.link, {
          title: item.title,
          url: item.link,
          raw_content: buildContent(item),
          company: null,
          location: null,
          deadline: null,
          value_estimate: null,
          source: 'gli_cse',
        });
      }
    } catch (error) {
      console.error(`Google CSE "${q}" error:`, error);
    }
  }

  const leads = [...byUrl.values()];
  console.log(`Google CSE: ${leads.length} unique results across ${queries.length} queries.`);
  return leads;
}
