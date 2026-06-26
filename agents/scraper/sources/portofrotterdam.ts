// Port of Rotterdam bunker registry (Track B).
//
// The Port of Rotterdam Authority publishes its licensed bunker permit holders
// (and their barges) as a PDF. This adapter downloads that PDF, extracts the
// license-holder companies, and emits RegistryLead rows. Licensed entities are
// legitimate by definition: the orchestrator writes them with a fixed baseline
// score and skips the broker-filter and Haiku.
//
// The PDF lists, per holder, the company (mixed case) followed by its barges
// (ALL CAPS) each suffixed with an ENI number. Company lines are the ones that
// contain a lowercase letter and do not end in an ENI number.
//
// FRAGILE / best-effort: the PDF path is date-stamped and rotates; override via
// env when it changes. On any failure: log + [].

// @ts-ignore - declared in pdf-parse.d.ts
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import type { RegistryLead } from './types';

const PERMIT_URL =
  process.env.ROTTERDAM_PERMIT_URL ??
  'https://www.portofrotterdam.com/sites/default/files/2024-06/bunker-permit-and-facility_1.pdf';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();

function parseLicenseHolders(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.split('\n')) {
    const line = clean(raw);
    if (line.length < 3) continue;
    if (/license holder/i.test(line)) continue; // column header (repeats per page)
    if (line.toUpperCase() === 'ENI') continue; // barge-id column header
    if (/\d{4,}\s*$/.test(line)) continue; // barge name + ENI number
    if (!/[a-z]/.test(line)) continue; // ALL-CAPS barge name
    out.add(line);
  }
  return [...out];
}

export async function scrapeRotterdamRegistry(): Promise<RegistryLead[]> {
  let text: string;
  try {
    const res = await fetch(PERMIT_URL, { headers: { 'User-Agent': UA } });
    if (!res.ok) {
      console.warn(`Port of Rotterdam: permit PDF returned HTTP ${res.status}; skipping (0).`);
      return [];
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const data = await pdfParse(buf);
    text = data.text;
  } catch (error) {
    console.warn(`Port of Rotterdam: PDF failed (${String(error).slice(0, 80)}); skipping (0).`);
    return [];
  }

  const holders = parseLicenseHolders(text);
  const leads: RegistryLead[] = holders.map((company) => ({
    company,
    license_type: 'bunker supplier',
    port: 'Rotterdam',
    region: 'NL',
    status: 'licensed',
    url: `${PERMIT_URL}#${encodeURIComponent(company.toLowerCase().replace(/\s+/g, '-'))}`,
    source: 'portofrotterdam',
    raw_content: `Licensed bunker permit holder, Port of Rotterdam: ${company}.`,
  }));

  if (leads.length === 0) {
    console.warn('Port of Rotterdam: 0 registry leads (PDF URL may have rotated or format changed).');
  } else {
    console.log(`Port of Rotterdam: ${leads.length} licensed bunker permit holders`);
  }
  return leads;
}
