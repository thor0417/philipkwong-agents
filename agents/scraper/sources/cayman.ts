// Cayman Islands Central Planning Authority (CPA) agendas — parseable PDF.
//
// CPA meeting agendas list planning applications, one regular line per item:
//   "2.1 BRYANT TERRY (GMJ Home Plan) Block 75A Parcel 250 (P23-0093) ($400,000) (EJ) 5"
// which yields applicant, agent, application ref P{YY}-{NNNN}, and value. The
// agenda PDFs carry a real text layer (no OCR). signal_type
// 'development_application', regulator 'Cayman CPA', country KY.
//
// Discovery: the authoritative site (planning.ky) is WAF/geo-gated and often
// unreachable here, so we try it, then fall back to the Cayman News Service
// library mirror (cnslibrary.com), then to a configured CAYMAN_AGENDA_URL. Most
// CPA items are residential/commercial and are dropped by the signals sector
// gate; only tourism items are captured. If application lines cannot be parsed
// from an agenda, we emit one agenda-level lead (full text) rather than nothing,
// so the gate can still find a hotel/resort item in the body. On any failure it
// logs and returns [] without throwing.

import https from 'node:https';
// @ts-ignore - declared in pdf-parse.d.ts
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import type { NormalizedLead } from './types';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const PLANNING_ARCHIVE = process.env.CAYMAN_ARCHIVE_URL ?? 'https://www.planning.ky/cpa-meeting-archives';
const MIRROR_SEARCH = 'https://www.cnslibrary.com/?s=CPA+agenda';
const AGENDA_OVERRIDE = process.env.CAYMAN_AGENDA_URL ?? '';
const MAX_AGENDAS = Number(process.env.CAYMAN_AGENDAS ?? '2');

const MONTHS: Record<string, string> = {
  jan: '01', january: '01', feb: '02', february: '02', mar: '03', march: '03',
  apr: '04', april: '04', may: '05', jun: '06', june: '06', jul: '07', july: '07',
  aug: '08', august: '08', sep: '09', sept: '09', september: '09', oct: '10', october: '10',
  nov: '11', november: '11', dec: '12', december: '12',
};

function getBuffer(url: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, rejectUnauthorized: false, timeout: 30000 }, (res) => {
      if ((res.statusCode ?? 0) >= 400) {
        res.resume();
        resolve(null);
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c as Buffer));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function getText(url: string): Promise<string | null> {
  const buf = await getBuffer(url);
  return buf ? buf.toString('utf8') : null;
}

// Meeting date from an agenda filename/URL: "...19-June-2024...", "...20-Feb-2019...".
function dateFromUrl(url: string): string | null {
  const m = /(\d{1,2})[-\s]([A-Za-z]+)[-\s](\d{4})/.exec(decodeURIComponent(url));
  if (!m) return null;
  const mm = MONTHS[m[2].toLowerCase()];
  if (!mm) return null;
  return `${m[3]}-${mm}-${m[1].padStart(2, '0')}`;
}

// Discover agenda PDF URLs, newest first.
async function discoverAgendas(): Promise<string[]> {
  if (AGENDA_OVERRIDE) return [AGENDA_OVERRIDE];
  const found = new Set<string>();
  for (const page of [PLANNING_ARCHIVE, MIRROR_SEARCH]) {
    const html = await getText(page);
    if (!html) continue;
    for (const m of html.matchAll(/href="([^"]+\.pdf[^"]*)"/gi)) {
      const href = m[1];
      if (/agenda/i.test(href)) found.add(href.startsWith('http') ? href : new URL(href, page).href);
    }
    if (found.size) break; // first reachable source with agendas wins
  }
  // Sort by parsed date desc; undated last.
  return [...found]
    .sort((a, b) => (dateFromUrl(b) ?? '').localeCompare(dateFromUrl(a) ?? ''))
    .slice(0, MAX_AGENDAS);
}

// One application line -> a signal. Tolerant of the whitespace pdf-parse emits.
const APP_RE =
  /(\d+\.\d+)\s+([A-Z][^()\n]{2,60}?)\s+\(([^)\n]{2,60})\)\s+Block\s+\S+\s+Parcel\s+\S+\s+\((P\d{2}-\d{4})\)\s*\(\$?([\d,]+)\)/g;

function parseApplications(text: string, url: string, date: string | null): NormalizedLead[] {
  const out: NormalizedLead[] = [];
  for (const m of text.matchAll(APP_RE)) {
    const [, item, applicantRaw, agent, ref, value] = m;
    const applicant = applicantRaw.replace(/\s+/g, ' ').trim();
    out.push({
      title: `CPA application ${ref}: ${applicant}`,
      url: `${url}#${ref}`,
      raw_content: [
        `Cayman CPA planning application (agenda item ${item}).`,
        `Applicant: ${applicant}`,
        `Agent: ${agent.trim()}`,
        `Application: ${ref}`,
      ].join('\n'),
      company: applicant,
      location: 'Cayman Islands',
      deadline: null,
      value_estimate: value ? `$${value}` : null,
      source: 'cayman_cpa',
      country: 'KY',
      signal_type: 'development_application',
      regulator: 'Cayman CPA',
      project_description: `Planning application ${ref} by ${applicant} (agent ${agent.trim()}).`,
      signal_date: date,
    });
  }
  return out;
}

export async function scrapeCaymanCpa(): Promise<NormalizedLead[]> {
  const agendas = await discoverAgendas();
  if (agendas.length === 0) {
    console.warn(
      'Cayman CPA: no agenda PDFs discovered (planning.ky gated/unreachable, mirror empty). Set CAYMAN_AGENDA_URL to enable. Skipping (0 leads).'
    );
    return [];
  }

  const leads: NormalizedLead[] = [];
  for (const url of agendas) {
    const buf = await getBuffer(url);
    if (!buf) continue;
    let text = '';
    try {
      text = (await pdfParse(buf)).text ?? '';
    } catch (error) {
      console.warn(`Cayman CPA: PDF parse failed for ${url} (${String(error).slice(0, 50)}).`);
      continue;
    }
    const date = dateFromUrl(url);
    const apps = parseApplications(text, url, date);
    if (apps.length > 0) {
      leads.push(...apps);
    } else {
      // Agenda-level fallback: capture the whole agenda so the sector gate can
      // still find a tourism item in the body rather than losing it entirely.
      leads.push({
        title: `Cayman CPA meeting agenda${date ? ` ${date}` : ''}`,
        url,
        raw_content: `Cayman CPA meeting agenda.\n${text.slice(0, 4000)}`,
        company: null,
        location: 'Cayman Islands',
        deadline: null,
        value_estimate: null,
        source: 'cayman_cpa',
        country: 'KY',
        signal_type: 'development_application',
        regulator: 'Cayman CPA',
        project_description: text.slice(0, 600),
        signal_date: date,
      });
    }
  }

  console.log(`Cayman CPA: ${leads.length} planning signals from ${agendas.length} agenda(s)`);
  return leads;
}
