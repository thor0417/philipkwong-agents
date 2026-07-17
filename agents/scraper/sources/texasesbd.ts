// Texas Electronic State Business Daily (ESBD) source.
//
// Texas state + agency procurement (txsmartbuy.gov/esbd), including Houston-area
// and Gulf fleet fuel. The ESBD page is a NetSuite SuiteCommerce JS app, but its
// solicitation search is a server-side SSP service that returns clean JSON:
//
//   POST https://www.txsmartbuy.gov/app/extensions/CPA/CPAMain/1.0.0/
//        services/ESBD.Service.ss
//   body: { keyword, status, page }
//   -> { lines: [...], page, recordsPerPage, totalRecordsFound, agencies }
//
// Keyless. The service rejects GET (405) and expects a Backbone-style POST body,
// so a browser User-Agent plus Referer/Origin/X-Requested-With are sent. Like
// the other adapters this does NO relevance filtering (the ESBD keyword search
// is substring-based, so it returns e.g. "DIETHANOLAMIDE" for "ethanol"; the
// orchestrator's word-boundary prefilter drops those). On any failure it logs
// and returns [] WITHOUT throwing, so it never crashes the run.

import type { NormalizedLead } from './types';
import { toIso } from './types';

const SERVICE_URL =
  process.env.TXESBD_URL ??
  'https://www.txsmartbuy.gov/app/extensions/CPA/CPAMain/1.0.0/services/ESBD.Service.ss';

// Search terms. The ESBD search takes one keyword per request, so (as with
// SAM.gov) a small set is queried and results are deduped by URL. Fuel/ethanol
// terms first, then the core consulting terms, so the source is useful to every
// profile once the ethanol pilot is over. Override with a comma-separated list.
const QUERIES = (
  process.env.TXESBD_QUERIES ??
  'ethanol,biofuel,fuel,diesel,gasoline,consulting,regulatory,compliance,strategy,feasibility'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Page cap per query (recordsPerPage rows each). Bounds the run; logs if more.
const MAX_PAGES = Number(process.env.TXESBD_PAGES ?? '5');

// The service sits behind a load balancer that intermittently answers a POST
// with an empty 200 text/html (a session/routing warm-up) instead of the JSON,
// and some connections stall outright. So every page request is retried until it
// yields a non-empty JSON body, each attempt under a hard timeout. A page that
// never returns JSON is skipped, not fatal.
const MAX_ATTEMPTS = Number(process.env.TXESBD_ATTEMPTS ?? '5');
const REQUEST_TIMEOUT_MS = Number(process.env.TXESBD_TIMEOUT_MS ?? '20000');
// Gap between failed attempts. Deliberately longer than undici's keep-alive idle
// timeout (~4s) so the idle socket closes and the next attempt opens a NEW
// connection: the load balancer routes by connection, and a bad node keeps
// answering empty, so re-routing (not just retrying on the same socket) is what
// recovers. On success the loop stays fast on the live, good socket.
const RETRY_GAP_MS = Number(process.env.TXESBD_RETRY_GAP_MS ?? '4500');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Reduce a Set-Cookie header to a "name=value; name=value" Cookie string.
function cookieFromSetCookie(setCookie: string | null): string {
  if (!setCookie) return '';
  return setCookie
    .split(/,(?=[^;]+?=)/)
    .map((c) => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

interface EsbdLine {
  internalid?: number;
  title?: string;
  solicitationId?: string;
  responseDue?: string; // M/D/YYYY
  responseTime?: string; // e.g. "3:00 PM"
  agencyNumber?: string;
  agencyName?: string;
  statusName?: string;
  postingDate?: string;
  nigpCodes?: string;
}

interface EsbdResponse {
  lines?: EsbdLine[];
  page?: number;
  recordsPerPage?: number;
  totalRecordsFound?: number;
}

// Public solicitation detail page (the app routes /esbd/<solicitationId>).
function detailUrl(line: EsbdLine): string | null {
  if (line.solicitationId) return `https://www.txsmartbuy.gov/esbd/${line.solicitationId}`;
  if (line.internalid != null) return `https://www.txsmartbuy.gov/esbd/${line.internalid}`;
  return null;
}

// Combine ESBD's separate date + time fields into one parseable timestamp.
function dueIso(line: EsbdLine): string | null {
  if (!line.responseDue) return null;
  const combined = line.responseTime
    ? `${line.responseDue} ${line.responseTime}`
    : line.responseDue;
  return toIso(combined);
}

function buildContent(line: EsbdLine): string {
  return [
    `Solicitation: ${line.title ?? ''}`,
    `Agency: ${line.agencyName ?? 'unknown'} (${line.agencyNumber ?? ''})`,
    `Solicitation ID: ${line.solicitationId ?? ''}`,
    `Status: ${line.statusName ?? ''}`,
    `Posted: ${line.postingDate ?? ''}`,
    `Response due: ${line.responseDue ?? ''} ${line.responseTime ?? ''}`.trim(),
    `NIGP: ${line.nigpCodes ?? ''}`,
  ].join('\n');
}

// Cookie from a request that actually returned JSON. The load balancer routes by
// JSESSIONID, and the empty warm-up responses set a cookie pinned to a node that
// keeps answering empty. So we send a cookie ONLY once one has proven good (a
// JSON success), and send none before that so each attempt is freshly routed and
// can land on a working node.
let goodCookie = '';

// One POST attempt under a hard timeout. Returns the parsed JSON, or null on any
// soft failure (timeout, non-200, non-JSON, empty, or unparseable body).
async function attempt(keyword: string, page: number): Promise<EsbdResponse | null> {
  let res: Response;
  try {
    res = await fetch(SERVICE_URL, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: 'https://www.txsmartbuy.gov/esbd',
        Origin: 'https://www.txsmartbuy.gov',
        ...(goodCookie ? { Cookie: goodCookie } : {}),
      },
      body: JSON.stringify({ keyword, status: '', page }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return null; // aborted/timed out/network
  }
  if (!res.ok) return null;
  const text = await res.text();
  if (!text) return null; // empty warm-up page: do NOT adopt its cookie
  let json: EsbdResponse;
  try {
    json = JSON.parse(text) as EsbdResponse;
  } catch {
    return null; // served HTML/challenge instead of JSON
  }
  // Success: pin to this node's cookie for the rest of the run.
  const setCookie = cookieFromSetCookie(res.headers.get('set-cookie'));
  if (setCookie) goodCookie = setCookie;
  return json;
}

// Retry a page until it yields JSON, or give up after MAX_ATTEMPTS.
async function fetchPage(keyword: string, page: number): Promise<EsbdResponse | null> {
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    const data = await attempt(keyword, page);
    if (data) return data;
    if (i < MAX_ATTEMPTS) await sleep(RETRY_GAP_MS);
  }
  console.warn(`Texas ESBD "${keyword}" page ${page}: no JSON after ${MAX_ATTEMPTS} attempts, skipping.`);
  return null;
}

export async function scrapeTexasEsbd(): Promise<NormalizedLead[]> {
  const byUrl = new Map<string, NormalizedLead>();

  for (const keyword of QUERIES) {
    try {
      let page = 1;
      while (page <= MAX_PAGES) {
        const data = await fetchPage(keyword, page);
        if (!data) break;
        const lines = data.lines ?? [];
        for (const line of lines) {
          const url = detailUrl(line);
          if (!line.title || !url) continue;
          if (byUrl.has(url)) continue;
          byUrl.set(url, {
            title: line.title,
            url,
            raw_content: buildContent(line),
            company: line.agencyName ?? null,
            location: 'Texas, USA',
            deadline: dueIso(line),
            published_date: toIso(line.postingDate),
            value_estimate: null,
            source: 'texasesbd',
          });
        }

        const perPage = data.recordsPerPage || lines.length;
        const total = data.totalRecordsFound ?? lines.length;
        if (lines.length === 0 || perPage <= 0 || page * perPage >= total) break;
        if (page >= MAX_PAGES && page * perPage < total) {
          console.warn(`Texas ESBD "${keyword}": hit page cap (${MAX_PAGES}); more solicitations remain.`);
        }
        page++;
      }
    } catch (error) {
      // JS-gated / WAF / network: skip this term, keep the run alive.
      console.warn(`Texas ESBD "${keyword}" error (skipping): ${String(error).slice(0, 120)}`);
    }
  }

  const leads = [...byUrl.values()];
  console.log(`Texas ESBD: ${leads.length} unique solicitations across ${QUERIES.length} queries`);
  return leads;
}
