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
  // Single-purpose district / dedicated document source: the jurisdiction itself
  // is the signal, so the record bypasses the keyword gate entirely (every
  // document captured). All document sources here bypass by nature; the flag is
  // explicit so the config reads as a decision, per Part B rule 3.
  bypass: boolean;
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

// CONFIG (swappable; one line per document / index page). Each entry is fetched
// and VERIFIED before storing (never store a URL that errors, Part D URL rule).
// url points at a real document (PDF -> has_primary_document true) or an official
// index/portal page (HTML -> captured as a reference). Every entry bypasses the
// keyword gate: a special-district or a jurisdiction's own plan/agenda portal is
// the signal. Seeded with CFTOD (the Disney proof case), the agenda portals of the
// Part A jurisdictions that are NOT on Legistar (City of Las Vegas, Anaheim), and
// two verified Florida comprehensive-plan pages.
const CFTOD = 'Central Florida Tourism Oversight District, FL';
const CFTOD_TERMS = ['cftod', 'oversight district', 'central florida tourism', 'reedy creek'];
const GOV_DOCUMENTS: GovDoc[] = [
  {
    // The proven Disney chain: the ~400-page plan reserving specific theme-park
    // acreage. url is the real PDF (verified application/pdf), so
    // has_primary_document is true and source-chaining resolves references here.
    jurisdictionLabel: CFTOD,
    sourceType: 'Comprehensive Plan',
    title: 'CFTOD 2045 Comprehensive Plan',
    url: 'https://www.oversightdistrict.org/wp-content/uploads/2026/01/2045-CFTOD-Comprehensive-Plan.pdf',
    bypass: true,
    docDate: '2026-01-01',
    matchTerms: CFTOD_TERMS,
  },
  {
    jurisdictionLabel: CFTOD,
    sourceType: 'Council Agenda',
    title: 'CFTOD Board of Supervisors Agenda Packet - January 23, 2026',
    url: 'https://www.oversightdistrict.org/wp-content/uploads/2026/01/1-23-2026-BOS-Agenda-Packet-FINALcs.pdf',
    bypass: true,
    docDate: '2026-01-23',
    matchTerms: CFTOD_TERMS,
  },
  {
    jurisdictionLabel: CFTOD,
    sourceType: 'Council Agenda',
    title: 'CFTOD Board of Supervisors Agenda Packet - February 27, 2026',
    url: 'https://www.oversightdistrict.org/wp-content/uploads/2026/02/2-27-2026-BOS-Agenda-Packet-FINAL.pdf',
    bypass: true,
    docDate: '2026-02-27',
    matchTerms: CFTOD_TERMS,
  },
  {
    jurisdictionLabel: CFTOD,
    sourceType: 'Council Agenda',
    title: 'CFTOD Board of Supervisors Agenda Packet - March 27, 2026',
    url: 'https://www.oversightdistrict.org/wp-content/uploads/2026/03/3-27-2026-BOS-Agenda-Packet-FINAL.pdf',
    bypass: true,
    docDate: '2026-03-27',
    matchTerms: CFTOD_TERMS,
  },
  {
    jurisdictionLabel: CFTOD,
    sourceType: 'Council Agenda',
    title: 'CFTOD Notice of 2026 Regular Board Meetings',
    url: 'https://www.oversightdistrict.org/wp-content/uploads/2025/12/NOTICE-OF-2026-CFTOD-REGULAR-BOARD-MEETINGS.pdf',
    bypass: true,
    docDate: '2025-12-01',
    matchTerms: CFTOD_TERMS,
  },
  {
    // City of Las Vegas is NOT on public Legistar (Part A): its agenda portal is
    // the capture path so The Strat / Top Gun city-limit records are reachable.
    jurisdictionLabel: 'Las Vegas, NV',
    sourceType: 'Council Agenda',
    title: 'City of Las Vegas - Agendas and Minutes portal',
    url: 'https://www.lasvegasnevada.gov/Government/Agendas-Minutes',
    bypass: true,
    docDate: null,
    matchTerms: ['city of las vegas', 'las vegas city council', 'the strat', 'top gun'],
  },
  {
    // Anaheim is NOT on public Legistar (Part A): its agenda document portal is the
    // capture path for OCVibe / Disneyland Forward records.
    jurisdictionLabel: 'Anaheim, CA',
    sourceType: 'Council Agenda',
    title: 'City of Anaheim - Agenda documents portal',
    url: 'https://local.anaheim.net/docs_agend/',
    bypass: true,
    docDate: null,
    matchTerms: ['anaheim', 'ocvibe', 'disneyland forward', 'platinum triangle'],
  },
  {
    jurisdictionLabel: 'Orlando, FL',
    sourceType: 'Comprehensive Plan',
    title: 'City of Orlando Growth Management Plan (comprehensive plan)',
    url: 'https://www.orlando.gov/Our-Government/Departments-Offices/Economic-Development/City-Planning/Growth-Management-Plan',
    bypass: true,
    docDate: null,
    matchTerms: ['orlando growth management plan', 'orlando comprehensive plan'],
  },
  {
    jurisdictionLabel: 'Orange County, FL',
    sourceType: 'Comprehensive Plan',
    title: 'Orange County FL Comprehensive Plan (Vision 2050)',
    url: 'https://www.orangecountyfl.net/PlanningDevelopment/ComprehensivePlanning/Vision2050.aspx',
    bypass: true,
    docDate: null,
    matchTerms: ['vision 2050', 'orange county comprehensive plan'],
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

// Fetch and verify ONE document. Returns null when the URL does not resolve to a
// real page (HTTP not ok, or a network error): we never store a URL that errors.
async function fetchDoc(d: GovDoc): Promise<NormalizedLead | null> {
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

  if (!reachable) {
    console.warn(`Gov document "${d.title}": URL not reachable -> NOT stored (${d.url}).`);
    return null;
  }

  return {
    title: d.title,
    url: d.url,
    raw_content: [
      `Government document: ${d.title}`,
      `Jurisdiction: ${d.jurisdictionLabel}`,
      `Type: ${d.sourceType}`,
      isFile ? `Primary document: ${d.url}` : `Source page: ${d.url}`,
      `Verified reachable: yes; primary file fetched: ${isFile ? 'yes' : 'no (index/portal page)'}`,
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
    // A distinct primary-document link only when the url is a real document file.
    // Index/portal pages are the source url itself, not a separate primary doc.
    primary_document_url: isFile ? d.url : null,
    has_primary_document: isFile,
  };
}

export async function scrapeGovDocs(): Promise<NormalizedLead[]> {
  const settled = await Promise.allSettled(GOV_DOCUMENTS.map(fetchDoc));
  const leads: NormalizedLead[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') {
      if (r.value) leads.push(r.value);
    } else {
      console.error('Gov document fetch rejected:', r.reason);
    }
  }
  const withFile = leads.filter((l) => l.has_primary_document).length;
  console.log(
    `Gov documents: ${leads.length} of ${GOV_DOCUMENTS.length} configured captured (verified reachable; ${withFile} with a fetched primary file).`
  );
  return leads;
}
