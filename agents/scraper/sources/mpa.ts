// Singapore MPA bunker registry (Track B).
//
// The Maritime and Port Authority of Singapore publishes the authoritative lists
// of licensed bunker suppliers and licensed bunker craft operators in the Port
// of Singapore as PDFs (served from /api/media/<guid>). This adapter downloads
// both PDFs, extracts company names, and emits RegistryLead rows. These are
// licensed entities (legitimate by definition): the orchestrator writes them
// with a fixed baseline score and skips the broker-filter and Haiku entirely.
//
// FRAGILE / best-effort: the media GUIDs are date-stamped and rotate (quarterly
// refresh); override via env when they change. On any failure: log + [].

// @ts-ignore - declared in pdf-parse.d.ts
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import type { RegistryLead } from './types';

const SUPPLIERS_URL =
  process.env.MPA_SUPPLIERS_URL ??
  'https://www.mpa.gov.sg/api/media/e14137a5-efbb-4147-892f-2ff0b7a8d309/list.pdf';
const CRAFT_URL =
  process.env.MPA_CRAFT_URL ??
  'https://www.mpa.gov.sg/api/media/fac49436-d459-48b3-9100-70aaa6bc0883/list.pdf';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();

async function fetchPdfText(url: string, label: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) {
      console.warn(`MPA: ${label} PDF returned HTTP ${res.status}; skipping.`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const data = await pdfParse(buf);
    return data.text;
  } catch (error) {
    console.warn(`MPA: ${label} PDF failed (${String(error).slice(0, 80)}); skipping.`);
    return null;
  }
}

// Suppliers list: all-caps, "<S/N> NAME ... PTE LTD" (names may wrap lines, no
// embedded addresses), so a lazy match from the S/N to the first PTE LTD is safe.
function parseSuppliers(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(
    /\b\d{1,3}\s+([A-Z(][\s\S]*?(?:\(PTE\)|PTE)\.?\s*(?:LTD|LIMITED)\.?)/g
  )) {
    const name = clean(m[1]);
    if (name.length >= 4 && name.length <= 90) out.add(name);
  }
  return [...out];
}

// Craft operators list: "<S/N>. Name Pte Ltd <address>" per line; capture up to
// and including the Pte Ltd terminator on that line.
function parseCraft(text: string): string[] {
  const out = new Set<string>();
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*\d{1,3}\.\s+(.+?(?:\(?Pte\)?\.?\s*(?:Ltd|Limited)\.?))\b/i);
    if (m) {
      const name = clean(m[1]);
      if (name.length >= 4 && name.length <= 90) out.add(name);
    }
  }
  return [...out];
}

function toLeads(names: string[], licenseType: string, sourceUrl: string): RegistryLead[] {
  return names.map((company) => ({
    company,
    license_type: licenseType,
    port: 'Singapore',
    region: 'SG',
    status: 'licensed',
    // Unique per company (the leads.url column is unique); anchors to the source list.
    url: `${sourceUrl}#${encodeURIComponent(company.toLowerCase().replace(/\s+/g, '-'))}`,
    source: 'mpa',
    raw_content: `${licenseType} licensed by MPA Singapore: ${company} (Port of Singapore).`,
  }));
}

export async function scrapeMpaRegistry(): Promise<RegistryLead[]> {
  const leads: RegistryLead[] = [];

  const suppliers = await fetchPdfText(SUPPLIERS_URL, 'suppliers');
  if (suppliers) {
    const names = parseSuppliers(suppliers);
    console.log(`MPA: ${names.length} licensed bunker suppliers`);
    leads.push(...toLeads(names, 'bunker supplier', SUPPLIERS_URL));
  }

  const craft = await fetchPdfText(CRAFT_URL, 'craft operators');
  if (craft) {
    const names = parseCraft(craft);
    console.log(`MPA: ${names.length} licensed bunker craft operators`);
    leads.push(...toLeads(names, 'bunker craft operator', CRAFT_URL));
  }

  if (leads.length === 0) {
    console.warn('MPA: 0 registry leads (PDF URLs may have rotated or format changed).');
  }
  return leads;
}
