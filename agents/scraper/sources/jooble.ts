// Jooble job-aggregator source.
// Free API (requires JOOBLE_API_KEY). POST {keywords, location} to
// https://jooble.org/api/<key>. Skipped gracefully if the key is absent.
// Needs a search term per call, so it queries a curated term list; the
// orchestrator prefilter assigns each posting to a profile.

import type { NormalizedLead } from './types';

const API_KEY = process.env.JOOBLE_API_KEY;

// Optional location filter. Empty string searches everywhere.
const LOCATION = process.env.JOOBLE_LOCATION ?? 'Canada';

const QUERIES = [
  'regulatory compliance consultant',
  'regulatory affairs',
  'quality management system',
  'GMP pharmaceutical',
  'medical device compliance',
  'cannabis compliance',
  'market entry strategy',
  'corporate strategy consultant',
  'AI automation',
  'digital transformation',
  'risk management compliance',
  'food safety HACCP',
  'feasibility study',
  'management consultant',
  'web development',
];

interface JoobleJob {
  title?: string;
  location?: string;
  snippet?: string;
  salary?: string;
  source?: string;
  type?: string;
  link?: string;
  company?: string;
  updated?: string;
}

interface JoobleResponse {
  totalCount?: number;
  jobs?: JoobleJob[];
}

function buildContent(j: JoobleJob): string {
  return [
    `Job posting: ${j.title ?? ''}`,
    `Company: ${j.company ?? 'unknown'}`,
    `Location: ${j.location ?? ''}`,
    `Type: ${j.type ?? ''}`,
    `Salary: ${j.salary ?? 'not stated'}`,
    '',
    j.snippet ?? '',
  ].join('\n');
}

export async function scrapeJooble(): Promise<NormalizedLead[]> {
  if (!API_KEY) {
    console.warn('Jooble: JOOBLE_API_KEY not set, skipping source.');
    return [];
  }

  const endpoint = `https://jooble.org/api/${API_KEY}`;
  const byUrl = new Map<string, NormalizedLead>();

  for (const keywords of QUERIES) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords, location: LOCATION }),
      });
      if (!res.ok) {
        console.error(`Jooble "${keywords}" failed: HTTP ${res.status}`);
        continue;
      }
      const data = (await res.json()) as JoobleResponse;
      for (const j of data.jobs ?? []) {
        if (!j.title || !j.link) continue;
        if (byUrl.has(j.link)) continue;
        byUrl.set(j.link, {
          title: j.title,
          url: j.link,
          raw_content: buildContent(j),
          company: j.company || null,
          location: j.location || null,
          deadline: null,
          value_estimate: j.salary || null,
          source: 'jooble',
        });
      }
    } catch (error) {
      console.error(`Jooble "${keywords}" error:`, error);
    }
  }

  const leads = [...byUrl.values()];
  console.log(
    `Jooble: ${leads.length} unique postings across ${QUERIES.length} queries` +
      ` (location: ${LOCATION || 'any'})`
  );
  return leads;
}
