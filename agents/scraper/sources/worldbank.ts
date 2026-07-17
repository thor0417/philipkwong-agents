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

// Keyword (qterm) queries run in addition to the recent-notices pull, so
// feasibility / tourism / leisure work is returned specifically rather than by
// chance of being in the most-recent window. Caribbean / Mexico / resort / hotel
// target the LATAM_CARIB origination territory directly (region tagging then
// keeps only the in-scope countries). Override with a comma-separated list.
const QUERIES = (process.env.WORLDBANK_QUERIES ??
  'tourism,feasibility,attraction,leisure,Caribbean,Mexico,resort,hotel,' +
    'theme park,waterpark,museum,aquarium,casino,integrated resort,master plan,' +
    'convention center,destination development,visitor economy')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

interface WbNotice {
  id?: string;
  notice_type?: string;
  notice_status?: string;
  // Notice publication date (e.g. "15-Jul-2026"); submission_date is the same day
  // in ISO. Distinct from submission_deadline_date (the bid deadline). Captured as
  // published_date so an undated-deadline notice still carries an age signal.
  noticedate?: string;
  submission_date?: string;
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
    `Published: ${n.noticedate ?? ''}`,
    '',
    stripHtml(n.notice_text).slice(0, 800),
  ].join('\n');
}

// One CS-notices fetch: the recent pull (no qterm) or a keyword query.
async function fetchNotices(qterm?: string): Promise<WbNotice[]> {
  const url =
    `${API}?format=json&rows=${ROWS}&procurement_group=CS` +
    (qterm ? `&qterm=${encodeURIComponent(qterm)}` : '');
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!res.ok) {
      console.error(`World Bank${qterm ? ` "${qterm}"` : ''}: HTTP ${res.status}`);
      return [];
    }
    const data = (await res.json()) as WbResponse;
    return data.procnotices ?? [];
  } catch (error) {
    console.warn(`World Bank${qterm ? ` "${qterm}"` : ''}: fetch failed (${String(error).slice(0, 60)}).`);
    return [];
  }
}

export async function scrapeWorldBank(): Promise<NormalizedLead[]> {
  // Recent CS notices plus a keyword query per term, deduped by URL.
  const batches = await Promise.all([fetchNotices(), ...QUERIES.map((q) => fetchNotices(q))]);

  const byUrl = new Map<string, NormalizedLead>();
  for (const notices of batches) {
    for (const n of notices) {
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
        published_date: toIso(n.noticedate) ?? toIso(n.submission_date),
        value_estimate: null,
        source: 'worldbank',
      });
    }
  }

  const leads = [...byUrl.values()];
  console.log(
    `World Bank: ${leads.length} consulting-services notices (recent + ${QUERIES.length} keyword queries)`
  );
  return leads;
}
