// Inter-American Development Bank (IADB) procurement notices source.
//
// The regional World Bank equivalent for Latin America and the Caribbean. Its
// open-data portal (data.iadb.org) is a CKAN instance; procurement notices live
// in a datastore resource queryable as keyless JSON via `datastore_search`. Like
// worldbank.ts: a recent pull plus keyword queries, merged and deduped by URL.
// Country and sector come back on every record, so LATAM_CARIB region tagging is
// name-based (iadb is a name-derived source in regions.ts). Contract-award
// notices are dropped at the boundary (dead, no deadline). On any failure it
// logs and returns [] without throwing.

import type { NormalizedLead } from './types';
import { toIso } from './types';

const ENDPOINT = 'https://data.iadb.org/api/3/action/datastore_search';
// Stable resource id for "Project Procurement Bidding Notices and Notification
// of Contract Awards". Overridable in case CKAN rotates it.
const RESOURCE_ID = process.env.IADB_RESOURCE_ID ?? '856aabfd-2c6a-48fb-a8b8-19f3ff443618';
const ROWS = Number(process.env.IADB_ROWS ?? '100');
const UA = 'philipkwong-agents/1.0 (+scraper)';

// Keyword (q) queries in addition to the recent pull, so tourism/feasibility
// work is surfaced specifically. Override with a comma-separated list.
const QUERIES = (process.env.IADB_QUERIES ??
  'tourism,hotel,resort,feasibility,theme park,waterpark,museum,aquarium,casino,' +
    'integrated resort,attraction,master plan,convention center,destination')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

interface IadbRecord {
  noticeid?: string;
  type?: string;
  countryname?: string;
  proyecturl?: string;
  documenturl?: string;
  noticetitle?: string;
  projectname?: string;
  publicationdate?: string;
  deadline?: string;
  sectorenglnm?: string;
  prcrmnt_mthd_engl_nm?: string;
  process_desc?: string;
}

interface IadbResponse {
  success?: boolean;
  result?: { total?: number; records?: IadbRecord[] };
}

// Contract-award notices are closed opportunities (and carry no deadline); drop
// them at the boundary, matching the repo's dead-lead handling elsewhere.
function isAward(type: string | undefined): boolean {
  return !!type && /award/i.test(type);
}

function buildContent(r: IadbRecord): string {
  return [
    `Notice: ${r.noticetitle ?? ''}`,
    `Type: ${r.type ?? ''} (${r.prcrmnt_mthd_engl_nm ?? ''})`,
    `Project: ${r.projectname ?? ''}`,
    `Country: ${r.countryname ?? ''}`,
    `Sector: ${r.sectorenglnm ?? ''}`,
    '',
    (r.process_desc ?? '').slice(0, 800),
  ].join('\n');
}

// One datastore_search call: the recent pull (no q) or a keyword query.
async function fetchNotices(q?: string): Promise<IadbRecord[]> {
  const url =
    `${ENDPOINT}?resource_id=${encodeURIComponent(RESOURCE_ID)}` +
    `&limit=${ROWS}&sort=${encodeURIComponent('publicationdate desc')}` +
    (q ? `&q=${encodeURIComponent(q)}` : '');
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!res.ok) {
      console.error(`IADB${q ? ` "${q}"` : ''}: HTTP ${res.status}`);
      return [];
    }
    const data = (await res.json()) as IadbResponse;
    if (!data.success) return [];
    return data.result?.records ?? [];
  } catch (error) {
    console.warn(`IADB${q ? ` "${q}"` : ''}: fetch failed (${String(error).slice(0, 60)}).`);
    return [];
  }
}

export async function scrapeIadb(): Promise<NormalizedLead[]> {
  const batches = await Promise.all([fetchNotices(), ...QUERIES.map((q) => fetchNotices(q))]);

  const byUrl = new Map<string, NormalizedLead>();
  let awardsDropped = 0;
  for (const records of batches) {
    for (const r of records) {
      if (isAward(r.type)) {
        awardsDropped++;
        continue;
      }
      const title = r.noticetitle || r.projectname || '';
      const url = r.documenturl || r.proyecturl || '';
      if (!title || !url) continue;
      if (byUrl.has(url)) continue;
      byUrl.set(url, {
        title,
        url,
        raw_content: buildContent(r),
        company: null,
        location: r.countryname ?? null,
        deadline: toIso(r.deadline),
        published_date: toIso(r.publicationdate),
        value_estimate: null,
        source: 'iadb',
      });
    }
  }

  const leads = [...byUrl.values()];
  console.log(
    `IADB: ${leads.length} procurement notices (recent + ${QUERIES.length} keyword queries; ${awardsDropped} awards dropped)`
  );
  return leads;
}
