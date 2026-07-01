// World Bank procurement notices source (consulting services).
//
// Keyless JSON API: https://search.worldbank.org/api/v2/procnotices
// Filtered to Consulting Services (procurement_group=CS) — the advisory,
// feasibility, and technical-assistance RFPs the consulting profile targets.
// Notices come back most-recent first; relevance is left to the orchestrator
// prefilter. On any failure it logs and returns [] without throwing.

import type { NormalizedLead } from './types';
import { toIso } from './types';

const API = 'https://search.worldbank.org/api/v2/procnotices';
const ROWS = Number(process.env.WORLDBANK_ROWS ?? '100');
const UA = 'philipkwong-agents/1.0 (+scraper)';

interface WbNotice {
  id?: string;
  notice_type?: string;
  notice_status?: string;
  submission_deadline_date?: string;
  project_ctry_name?: string;
  project_id?: string;
  project_name?: string;
  bid_reference_no?: string;
  bid_description?: string;
  procurement_method_name?: string;
  contact_organization?: string;
  notice_text?: string;
}

interface WbResponse {
  procnotices?: WbNotice[];
  total?: string;
}

function stripHtml(s: string | undefined): string {
  if (!s) return '';
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleOf(n: WbNotice): string {
  return n.bid_description || n.project_name || n.notice_type || '';
}

function buildContent(n: WbNotice): string {
  return [
    `Notice: ${titleOf(n)}`,
    `Type: ${n.notice_type ?? ''} (${n.procurement_method_name ?? ''})`,
    `Project: ${n.project_name ?? ''} [${n.project_id ?? ''}]`,
    `Country: ${n.project_ctry_name ?? ''}`,
    `Buyer: ${n.contact_organization ?? ''}`,
    `Reference: ${n.bid_reference_no ?? ''}`,
    '',
    stripHtml(n.notice_text).slice(0, 800),
  ].join('\n');
}

export async function scrapeWorldBank(): Promise<NormalizedLead[]> {
  const url = `${API}?format=json&rows=${ROWS}&procurement_group=CS`;
  let data: WbResponse;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    if (!res.ok) {
      console.error(`World Bank: HTTP ${res.status}`);
      return [];
    }
    data = (await res.json()) as WbResponse;
  } catch (error) {
    console.warn(`World Bank: fetch failed (${String(error).slice(0, 80)}); skipping (0 leads).`);
    return [];
  }

  const byUrl = new Map<string, NormalizedLead>();
  for (const n of data.procnotices ?? []) {
    if (!n.id) continue;
    const title = titleOf(n);
    if (!title) continue;
    const link = `https://projects.worldbank.org/en/projects-operations/procurement-detail/${n.id}`;
    if (byUrl.has(link)) continue;
    byUrl.set(link, {
      title,
      url: link,
      raw_content: buildContent(n),
      company: n.contact_organization ?? null,
      location: n.project_ctry_name ?? null,
      deadline: toIso(n.submission_deadline_date),
      value_estimate: null,
      source: 'worldbank',
    });
  }

  const leads = [...byUrl.values()];
  console.log(`World Bank: ${leads.length} consulting-services notices`);
  return leads;
}
