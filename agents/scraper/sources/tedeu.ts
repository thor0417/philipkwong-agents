// TED EU (Tenders Electronic Daily) source.
// Keyless v3 search API: POST https://api.ted.europa.eu/v3/notices/search with
// an expert query. CPV filtering is profile-driven: the caller passes the CPV
// code list (fuel codes under the fuel profile, consulting codes otherwise), so
// nothing is hardcoded in the adapter.

import type { NormalizedLead } from './types';
import { toIso } from './types';

const ENDPOINT = 'https://api.ted.europa.eu/v3/notices/search';

// Recency window and page size for the search.
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

export async function scrapeTedEu(cpvCodes: string[]): Promise<NormalizedLead[]> {
  if (!cpvCodes || cpvCodes.length === 0) {
    console.warn('TED EU: no CPV codes passed, skipping source.');
    return [];
  }

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
      console.error(`TED EU search failed: HTTP ${res.status}`);
      return [];
    }
    data = (await res.json()) as TedResponse;
  } catch (error) {
    console.error('TED EU fetch error:', error);
    return [];
  }

  const leads: NormalizedLead[] = [];
  for (const n of data.notices ?? []) {
    const pub = n['publication-number'];
    const title = pick(n['notice-title']);
    const url = n.links?.html?.ENG ?? (pub ? `https://ted.europa.eu/en/notice/-/detail/${pub}` : null);
    if (!title || !url) continue;

    const buyer = pick(n['buyer-name']);
    const place = [...new Set((n['place-of-performance'] ?? []).filter(Boolean))].join(', ') || null;
    const deadline = toIso(n['deadline-receipt-request']?.[0]);

    leads.push({
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
    });
  }

  console.log(
    `TED EU: ${leads.length} notices for ${cpvCodes.length} CPV codes (of ${data.totalNoticeCount ?? '?'} total)`
  );
  return leads;
}
