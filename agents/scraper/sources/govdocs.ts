// Government primary-document source (GLI Tier 2 lane, Pass 4). Captures the rich
// document types that do not live in Legistar council agendas: comprehensive
// plans and their amendments, and special-district documents (e.g. the Central
// Florida Tourism Oversight District at oversightdistrict.org, which functions
// like a local government). These are legally-mandated, high-value, early records
// that name specific parcels and projects (the CFTOD 2045 plan is the proof case).
//
// Config-driven per the replication principle: GOV_DOCUMENTS is a swappable list;
// add a jurisdiction's plan or district document as one entry and the lane points
// there. Each entry is fetched best-effort to confirm reachability; when the URL
// is a real file (PDF/office doc) has_primary_document is set true, otherwise the
// entry is still captured as a reference with the primary_document_url attached.
// On any failure it logs and continues, never crashing the run.

import type { NormalizedLead } from './types';
import type { SourceType } from '../../../lib/taxonomy';

const UA = 'philipkwong-agents/1.0 (+scraper)';

interface GovDoc {
  jurisdictionLabel: string;
  sourceType: SourceType;
  title: string;
  url: string;
  // Distinctive terms that mark an article as referencing THIS document. Used by
  // source-chaining (intelligence lane) to resolve a referenced-but-not-linked
  // primary document to its known, verified URL (never a guessed URL).
  matchTerms: string[];
  // Adoption / amendment date (ISO). Drives the Pass 2 government freshness gate
  // (within 18 months, amendments count as fresh). Null when unknown: the lead is
  // kept as undated (we cannot prove it stale), and the real date should be filled
  // in here so an old plan correctly archives.
  docDate?: string | null;
}

// STARTER config (swappable; add plans / special-district docs as one line each).
// Point url at the actual plan document (PDF preferred) so has_primary_document
// reflects a real fetched file; the landing page still captures the reference.
const GOV_DOCUMENTS: GovDoc[] = [
  {
    jurisdictionLabel: 'Central Florida Tourism Oversight District, FL',
    sourceType: 'Comprehensive Plan',
    title: 'CFTOD 2045 Comprehensive Plan',
    url: 'https://www.oversightdistrict.org/',
    docDate: null,
    matchTerms: ['cftod', 'oversight district', 'central florida tourism', 'reedy creek'],
  },
];

// Source-chaining resolution from config: when an article references a KNOWN
// configured primary document (by its distinctive terms), return that document's
// verified URL. This resolves the proof case (a Blooloop article referencing the
// CFTOD plan) to the real district document without guessing a URL. hasFile is
// false: this is a resolved reference to the primary source, not a fetched file.
export function configuredPrimaryDocument(text: string): { url: string; hasFile: boolean } | null {
  const lower = text.toLowerCase();
  for (const d of GOV_DOCUMENTS) {
    if (d.matchTerms.some((t) => lower.includes(t.toLowerCase()))) {
      return { url: d.url, hasFile: false };
    }
  }
  return null;
}

function stripHtml(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchDoc(d: GovDoc): Promise<NormalizedLead> {
  let reachable = false;
  let isFile = false;
  let snippet = '';
  try {
    const res = await fetch(d.url, {
      headers: { 'User-Agent': UA, Accept: '*/*' },
      signal: AbortSignal.timeout(30000),
    });
    reachable = res.ok;
    const ct = res.headers.get('content-type') ?? '';
    isFile = reachable && (/pdf|officedocument|msword|octet-stream/i.test(ct) || /\.(pdf|docx?)(\?|$)/i.test(d.url));
    if (reachable && ct.includes('html')) {
      snippet = stripHtml(await res.text()).slice(0, 1200);
    }
  } catch (error) {
    console.warn(`Gov document "${d.title}": fetch failed (${String(error).slice(0, 70)}).`);
  }

  return {
    title: d.title,
    url: d.url,
    raw_content: [
      `Government document: ${d.title}`,
      `Jurisdiction: ${d.jurisdictionLabel}`,
      `Type: ${d.sourceType}`,
      `Primary document: ${d.url}`,
      `Reachable: ${reachable ? 'yes' : 'no'}; primary file fetched: ${isFile ? 'yes' : 'no'}`,
      snippet ? `\n${snippet}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    company: d.jurisdictionLabel,
    location: d.jurisdictionLabel,
    deadline: null,
    published_date: d.docDate ?? null,
    value_estimate: null,
    source: 'govdoc',
    source_type: d.sourceType,
    primary_document_url: d.url,
    has_primary_document: isFile,
  };
}

export async function scrapeGovDocs(): Promise<NormalizedLead[]> {
  const settled = await Promise.allSettled(GOV_DOCUMENTS.map(fetchDoc));
  const leads: NormalizedLead[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') leads.push(r.value);
    else console.error('Gov document fetch rejected:', r.reason);
  }
  const withFile = leads.filter((l) => l.has_primary_document).length;
  console.log(
    `Gov documents: ${leads.length} captured (${withFile} with a fetched primary file) across ${GOV_DOCUMENTS.length} configured.`
  );
  return leads;
}
