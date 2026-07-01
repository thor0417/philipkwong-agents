// TED EU (Tenders Electronic Daily) source.
// Keyless v3 search API: POST https://api.ted.europa.eu/v3/notices/search with
// an expert query. CPV filtering is profile-driven and split by group: the
// caller passes the fuel CPV list and the consulting CPV list separately, and
// each group is queried INDEPENDENTLY with its own result budget (LIMIT). This
// stops a high-volume group (consulting) from crowding a low-volume one (fuel)
// out of a single shared, date-sorted result page. Results are merged and
// deduped by URL. Nothing is hardcoded in the adapter.

import type { NormalizedLead } from './types';
import { toIso } from './types';

const ENDPOINT = 'https://api.ted.europa.eu/v3/notices/search';

// Recency window and per-group page size for the search.
const WINDOW_DAYS = Number(process.env.TEDEU_WINDOW_DAYS ?? '120');
const LIMIT = Number(process.env.TEDEU_LIMIT ?? '100');

interface TedNotice {
  'publication-number'?: string;
  'notice-title'?: Record<string, string | string[]>;
  'buyer-name'?: Record<string, string[]>;
  'deadline-receipt-request'?: string[];
  'place-of-performance'?: string[];
  links?: { html?: Record<string, string> };
}

interface TedResponse {
  notices?: TedNotice[];
  totalNoticeCount?: number;
}

// TED multilingual values are keyed by 3-letter code (eng, deu, ...) and may be
// a string or an array. Prefer English, fall back to the first available.
function pick(field: Record<string, string | string[]> | undefined): string | null {
  if (!field) return null;
  const order = ['eng', ...Object.keys(field)];
  for (const k of order) {
    const v = field[k];
    if (!v) continue;
    const s = Array.isArray(v) ? v[0] : v;
    if (s) return s;
  }
  return null;
}

function yyyymmdd(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function noticeToLead(n: TedNotice): NormalizedLead | null {
  const pub = n['publication-number'];
  const title = pick(n['notice-title']);
  const url = n.links?.html?.ENG ?? (pub ? `https://ted.europa.eu/en/notice/-/detail/${pub}` : null);
  if (!title || !url) return null;

  const buyer = pick(n['buyer-name']);
  const place = [...new Set((n['place-of-performance'] ?? []).filter(Boolean))].join(', ') || null;
  const deadline = toIso(n['deadline-receipt-request']?.[0]);

  return {
    title,
    url,
    raw_content: [
      `Tender: ${title}`,
      `Buyer: ${buyer ?? 'unknown'}`,
      `Place of performance: ${place ?? ''}`,
      `Deadline: ${n['deadline-receipt-request']?.[0] ?? ''}`,
      `Publication: ${pub ?? ''}`,
    ].join('\n'),
    company: buyer,
    location: place,
    deadline,
    value_estimate: null,
    source: 'tedeu',
  };
}

// One independent query for a single CPV group, with its own LIMIT budget.
async function searchTedGroup(cpvCodes: string[], label: string): Promise<NormalizedLead[]> {
  if (!cpvCodes.length) return [];

  const from = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const query =
    `classification-cpv IN (${cpvCodes.join(' ')})` +
    ` AND publication-date>=${yyyymmdd(from)}` +
    ` SORT BY publication-date DESC`;

  const body = {
    query,
    fields: [
      'publication-number',
      'notice-title',
      'links',
      'buyer-name',
      'deadline-receipt-request',
      'place-of-performance',
    ],
    limit: LIMIT,
    page: 1,
  };

  let data: TedResponse;
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`TED EU (${label}) search failed: HTTP ${res.status}`);
      return [];
    }
    data = (await res.json()) as TedResponse;
  } catch (error) {
    console.error(`TED EU (${label}) fetch error:`, error);
    return [];
  }

  const leads: NormalizedLead[] = [];
  for (const n of data.notices ?? []) {
    const lead = noticeToLead(n);
    if (lead) leads.push(lead);
  }

  console.log(
    `TED EU (${label}): ${leads.length} notices for ${cpvCodes.length} CPV codes (of ${data.totalNoticeCount ?? '?'} total)`
  );
  return leads;
}

// Query the fuel and consulting CPV groups independently (each with its own
// result budget), then merge and dedupe by URL.
export async function scrapeTedEu(
  fuelCpv: string[],
  consultingCpv: string[],
  leisureCpv: string[] = []
): Promise<NormalizedLead[]> {
  if (!fuelCpv.length && !consultingCpv.length && !leisureCpv.length) {
    console.warn('TED EU: no CPV codes passed, skipping source.');
    return [];
  }

  // Each group is queried independently with its own result budget, so the
  // low-volume leisure/feasibility group is not crowded out by consulting.
  const groups: Array<[string, string[]]> = [
    ['fuel', fuelCpv],
    ['consulting', consultingCpv],
    ['leisure', leisureCpv],
  ];

  const byUrl = new Map<string, NormalizedLead>();
  for (const [label, codes] of groups) {
    const leads = await searchTedGroup(codes, label);
    for (const l of leads) {
      if (!byUrl.has(l.url)) byUrl.set(l.url, l);
    }
  }

  const merged = [...byUrl.values()];
  console.log(`TED EU: ${merged.length} unique notices after merging fuel + consulting + leisure queries`);
  return merged;
}
