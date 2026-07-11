// Serper search source (GLI lane).
//
// Whole-web Google search via Serper (https://google.serper.dev/search). This
// replaces the Google Custom Search source for the GLI lane: Google closed the
// Custom Search JSON API to new projects in early 2026 (403 forbidden regardless
// of correct setup), and Serper searches the whole web rather than a fixed set
// of curated domains, which is the intended improvement.
//
// Runs one call per GLI query term. The free tier is 2,500 searches/month and
// the 18-term run uses 18, so there is no rate concern.
//
// Adapter does NO relevance filtering (per the source contract): it normalizes
// the organic results and hands them back with source 'gli_serper'. The GLI lane
// applies the inclusion gate, venue/signal tagging, and project dedup.
//
// Graceful degrade: if the key is missing, or any query returns a non-200, it
// logs and continues (never throws), returning whatever it gathered.

import type { NormalizedLead } from './types';

const API_KEY = process.env.SERPER_API_KEY;

const ENDPOINT = 'https://google.serper.dev/search';

interface SerperOrganic {
  title?: string;
  link?: string;
  snippet?: string;
}

interface SerperResponse {
  organic?: SerperOrganic[];
  message?: string;
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

export async function scrapeSerper(queries: string[]): Promise<NormalizedLead[]> {
  if (!API_KEY) {
    console.warn('Serper: SERPER_API_KEY not set, skipping source.');
    return [];
  }

  const byUrl = new Map<string, NormalizedLead>();

  for (const q of queries) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'X-API-KEY': API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q }),
      });
      if (!res.ok) {
        let detail = '';
        try {
          const body = (await res.json()) as SerperResponse;
          detail = body.message ? ` - ${body.message}` : '';
        } catch {
          /* ignore body parse errors */
        }
        console.error(`Serper "${q}" failed: HTTP ${res.status}${detail}`);
        continue;
      }
      const data = (await res.json()) as SerperResponse;
      for (const item of data.organic ?? []) {
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
          source: 'gli_serper',
        });
      }
    } catch (error) {
      console.error(`Serper "${q}" error:`, error);
    }
  }

  const leads = [...byUrl.values()];
  console.log(`Serper: ${leads.length} unique results across ${queries.length} queries.`);
  return leads;
}
