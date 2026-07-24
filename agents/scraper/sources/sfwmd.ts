// Part D: SFWMD e-permitting (South Florida Water Management District). Disney's
// central-Florida construction surfaces here as Environmental Resource Permits
// often before public announcements. The sfwmd.gov permit-search UI is a JS/Pega
// app (not scrapeable), but SFWMD publishes the same permit data through an OPEN
// ArcGIS REST feature service that IS fetchable as JSON. We query the Approved and
// Pending layers for Disney-entity applicants / projects and capture matches as
// government leads. Every match is a Disney target by construction (flagged).
//
// On any failure this logs and continues.

import type { NormalizedLead } from './types';
import { strongBypassHits } from '../targets';

const UA = 'Mozilla/5.0 (compatible; philipkwong-agents/1.0 +scraper)';
const ARCGIS = 'https://services1.arcgis.com/sDAPyc2rGRn7vf9B/arcgis/rest/services';
const LAYERS = [
  { name: 'Approved ERP', path: 'Approved_Environmental_Resource_Permits/FeatureServer/16' },
  { name: 'Pending ERP', path: 'Pending_Environmental_Resource_Applications/FeatureServer/14' },
];
// Disney-entity applicant / project name matches. WDPR and its affiliates file
// under several corporate names; Reedy Creek / Bay Lake are the district's assets.
const WHERE =
  "UPPER(FullNameOrCompany) LIKE '%DISNEY%' OR UPPER(PROJECT_NAME) LIKE '%DISNEY%'" +
  " OR UPPER(FullNameOrCompany) LIKE '%REEDY CREEK%' OR UPPER(PROJECT_NAME) LIKE '%REEDY CREEK%'" +
  " OR UPPER(PROJECT_NAME) LIKE '%BAY LAKE%'" +
  " OR UPPER(FullNameOrCompany) LIKE '%CENTRAL FLORIDA TOURISM%'";

interface ErpAttrs {
  APP_NO?: string;
  PERMIT_NO?: string;
  APP_PERMIT_NO?: string;
  PROJECT_NAME?: string;
  ApplicantName?: string;
  FullNameOrCompany?: string;
  PermitStatus?: string;
  AppStatus?: string;
  IssueDate?: number | null;
  AppReceivedDate?: number | null;
  FullAddress?: string;
  City?: string;
  State?: string;
  Link?: string;
}

const isoFromEpoch = (ms: number | null | undefined): string | null =>
  typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null;

async function queryLayer(path: string): Promise<ErpAttrs[]> {
  const url = `${ARCGIS}/${path}/query?where=${encodeURIComponent(WHERE)}&outFields=*&returnGeometry=false&f=json`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(45000) });
    if (!res.ok) {
      console.warn(`SFWMD: layer ${path} -> HTTP ${res.status}.`);
      return [];
    }
    const data = (await res.json()) as { features?: { attributes: ErpAttrs }[] };
    return (data.features ?? []).map((f) => f.attributes);
  } catch (error) {
    console.warn(`SFWMD: layer ${path} failed (${String(error).slice(0, 70)}).`);
    return [];
  }
}

export interface SfwmdStats {
  fetched: number;
  kept: number;
}
export const sfwmdStats: SfwmdStats = { fetched: 0, kept: 0 };

export async function scrapeSfwmd(): Promise<NormalizedLead[]> {
  const leads: NormalizedLead[] = [];
  const seen = new Set<string>();
  for (const layer of LAYERS) {
    const rows = await queryLayer(layer.path);
    sfwmdStats.fetched += rows.length;
    for (const a of rows) {
      const permitNo = a.APP_PERMIT_NO || a.PERMIT_NO || a.APP_NO || '';
      if (!permitNo) continue;
      const applicant = a.FullNameOrCompany || a.ApplicantName || '';
      const url = `https://www.sfwmd.gov/regpermitting#erp-${encodeURIComponent(permitNo)}`;
      if (seen.has(url)) continue;
      seen.add(url);
      const status = a.PermitStatus || a.AppStatus || '';
      const date = isoFromEpoch(a.IssueDate) ?? isoFromEpoch(a.AppReceivedDate);
      const title = `${a.PROJECT_NAME || 'SFWMD Environmental Resource Permit'} (${permitNo})`.slice(0, 200);
      const loc = [a.City, a.State].filter(Boolean).join(', ') || 'South Florida';
      const hits = [...new Set(strongBypassHits(`${applicant} ${a.PROJECT_NAME ?? ''}`).map((h) => h.term))];
      leads.push({
        title,
        url,
        raw_content: [
          `SFWMD Environmental Resource Permit (${layer.name})`,
          `Permit / application: ${permitNo}`,
          `Project: ${a.PROJECT_NAME ?? '(unnamed)'}`,
          `Applicant: ${applicant || '(unknown)'}`,
          `Status: ${status || '(unknown)'}`,
          `Address: ${a.FullAddress ?? loc}`,
          hits.length ? `Target-term hits: ${hits.join(', ')}` : '',
          `Source: SFWMD open ArcGIS ERP layer (${layer.path})`,
        ]
          .filter(Boolean)
          .join('\n'),
        company: applicant || 'SFWMD applicant',
        location: loc,
        deadline: null,
        published_date: date,
        value_estimate: null,
        source: 'sfwmd',
        source_type: 'Other',
        primary_document_url: 'https://www.sfwmd.gov/regpermitting',
        has_primary_document: false,
      });
    }
  }
  sfwmdStats.kept = leads.length;
  console.log(`SFWMD: ${sfwmdStats.fetched} ERP rows matched -> ${leads.length} Disney-entity permit leads.`);
  return leads;
}
