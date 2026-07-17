// Adzuna job-postings source.
// Free API (requires ADZUNA_APP_ID + ADZUNA_APP_KEY). Country scoped to 'ca'.
// Skipped gracefully if keys are absent. Adzuna needs a search term per call, so
// it queries a curated consulting/regulatory/tech term list; the orchestrator
// prefilter then assigns each posting to a profile.

import type { NormalizedLead } from './types';
import { toIso } from './types';

const APP_ID = process.env.ADZUNA_APP_ID;
const APP_KEY = process.env.ADZUNA_APP_KEY;

// Location filter. Defaults to BC (Philip's home market); set ADZUNA_WHERE=''
// to search Canada-wide, or to another province/city to refocus.
const WHERE = process.env.ADZUNA_WHERE ?? 'British Columbia';

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
  'management consultant',
  'business consultant',
  'policy consultant',
  'health consultant',
  'pharmaceutical consultant',
  'technology consultant',
  'operations consultant',
  'project manager consultant',
  'advisory services',
  'business analyst Canada',
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
  // Posting date, ISO 8601 (e.g. "2026-04-01T14:00:00Z").
  created?: string;
}

interface AdzunaResponse {
  results?: AdzunaResult[];
}

function salaryText(j: AdzunaResult): string | null {
  if (!j.salary_min && !j.salary_max) return null;
  return `${j.salary_min ?? '?'}-${j.salary_max ?? '?'} CAD`;
}

function buildContent(j: AdzunaResult): string {
  return [
    `Job posting: ${j.title ?? ''}`,
    `Company: ${j.company?.display_name ?? 'unknown'}`,
    `Location: ${j.location?.display_name ?? 'Canada'}`,
    `Category: ${j.category?.label ?? ''}`,
    `Salary: ${salaryText(j) ?? 'not stated'}`,
    '',
    j.description ?? '',
  ].join('\n');
}

export async function scrapeAdzuna(): Promise<NormalizedLead[]> {
  if (!APP_ID || !APP_KEY) {
    console.warn('Adzuna: ADZUNA_APP_ID/ADZUNA_APP_KEY not set, skipping source.');
    return [];
  }

  const byUrl = new Map<string, NormalizedLead>();

  for (const what of QUERIES) {
    const url =
      `https://api.adzuna.com/v1/api/jobs/ca/search/1` +
      `?app_id=${APP_ID}&app_key=${APP_KEY}` +
      `&results_per_page=${RESULTS_PER_PAGE}` +
      `&what=${encodeURIComponent(what)}` +
      (WHERE ? `&where=${encodeURIComponent(WHERE)}` : '') +
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
        if (byUrl.has(j.redirect_url)) continue;
        byUrl.set(j.redirect_url, {
          title: j.title,
          url: j.redirect_url,
          raw_content: buildContent(j),
          company: j.company?.display_name ?? null,
          location: j.location?.display_name ?? null,
          deadline: null,
          published_date: toIso(j.created),
          value_estimate: salaryText(j),
          source: 'adzuna',
        });
      }
    } catch (error) {
      console.error(`Adzuna "${what}" error:`, error);
    }
  }

  const leads = [...byUrl.values()];
  console.log(
    `Adzuna: ${leads.length} unique postings across ${QUERIES.length} queries` +
      ` (where: ${WHERE || 'Canada-wide'})`
  );
  return leads;
}
