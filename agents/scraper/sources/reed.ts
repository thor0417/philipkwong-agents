// Reed job-board source (UK-sourced hiring signal).
// Free API (requires REED_API_KEY). HTTP Basic auth: key as username, empty
// password. GET https://www.reed.co.uk/api/1.0/search?keywords=...
// Skipped gracefully if the key is absent.

import type { NormalizedLead } from './types';

const API_KEY = process.env.REED_API_KEY;

// Optional location filter. Empty searches UK-wide.
const LOCATION = process.env.REED_LOCATION ?? '';

const RESULTS_TO_TAKE = 20;

const QUERIES = [
  'regulatory compliance consultant',
  'regulatory affairs',
  'quality management system',
  'GMP pharmaceutical',
  'medical device compliance',
  'market entry strategy',
  'corporate strategy consultant',
  'AI automation',
  'digital transformation',
  'risk management compliance',
  'food safety',
  'management consultant',
];

interface ReedJob {
  jobId?: number;
  employerName?: string;
  jobTitle?: string;
  locationName?: string;
  minimumSalary?: number;
  maximumSalary?: number;
  currency?: string;
  date?: string;
  jobDescription?: string;
  jobUrl?: string;
}

interface ReedResponse {
  results?: ReedJob[];
}

function salaryText(j: ReedJob): string | null {
  if (!j.minimumSalary && !j.maximumSalary) return null;
  const cur = j.currency ?? 'GBP';
  return `${j.minimumSalary ?? '?'}-${j.maximumSalary ?? '?'} ${cur}`;
}

function buildContent(j: ReedJob): string {
  return [
    `Job posting: ${j.jobTitle ?? ''}`,
    `Company: ${j.employerName ?? 'unknown'}`,
    `Location: ${j.locationName ?? ''}`,
    `Salary: ${salaryText(j) ?? 'not stated'}`,
    '',
    j.jobDescription ?? '',
  ].join('\n');
}

export async function scrapeReed(): Promise<NormalizedLead[]> {
  if (!API_KEY) {
    console.warn('Reed: REED_API_KEY not set, skipping source.');
    return [];
  }

  const auth = Buffer.from(`${API_KEY}:`).toString('base64');
  const byUrl = new Map<string, NormalizedLead>();

  for (const keywords of QUERIES) {
    const url =
      `https://www.reed.co.uk/api/1.0/search` +
      `?keywords=${encodeURIComponent(keywords)}` +
      `&resultsToTake=${RESULTS_TO_TAKE}` +
      (LOCATION ? `&locationName=${encodeURIComponent(LOCATION)}` : '');

    try {
      const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
      if (!res.ok) {
        console.error(`Reed "${keywords}" failed: HTTP ${res.status}`);
        continue;
      }
      const data = (await res.json()) as ReedResponse;
      for (const j of data.results ?? []) {
        if (!j.jobTitle || !j.jobUrl) continue;
        if (byUrl.has(j.jobUrl)) continue;
        byUrl.set(j.jobUrl, {
          title: j.jobTitle,
          url: j.jobUrl,
          raw_content: buildContent(j),
          company: j.employerName || null,
          location: j.locationName || null,
          deadline: null,
          value_estimate: salaryText(j),
          source: 'reed',
        });
      }
    } catch (error) {
      console.error(`Reed "${keywords}" error:`, error);
    }
  }

  const leads = [...byUrl.values()];
  console.log(
    `Reed: ${leads.length} unique postings across ${QUERIES.length} queries` +
      ` (location: ${LOCATION || 'UK-wide'})`
  );
  return leads;
}
