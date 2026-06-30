// JSearch job-aggregator source (via RapidAPI).
//
// JSearch aggregates postings from LinkedIn, Indeed, Glassdoor, ZipRecruiter and
// others behind one API. Keyed: needs RAPIDAPI_KEY in .env.local; skipped
// gracefully if absent. Each call is GET https://jsearch.p.rapidapi.com/search
// with headers x-rapidapi-host + x-rapidapi-key. The free tier is request-limited
// (each query+page is one request), so we run a curated term list with a single
// page per term rather than crawling everything. The orchestrator prefilter then
// assigns each posting to a profile.

import type { NormalizedLead } from './types';

const API_HOST = 'jsearch.p.rapidapi.com';
const API_KEY = process.env.RAPIDAPI_KEY;

// Two-letter country code for the search (JSearch geo-filters on this). Default
// Canada (Philip is Vancouver-based); override via env.
const COUNTRY = process.env.JSEARCH_COUNTRY ?? 'ca';
// Recency window: 'all' | 'today' | '3days' | 'week' | 'month'.
const DATE_POSTED = process.env.JSEARCH_DATE_POSTED ?? 'month';
// One page per query keeps free-tier request use to one call per term.
const NUM_PAGES = Number(process.env.JSEARCH_NUM_PAGES ?? '1');

// Curated, not exhaustive: terms aligned to Philip's hiring + consulting profiles.
const QUERIES = [
  'regulatory compliance consultant',
  'regulatory affairs',
  'quality management system',
  'GMP pharmaceutical',
  'medical device compliance',
  'cannabis compliance',
  'market entry strategy',
  'corporate strategy consultant',
  'AI automation consultant',
  'digital transformation',
  'risk management compliance',
  'food safety HACCP',
  'feasibility study',
  'management consultant',
];

interface JSearchJob {
  job_id?: string;
  job_title?: string;
  employer_name?: string;
  job_publisher?: string;
  job_employment_type?: string;
  job_apply_link?: string;
  job_description?: string;
  job_city?: string;
  job_state?: string;
  job_country?: string;
  job_posted_at_datetime_utc?: string;
  job_min_salary?: number;
  job_max_salary?: number;
  job_salary_currency?: string;
  job_salary_period?: string;
}

interface JSearchResponse {
  status?: string;
  data?: JSearchJob[];
}

function locationOf(j: JSearchJob): string | null {
  const parts = [j.job_city, j.job_state, j.job_country].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function salaryText(j: JSearchJob): string | null {
  if (!j.job_min_salary && !j.job_max_salary) return null;
  const cur = j.job_salary_currency ?? '';
  const per = j.job_salary_period ? `/${j.job_salary_period.toLowerCase()}` : '';
  return `${j.job_min_salary ?? '?'}-${j.job_max_salary ?? '?'} ${cur}${per}`.trim();
}

function buildContent(j: JSearchJob): string {
  return [
    `Job posting: ${j.job_title ?? ''}`,
    `Company: ${j.employer_name ?? 'unknown'}`,
    `Location: ${locationOf(j) ?? ''}`,
    `Type: ${j.job_employment_type ?? ''}`,
    `Source: ${j.job_publisher ?? ''}`,
    `Salary: ${salaryText(j) ?? 'not stated'}`,
    '',
    j.job_description ?? '',
  ].join('\n');
}

export async function scrapeJSearch(): Promise<NormalizedLead[]> {
  if (!API_KEY) {
    console.warn('JSearch: RAPIDAPI_KEY not set, skipping source.');
    return [];
  }

  const headers = { 'x-rapidapi-host': API_HOST, 'x-rapidapi-key': API_KEY };
  const byUrl = new Map<string, NormalizedLead>();

  for (const query of QUERIES) {
    const url =
      `https://${API_HOST}/search` +
      `?query=${encodeURIComponent(query)}` +
      `&page=1&num_pages=${NUM_PAGES}` +
      `&country=${encodeURIComponent(COUNTRY)}` +
      `&date_posted=${encodeURIComponent(DATE_POSTED)}`;

    try {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        console.error(`JSearch "${query}" failed: HTTP ${res.status}`);
        continue;
      }
      const data = (await res.json()) as JSearchResponse;
      for (const j of data.data ?? []) {
        // job_apply_link is the stable, unique URL; skip rows without one.
        const link = j.job_apply_link;
        if (!j.job_title || !link) continue;
        if (byUrl.has(link)) continue;
        byUrl.set(link, {
          title: j.job_title,
          url: link,
          raw_content: buildContent(j),
          company: j.employer_name || null,
          location: locationOf(j),
          deadline: null,
          value_estimate: salaryText(j),
          source: 'jsearch',
        });
      }
    } catch (error) {
      console.error(`JSearch "${query}" error:`, error);
    }
  }

  const leads = [...byUrl.values()];
  console.log(
    `JSearch: ${leads.length} unique postings across ${QUERIES.length} queries` +
      ` (country: ${COUNTRY}, since: ${DATE_POSTED})`
  );
  return leads;
}
