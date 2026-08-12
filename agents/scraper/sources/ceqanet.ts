// Part D: CEQA / CEQAnet (ceqanet.lci.ca.gov) state-level environmental filings.
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
import { bypassHits } from '../targets';
import { gateDecide, admissionLabel } from '../gate-decide';
import { CeqanetRowSchema, parseRecords } from './schemas';

const UA = 'Mozilla/5.0 (compatible; philipkwong-agents/1.0 +scraper)';

// CEQAnet moved from ceqanet.opr.ca.gov to ceqanet.lci.ca.gov (the Land Use and
// Climate Innovation host).
//
// THE URL IS THE UPSERT KEY, so a rehost is not a cosmetic change: leaving the
// old-host rows alone did not "keep them resolving", it stored every CEQA filing
// TWICE, once per host. Measured on the live corpus: 6 rows for 3 real filings,
// which is what made the OCVibe project read 20 records instead of 18.
//
// So the host is CANONICALISED before the URL becomes the key.
//
// THE FIRST VERSION OF THIS FIX LEFT THE BUG ABLE TO RECUR, and said so: it
// folded only the hosts listed below, so "the next rehost costs one line here".
// One line that nobody knows to write until the corpus has already doubled. The
// repair script keyed on the SCH NUMBER while the adapter keyed on the URL, so
// the two layers disagreed about what a CEQA filing IS, and the duplication was
// guaranteed to come back the next time the rendering changed.
//
// THE IDENTITY OF A CEQA FILING IS ITS SCH NUMBER. The URL is a rendering of
// that identity, and renderings change: a rehost, a protocol, a trailing slash,
// a stray query parameter. So the SCH is extracted first and the URL is REBUILT
// from it, by one constructor, everywhere. Both layers now key on the same
// thing because there is only one thing to key on.
//
// Recognition is host-agnostic and shape-strict: any host beginning `ceqanet.`
// (or any host already listed) serving the path `/Project/{sch}`. That is loose
// enough that the NEXT rehost folds with no code change at all, and tight enough
// that it cannot claim an unrelated record - it demands both the CEQAnet host
// prefix and CEQAnet's own path shape before it will touch a URL.
export const CEQANET_HOSTS = ['ceqanet.lci.ca.gov', 'ceqanet.opr.ca.gov'] as const;
export const CEQANET_CANONICAL_HOST = CEQANET_HOSTS[0];
const BASE = `https://${CEQANET_CANONICAL_HOST}`;

// An SCH number as CEQAnet prints it: digits, sometimes with a letter suffix.
// Anything else is not an SCH and must not be treated as one.
const SCH_SHAPE = /^[A-Z0-9][A-Z0-9-]{3,30}$/;

// Normalised SCH: trimmed, inner whitespace removed, upper case. So the same
// filing cannot render two ways because a source printed a space.
export function normalizeSch(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).replace(/\s+/g, '').toUpperCase();
  return SCH_SHAPE.test(s) ? s : null;
}

function isCeqanetHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h.startsWith('ceqanet.') || (CEQANET_HOSTS as readonly string[]).includes(h);
}

// The SCH a CEQAnet URL identifies, or null when the URL is not a CEQAnet
// project page. Null is the safe answer: guessing is how a genuinely distinct
// record gets merged away.
export function ceqanetSchOf(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (!isCeqanetHost(u.hostname)) return null;
    const m = u.pathname.match(/^\/Project\/([^/?#]+)\/?$/i);
    return m ? normalizeSch(decodeURIComponent(m[1])) : null;
  } catch {
    return null;
  }
}

// THE ONE PLACE A CEQAnet URL IS BUILT. Both the adapter and the repair go
// through it, so the key the adapter writes and the key the repair groups on are
// the same string by construction rather than by coincidence.
export function ceqanetUrlForSch(sch: string): string | null {
  const n = normalizeSch(sch);
  return n ? `${BASE}/Project/${n}` : null;
}

// Fold any CEQAnet project URL onto its canonical rendering. A URL this does not
// recognise is returned untouched.
export function canonicalCeqanetUrl(raw: string): string {
  const sch = ceqanetSchOf(raw);
  return sch ? (ceqanetUrlForSch(sch) as string) : raw;
}

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
  // Validated at the boundary: CEQAnet serves microdata scraped from HTML, so a
  // layout change shows up here as rejected rows rather than as a quiet zero.
  return parseRecords(
    CeqanetRowSchema,
    out.map((r) => ({ sch: r.sch, title: r.title, documentType: r.docType, leadAgency: r.agency, received: r.date })),
    { source: 'ceqanet', endpoint: 'Search' }
  ).records.map((r) => ({
    sch: r.sch,
    title: r.title,
    docType: r.documentType ?? '',
    agency: r.leadAgency ?? '',
    date: r.received ?? '',
  }));
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
  // Rows whose SCH number did not parse, so no key could be built for them.
  // Counted and reported rather than written under a guessed URL.
  unparsableSch: number;
}
export const ceqaStats: CeqaStats = { fetched: 0, kept: 0, bypassHits: 0, unparsableSch: 0 };

export async function scrapeCeqanet(): Promise<NormalizedLead[]> {
  const leads: NormalizedLead[] = [];
  const seen = new Set<string>();
  for (const q of QUERIES) {
    const rows = await fetchQuery(q.query);
    ceqaStats.fetched += rows.length;
    for (const r of rows) {
      const gateText = `${r.title} ${r.agency} ${r.docType}`;
      // Built from the SCH by the single constructor, never string-concatenated
      // here. A row whose SCH does not parse is SKIPPED rather than written
      // under a guessed key: a bad key is a permanent duplicate, and this lane
      // has already paid that price once.
      const url = ceqanetUrlForSch(r.sch);
      if (!url) {
        ceqaStats.unparsableSch++;
        continue;
      }
      // Routed through gateDecide so this lane and the measurement harness apply
      // one rule, and every candidate is recorded during a gate audit.
      const decision = gateDecide({
        source: 'ceqanet',
        market: r.agency || 'California',
        key: url,
        title: r.title.slice(0, 200),
        gate_text: gateText,
        bypass_mode: 'all',
      });
      if (!decision.admitted) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      if (decision.bypass) ceqaStats.bypassHits++;
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
          `Gate: ${admissionLabel(decision)}`,
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
