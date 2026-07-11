// Serper search source (GLI lane).
//
// Whole-web Google search via Serper (https://google.serper.dev/search). This
// replaces the Google Custom Search source for the GLI lane: Google closed the
// Custom Search JSON API to new projects in early 2026 (403 forbidden regardless
// of correct setup), and Serper searches the whole web rather than a fixed set
// of curated domains.
//
// MULTI-REGION COVERAGE. Serper defaults to US-biased results, so the GLI lane
// would miss the Gulf / Asia / Europe leisure market. To get genuine global
// coverage without blowing the query budget, the run is two passes:
//   1. Default/global pass: the FULL query list once, no gl (catches everything).
//   2. Regional pass: a CORE subset of the strongest terms across each REGION,
//      using Serper's gl (country) and hl (language) parameters.
// Budget: CORE_TERMS (10) x REGIONS (9) = 90, plus the default full list (18) =
// 108 searches per run, under the MAX_SEARCHES_PER_RUN hard ceiling of 120. The
// total is logged and enforced. Serper free tier is 2,500 searches/month.
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

// Hard ceiling on searches issued per run. The plan below sits at 108; this
// backstops accidental budget blowups if the term/region lists grow.
const MAX_SEARCHES_PER_RUN = 120;

interface RegionSetting {
  gl: string; // Serper country code
  hl?: string; // Serper UI language (only set where it differs from default)
}

// Regions run for the CORE terms. Covers the Gulf (ae, sa), Asia-Pacific (sg,
// au), Europe (gb, de), and North America (us, ca) leisure markets, plus Mexico
// (mx) in Spanish. Add { gl: 'in' } / { gl: 'br' } here to widen further; each
// added region costs CORE_TERMS.length searches per run (watch the ceiling).
const REGIONS: RegionSetting[] = [
  { gl: 'us' },
  { gl: 'mx', hl: 'es' },
  { gl: 'gb' },
  { gl: 'ae' },
  { gl: 'sa' },
  { gl: 'sg' },
  { gl: 'au' },
  { gl: 'de' },
  { gl: 'ca' },
];

// The strongest ~10 GLI terms, run across every REGION. These are the highest-
// signal development/feasibility/operator queries and the ones that surface
// international projects; the remaining terms in the full list still run once in
// the default/global pass. Every entry here must also appear in the gli profile
// query list (profiles.ts) so the default pass covers it too.
const CORE_TERMS = [
  'theme park development',
  'waterpark feasibility',
  'integrated resort development',
  'resort feasibility',
  'hotel development feasibility',
  'casino development',
  'tourism master plan',
  'leisure destination development',
  'visitor attraction feasibility',
  'family entertainment center',
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

// One Serper call. Returns organic results, or [] on any failure (logged).
async function runQuery(q: string, region?: RegionSetting): Promise<SerperOrganic[]> {
  const body: Record<string, string> = { q };
  if (region) {
    body.gl = region.gl;
    if (region.hl) body.hl = region.hl;
  }
  const label = region ? `${q} [gl=${region.gl}${region.hl ? `,hl=${region.hl}` : ''}]` : `${q} [default]`;
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'X-API-KEY': API_KEY as string, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let detail = '';
      try {
        const errBody = (await res.json()) as SerperResponse;
        detail = errBody.message ? ` - ${errBody.message}` : '';
      } catch {
        /* ignore body parse errors */
      }
      console.error(`Serper "${label}" failed: HTTP ${res.status}${detail}`);
      return [];
    }
    const data = (await res.json()) as SerperResponse;
    return data.organic ?? [];
  } catch (error) {
    console.error(`Serper "${label}" error:`, error);
    return [];
  }
}

export async function scrapeSerper(queries: string[]): Promise<NormalizedLead[]> {
  lastSearchCount = 0;
  if (!API_KEY) {
    console.warn('Serper: SERPER_API_KEY not set, skipping source.');
    return [];
  }

  // Build the search plan: the full query list once (default/global), then the
  // core terms across each region.
  const plan: Array<{ q: string; region?: RegionSetting }> = [];
  for (const q of queries) plan.push({ q });
  for (const region of REGIONS) {
    for (const q of CORE_TERMS) plan.push({ q, region });
  }

  const byUrl = new Map<string, NormalizedLead>();
  let searches = 0;

  for (const step of plan) {
    if (searches >= MAX_SEARCHES_PER_RUN) {
      console.warn(
        `Serper: reached the hard ceiling of ${MAX_SEARCHES_PER_RUN} searches; ` +
          `stopping (planned ${plan.length}).`
      );
      break;
    }
    searches++;
    const items = await runQuery(step.q, step.region);
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
        value_estimate: null,
        source: 'gli_serper',
      });
    }
  }

  lastSearchCount = searches;
  const leads = [...byUrl.values()];
  console.log(
    `Serper: ${searches} searches (${queries.length} default + ${CORE_TERMS.length} core x ` +
      `${REGIONS.length} regions); ${leads.length} unique results.`
  );
  return leads;
}
