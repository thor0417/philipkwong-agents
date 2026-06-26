// Arbeitnow job-board source.
// Open API, no key: https://www.arbeitnow.com/api/job-board-api
// It is a single paginated feed (not keyword-searchable), so we page through it
// and let the orchestrator prefilter decide relevance. EU/remote heavy.

import type { NormalizedLead } from './types';

// How many pages to pull (each ~100 jobs). Kept modest to bound the run.
const MAX_PAGES = Number(process.env.ARBEITNOW_PAGES ?? '3');

interface ArbeitnowJob {
  slug?: string;
  company_name?: string;
  title?: string;
  description?: string;
  remote?: boolean;
  url?: string;
  tags?: string[];
  job_types?: string[];
  location?: string;
  created_at?: number;
}

interface ArbeitnowResponse {
  data?: ArbeitnowJob[];
}

// Descriptions come as HTML; reduce to plain text for the haystack.
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildContent(j: ArbeitnowJob): string {
  return [
    `Job posting: ${j.title ?? ''}`,
    `Company: ${j.company_name ?? 'unknown'}`,
    `Location: ${j.location ?? ''}${j.remote ? ' (remote)' : ''}`,
    `Tags: ${(j.tags ?? []).join(', ')}`,
    '',
    stripHtml(j.description ?? ''),
  ].join('\n');
}

export async function scrapeArbeitnow(): Promise<NormalizedLead[]> {
  const byUrl = new Map<string, NormalizedLead>();

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://www.arbeitnow.com/api/job-board-api?page=${page}`;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'philipkwong-agents/1.0 (+scraper)' },
      });
      if (!res.ok) {
        console.error(`Arbeitnow page ${page} failed: HTTP ${res.status}`);
        continue;
      }
      const data = (await res.json()) as ArbeitnowResponse;
      const jobs = data.data ?? [];
      if (jobs.length === 0) break;
      for (const j of jobs) {
        if (!j.title || !j.url) continue;
        if (byUrl.has(j.url)) continue;
        byUrl.set(j.url, {
          title: j.title,
          url: j.url,
          raw_content: buildContent(j),
          company: j.company_name || null,
          location: j.location || null,
          // created_at is a post date (unix epoch), not a closing date, so
          // deadline stays null.
          deadline: null,
          value_estimate: null,
          source: 'arbeitnow',
        });
      }
    } catch (error) {
      console.error(`Arbeitnow page ${page} error:`, error);
    }
  }

  const leads = [...byUrl.values()];
  console.log(`Arbeitnow: ${leads.length} unique postings across up to ${MAX_PAGES} pages`);
  return leads;
}
