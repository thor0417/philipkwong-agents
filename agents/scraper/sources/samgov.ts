// SAM.gov US federal opportunities source.
//
// NOTE: the spec listed this under "keyless" sources, but the SAM.gov
// Opportunities API (api.sam.gov/opportunities/v2/search) requires a data.gov
// api_key and a postedFrom/postedTo window. There is no keyless equivalent, so
// this adapter reads SAM_GOV_API_KEY and skips gracefully (with a warning) when
// it is absent. Set SAM_GOV_API_KEY in .env.local to enable it.

import type { NormalizedLead } from './types';
import { toIso } from './types';

const API_KEY = process.env.SAM_GOV_API_KEY;

// Posted-date window (the API requires both). Defaults to the last N days.
const WINDOW_DAYS = Number(process.env.SAMGOV_WINDOW_DAYS ?? '30');
const LIMIT = 100;

// Title keywords searched one at a time (the API matches on title).
const QUERIES = [
  'consulting',
  'regulatory',
  'compliance',
  'quality management',
  'strategy',
  'feasibility',
  'fuel',
  'diesel',
];

interface SamOpportunity {
  title?: string;
  solicitationNumber?: string;
  fullParentPathName?: string;
  postedDate?: string;
  type?: string;
  organizationType?: string;
  uiLink?: string;
  responseDeadLine?: string;
  placeOfPerformance?: {
    city?: { name?: string };
    state?: { name?: string };
    country?: { name?: string };
  };
}

interface SamResponse {
  opportunitiesData?: SamOpportunity[];
}

// MM/dd/yyyy as required by the SAM.gov API.
function fmt(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
}

function placeText(p?: SamOpportunity['placeOfPerformance']): string | null {
  if (!p) return null;
  const parts = [p.city?.name, p.state?.name, p.country?.name].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function buildContent(j: SamOpportunity): string {
  return [
    `Opportunity: ${j.title ?? ''}`,
    `Organization: ${j.fullParentPathName ?? j.organizationType ?? 'unknown'}`,
    `Type: ${j.type ?? ''}`,
    `Solicitation: ${j.solicitationNumber ?? ''}`,
    `Place of performance: ${placeText(j.placeOfPerformance) ?? ''}`,
    `Response deadline: ${j.responseDeadLine ?? ''}`,
  ].join('\n');
}

export async function scrapeSamGov(): Promise<NormalizedLead[]> {
  if (!API_KEY) {
    console.warn('SAM.gov: SAM_GOV_API_KEY not set, skipping source (API requires a key).');
    return [];
  }

  const now = new Date();
  const from = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const postedFrom = fmt(from);
  const postedTo = fmt(now);

  const byUrl = new Map<string, NormalizedLead>();

  for (const title of QUERIES) {
    const url =
      `https://api.sam.gov/opportunities/v2/search` +
      `?api_key=${encodeURIComponent(API_KEY)}` +
      `&title=${encodeURIComponent(title)}` +
      `&postedFrom=${encodeURIComponent(postedFrom)}` +
      `&postedTo=${encodeURIComponent(postedTo)}` +
      `&limit=${LIMIT}`;

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'philipkwong-agents/1.0 (+scraper)',
          Accept: 'application/json',
        },
      });
      if (!res.ok) {
        const hint =
          res.status === 404
            ? ' (api.sam.gov returned a gateway 404 with no body; the host is commonly unreachable from datacenter/cloud egress. Verify from an allowed network.)'
            : '';
        console.error(`SAM.gov "${title}" failed: HTTP ${res.status}${hint}`);
        continue;
      }
      const data = (await res.json()) as SamResponse;
      for (const j of data.opportunitiesData ?? []) {
        const link = j.uiLink;
        if (!j.title || !link) continue;
        if (byUrl.has(link)) continue;
        byUrl.set(link, {
          title: j.title,
          url: link,
          raw_content: buildContent(j),
          company: j.fullParentPathName || j.organizationType || null,
          location: placeText(j.placeOfPerformance),
          deadline: toIso(j.responseDeadLine),
          value_estimate: null,
          source: 'samgov',
        });
      }
    } catch (error) {
      console.error(`SAM.gov "${title}" error:`, error);
    }
  }

  const leads = [...byUrl.values()];
  console.log(`SAM.gov: ${leads.length} unique opportunities across ${QUERIES.length} queries`);
  return leads;
}
