// Adzuna Canadian job-postings source.
// Free API (requires ADZUNA_APP_ID + ADZUNA_APP_KEY). Country scoped to 'ca'.
// If keys are absent the source is skipped gracefully so CanadaBuys still runs.

import type { RawLead } from './scraper';

const APP_ID = process.env.ADZUNA_APP_ID;
const APP_KEY = process.env.ADZUNA_APP_KEY;

const RESULTS_PER_PAGE = 20;

// One search per term. Kept small to stay within Adzuna's free-tier limits.
const QUERIES = [
  'compliance consultant',
  'regulatory affairs',
  'quality management system',
  'ISO certification',
  'market entry strategy',
  'corporate strategy',
  'business process automation',
  'AI automation',
];

interface AdzunaResult {
  title?: string;
  description?: string;
  redirect_url?: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  salary_min?: number;
  salary_max?: number;
  category?: { label?: string };
}

interface AdzunaResponse {
  results?: AdzunaResult[];
}

function buildContent(j: AdzunaResult): string {
  const salary =
    j.salary_min || j.salary_max
      ? `${j.salary_min ?? '?'}–${j.salary_max ?? '?'} CAD`
      : 'not stated';
  return [
    `Job posting: ${j.title ?? ''}`,
    `Company: ${j.company?.display_name ?? 'unknown'}`,
    `Location: ${j.location?.display_name ?? 'Canada'}`,
    `Category: ${j.category?.label ?? ''}`,
    `Salary: ${salary}`,
    '',
    j.description ?? '',
  ].join('\n');
}

export async function scrapeAdzuna(): Promise<RawLead[]> {
  if (!APP_ID || !APP_KEY) {
    console.warn('Adzuna: ADZUNA_APP_ID/ADZUNA_APP_KEY not set — skipping source.');
    return [];
  }

  const byUrl = new Map<string, RawLead>();

  for (const what of QUERIES) {
    const url =
      `https://api.adzuna.com/v1/api/jobs/ca/search/1` +
      `?app_id=${APP_ID}&app_key=${APP_KEY}` +
      `&results_per_page=${RESULTS_PER_PAGE}` +
      `&what=${encodeURIComponent(what)}` +
      `&content-type=application/json`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.error(`Adzuna "${what}" failed: HTTP ${res.status}`);
        continue;
      }
      const data = (await res.json()) as AdzunaResponse;
      for (const j of data.results ?? []) {
        if (!j.title || !j.redirect_url) continue;
        // Dedupe across queries by listing URL.
        if (!byUrl.has(j.redirect_url)) {
          byUrl.set(j.redirect_url, {
            title: j.title,
            url: j.redirect_url,
            content: buildContent(j),
            source: 'adzuna',
          });
        }
      }
    } catch (error) {
      console.error(`Adzuna "${what}" error:`, error);
    }
  }

  const leads = [...byUrl.values()];
  console.log(`Adzuna: ${leads.length} unique postings across ${QUERIES.length} queries`);
  return leads;
}
