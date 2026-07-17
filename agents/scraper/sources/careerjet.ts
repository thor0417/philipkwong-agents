// Careerjet job-aggregator source.
// Public API keyed by an affiliate id (CAREERJET_API_KEY -> affid). The API also
// requires user_ip, user_agent, and url params; sane server-side defaults are
// used and overridable via env. Skipped gracefully if the key is absent.

import type { NormalizedLead } from './types';
import { toIso } from './types';

const AFFID = process.env.CAREERJET_API_KEY;

// Careerjet requires these for every call; defaults are fine for server use.
const USER_IP = process.env.CAREERJET_USER_IP ?? '8.8.8.8';
const USER_AGENT = process.env.CAREERJET_USER_AGENT ?? 'philipkwong-agents/1.0';
const REF_URL = process.env.CAREERJET_REF_URL ?? 'https://philipkwong.local/jobs';
// Regional locale (controls which Careerjet site is queried).
const LOCALE = process.env.CAREERJET_LOCALE ?? 'en_CA';
const LOCATION = process.env.CAREERJET_LOCATION ?? '';

const PAGE_SIZE = 20;

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
  'food safety',
  'management consultant',
];

interface CareerjetJob {
  title?: string;
  description?: string;
  company?: string;
  locations?: string;
  salary?: string;
  url?: string;
  date?: string;
}

interface CareerjetResponse {
  type?: string;
  jobs?: CareerjetJob[];
  hits?: number;
}

function buildContent(j: CareerjetJob): string {
  return [
    `Job posting: ${j.title ?? ''}`,
    `Company: ${j.company ?? 'unknown'}`,
    `Location: ${j.locations ?? ''}`,
    `Salary: ${j.salary ?? 'not stated'}`,
    '',
    j.description ?? '',
  ].join('\n');
}

export async function scrapeCareerjet(): Promise<NormalizedLead[]> {
  if (!AFFID) {
    console.warn('Careerjet: CAREERJET_API_KEY not set, skipping source.');
    return [];
  }

  const byUrl = new Map<string, NormalizedLead>();

  for (const keywords of QUERIES) {
    const url =
      `http://public.api.careerjet.net/search` +
      `?affid=${encodeURIComponent(AFFID)}` +
      `&keywords=${encodeURIComponent(keywords)}` +
      (LOCATION ? `&location=${encodeURIComponent(LOCATION)}` : '') +
      `&locale_code=${encodeURIComponent(LOCALE)}` +
      `&pagesize=${PAGE_SIZE}` +
      `&user_ip=${encodeURIComponent(USER_IP)}` +
      `&user_agent=${encodeURIComponent(USER_AGENT)}` +
      `&url=${encodeURIComponent(REF_URL)}`;

    try {
      // Careerjet rejects calls without a Referer header ("Undeclared referrer").
      const res = await fetch(url, {
        headers: { Referer: REF_URL, 'User-Agent': USER_AGENT },
      });
      if (!res.ok) {
        console.error(`Careerjet "${keywords}" failed: HTTP ${res.status}`);
        continue;
      }
      const data = (await res.json()) as CareerjetResponse;
      for (const j of data.jobs ?? []) {
        if (!j.title || !j.url) continue;
        if (byUrl.has(j.url)) continue;
        byUrl.set(j.url, {
          title: j.title,
          url: j.url,
          raw_content: buildContent(j),
          company: j.company || null,
          location: j.locations || null,
          deadline: null,
          published_date: toIso(j.date),
          value_estimate: j.salary || null,
          source: 'careerjet',
        });
      }
    } catch (error) {
      console.error(`Careerjet "${keywords}" error:`, error);
    }
  }

  const leads = [...byUrl.values()];
  console.log(
    `Careerjet: ${leads.length} unique postings across ${QUERIES.length} queries` +
      ` (locale: ${LOCALE})`
  );
  return leads;
}
