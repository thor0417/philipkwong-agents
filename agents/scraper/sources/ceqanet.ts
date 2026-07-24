// Part D: CEQA / CEQAnet (ceqanet.opr.ca.gov) state-level environmental filings.
// Every large California entertainment / mixed-use project files here, often
// earlier than municipal agendas. CEQAnet's free-text box is delegated to Google
// CSE (not a server API), but its Advanced Search IS server-side and fetchable,
// returning clean schema.org microdata rows (SCH number, document type, lead
// agency, received date, title). We query the target region (Orange County: OCVibe,
// Disneyland Forward, Anaheim) and keep rows that pass the government gate or a
// target bypass term. Captured as government leads linking the CEQAnet project page.
//
// On any failure this logs and continues.

import type { NormalizedLead } from './types';
import { governmentGate } from '../../../lib/taxonomy';
import { bypassHits, bypassesGate } from '../targets';

const UA = 'Mozilla/5.0 (compatible; philipkwong-agents/1.0 +scraper)';
const BASE = 'https://ceqanet.opr.ca.gov';

// Advanced Search filters that actually narrow server-side (verified live):
// County and DocumentType. Free text is Google-CSE only, so we scope by the target
// county and gate/target-filter the returned rows. Each query returns the latest
// matching documents (up to 100 shown).
// The exact LeadAgency dropdown value is "Anaheim, City of" (verified: 653 docs;
// "Anaheim"/"City of Anaheim" return 0). Anaheim is the OCVibe / Disneyland Forward
// lead agency, so this query is the target-rich one; County=Orange widens the net.
const QUERIES: { label: string; query: string }[] = [
  { label: 'Anaheim, City of (OCVibe / Disneyland Forward lead agency)', query: 'LeadAgency=Anaheim%2C+City+of' },
  { label: 'Orange County (wider net)', query: 'County=Orange' },
];

interface CeqaRow {
  sch: string;
  docType: string;
  agency: string;
  date: string; // ISO yyyy-mm-dd
  title: string;
}

function parseRows(html: string): CeqaRow[] {
  const out: CeqaRow[] = [];
  for (const m of html.matchAll(/<tr itemscope[\s\S]*?<\/tr>/g)) {
    const tr = m[0];
    const sch = (tr.match(/reportNumber">([^<]+)/) ?? [])[1]?.trim() ?? '';
    const docType = (tr.match(/articleSection">([^<]+)/) ?? [])[1]?.trim() ?? '';
    const agency = (tr.match(/sourceOrganization">([^<]+)/) ?? [])[1]?.trim() ?? '';
    const date = (tr.match(/datetime="([^"]+)"/) ?? [])[1]?.trim() ?? '';
    const title = (tr.match(/itemprop="name">([^<]+)/) ?? [])[1]?.trim() ?? '';
    if (sch && title) out.push({ sch, docType, agency, date, title });
  }
  return out;
}

async function fetchQuery(query: string): Promise<CeqaRow[]> {
  try {
    const res = await fetch(`${BASE}/Search?${query}`, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) {
      console.warn(`CEQAnet: Search?${query} -> HTTP ${res.status}.`);
      return [];
    }
    return parseRows(await res.text());
  } catch (error) {
    console.warn(`CEQAnet: query ${query} failed (${String(error).slice(0, 70)}).`);
    return [];
  }
}

function targetHitLine(text: string): string {
  const hits = bypassHits(text);
  if (!hits.length) return '';
  return `Target-term hits: ${[...new Set(hits.map((h) => h.term))].join(', ')}`;
}

export interface CeqaStats {
  fetched: number;
  kept: number;
  bypassHits: number;
}
export const ceqaStats: CeqaStats = { fetched: 0, kept: 0, bypassHits: 0 };

export async function scrapeCeqanet(): Promise<NormalizedLead[]> {
  const leads: NormalizedLead[] = [];
  const seen = new Set<string>();
  for (const q of QUERIES) {
    const rows = await fetchQuery(q.query);
    ceqaStats.fetched += rows.length;
    for (const r of rows) {
      const gateText = `${r.title} ${r.agency} ${r.docType}`;
      const verdict = governmentGate(gateText);
      const bypass = bypassesGate(gateText);
      if (!verdict.matched && !bypass) continue;
      const url = `${BASE}/Project/${r.sch}`;
      if (seen.has(url)) continue;
      seen.add(url);
      if (bypass) ceqaStats.bypassHits++;
      const hitLine = targetHitLine(gateText);
      const iso = r.date && !Number.isNaN(Date.parse(r.date)) ? new Date(r.date).toISOString() : null;
      leads.push({
        title: r.title.slice(0, 200),
        url,
        raw_content: [
          `CEQA filing (CEQAnet): ${r.title}`,
          `SCH number: ${r.sch}`,
          `Document type: ${r.docType}`,
          `Lead agency: ${r.agency}`,
          `Received: ${r.date || '(unknown)'}`,
          `Query: ${q.label}`,
          `Gate: ${bypass ? 'bypass' : verdict.reason}`,
          hitLine,
          `Project page: ${url}`,
        ]
          .filter(Boolean)
          .join('\n'),
        company: r.agency || 'California (CEQA lead agency)',
        location: r.agency || 'California',
        deadline: null,
        published_date: iso,
        value_estimate: null,
        source: 'ceqanet',
        source_type: 'Other',
        primary_document_url: url,
        has_primary_document: false,
      });
    }
  }
  ceqaStats.kept = leads.length;
  console.log(
    `CEQAnet: ${ceqaStats.fetched} rows fetched -> ${leads.length} filings kept (gate/target); ${ceqaStats.bypassHits} target bypass hits.`
  );
  return leads;
}
