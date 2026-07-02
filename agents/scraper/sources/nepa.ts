// Jamaica NEPA (National Environmental and Planning Agency) EIA register —
// parseable static HTML.
//
// The EIA register (nepa.gov.jm/environmental-impact-assessments) is a static
// HTML table: counter, date (<time datetime>), project title, and EIA PDF links.
// A development EIA is the Jamaican pre-construction signal. The applicant is
// sometimes named in the title ("...by Tropical Sugar Company Limited",
// "Sandals..."), sometimes only in the PDF. signal_type 'development_application',
// regulator 'NEPA', country JM.
//
// NEPA's TLS chain is incomplete (server omits the intermediate cert), so Node's
// default fetch fails with UNABLE_TO_VERIFY_LEAF_SIGNATURE where a browser
// succeeds. We fetch over node:https with cert verification disabled FOR THIS
// SOURCE ONLY: it is public, read-only data and we send no credentials. On any
// failure it logs and returns [] without throwing.

import https from 'node:https';
import type { NormalizedLead } from './types';
import { toIso } from './types';

const BASE = 'https://www.nepa.gov.jm';
const REGISTER = `${BASE}/environmental-impact-assessments`;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
// The register is newest-first; the backfill cap drops old rows, so a couple of
// pages cover the recent window.
const PAGES = Number(process.env.NEPA_PAGES ?? '2');

// Jamaican parishes, for the lead location when the title names one.
const PARISHES = [
  'Kingston', 'St. Andrew', 'St Andrew', 'St. Catherine', 'St Catherine', 'Clarendon',
  'Manchester', 'St. Elizabeth', 'St Elizabeth', 'Westmoreland', 'Hanover', 'St. James',
  'St James', 'Trelawny', 'St. Ann', 'St Ann', 'St. Mary', 'St Mary', 'Portland', 'St. Thomas', 'St Thomas',
];

function decode(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&#x27;|&rsquo;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

function cell(row: string, key: string): string {
  const re = new RegExp(`headers="[^"]*${key}[^"]*"[^>]*>([\\s\\S]*?)<\\/td>`, 'i');
  return re.exec(row)?.[1] ?? '';
}

function parishFor(text: string): string | null {
  for (const p of PARISHES) if (new RegExp(`\\b${p.replace('.', '\\.')}\\b`, 'i').test(text)) return p.replace('St ', 'St. ');
  return null;
}

function applicantFor(title: string): string | null {
  const m = /\bby\s+([A-Z][A-Za-z0-9&'.-]*(?:\s+[A-Z][A-Za-z0-9&'.-]*){0,5})/.exec(title);
  return m ? m[1].trim() : null;
}

// GET over node:https with cert verification disabled (see file header).
function insecureGet(url: string): Promise<{ status: number; body: string } | null> {
  return new Promise((resolve) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }, rejectUnauthorized: false, timeout: 30000 },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: d }));
      }
    );
    req.on('error', (e) => {
      console.warn(`Jamaica NEPA: fetch failed (${String(e).slice(0, 60)}).`);
      resolve(null);
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

function parseRows(html: string): NormalizedLead[] {
  const out: NormalizedLead[] = [];
  for (const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = m[1];
    const title = decode(cell(row, 'view-title-table-column'));
    if (!title) continue; // header / non-data row
    const pdfCell = cell(row, 'view-field-pdf-table-column');
    const href = /href="([^"]+)"/i.exec(pdfCell)?.[1];
    // Canonical URL: the first EIA PDF (unique per filing); fall back to the
    // register anchored by title if no PDF is linked.
    const url = href
      ? href.startsWith('http')
        ? href
        : `${BASE}${href}`
      : `${REGISTER}#${encodeURIComponent(title.slice(0, 60))}`;
    const dateCell = cell(row, 'view-field-date-table-column');
    const datetime = /<time[^>]+datetime="([^"]+)"/i.exec(dateCell)?.[1] ?? null;
    const parish = parishFor(title);
    out.push({
      title,
      url,
      raw_content: [`Jamaica NEPA EIA / development application.`, `Project: ${title}`, parish ? `Parish: ${parish}` : ''].filter(Boolean).join('\n'),
      company: applicantFor(title),
      location: parish ?? 'Jamaica',
      deadline: null,
      value_estimate: null,
      source: 'nepa_jm',
      country: 'JM',
      signal_type: 'development_application',
      regulator: 'NEPA',
      project_description: title,
      signal_date: toIso(datetime)?.slice(0, 10) ?? null,
    });
  }
  return out;
}

export async function scrapeNepaJm(): Promise<NormalizedLead[]> {
  const byUrl = new Map<string, NormalizedLead>();
  for (let page = 0; page < PAGES; page++) {
    const res = await insecureGet(`${REGISTER}?page=${page}`);
    if (!res || res.status !== 200) break;
    const rows = parseRows(res.body);
    if (rows.length === 0) break;
    let added = 0;
    for (const l of rows) if (!byUrl.has(l.url)) (byUrl.set(l.url, l), added++);
    if (added === 0) break;
  }

  const leads = [...byUrl.values()];
  if (leads.length === 0) console.warn('Jamaica NEPA: 0 EIA rows parsed (unreachable or markup changed).');
  else console.log(`Jamaica NEPA: ${leads.length} EIA / development applications`);
  return leads;
}
