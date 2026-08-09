// SODA (Socrata Open Data API) paging, shared by the three New York City
// adapters (nyc-zap, nyc-city-record, nyc-ceqr).
//
// One helper rather than three copies, because every SODA caller has to get the
// same three things right and they are all easy to get quietly wrong:
//
//   1. ORDER BY IS MANDATORY WHEN PAGING. SODA does not guarantee a stable row
//      order across requests, so $limit/$offset paging without an explicit
//      $order silently returns duplicates and skips rows. It does not error; it
//      just hands back a slightly different corpus every run. Every call here
//      must name an order column, and the type makes it non-optional.
//   2. A PAGE THAT ERRORS MUST NOT READ AS THE END OF THE DATA. A failed page
//      returns an error, and the caller stops with `complete: false`, so a
//      partial harvest is never reported as a full one.
//   3. SOCRATA REPORTS QUERY ERRORS AS HTTP 200 IN SOME SHAPES and as 4xx in
//      others. A JSON body carrying `errorCode` is an error whatever the status
//      line says, so it is detected on the body rather than the status.
//
// Keyless by design: NYC's portal serves these datasets without an app token at
// the throughput this lane needs. A token only raises the rate limit, so
// SOCRATA_APP_TOKEN is read when present and never required.

const UA = 'Mozilla/5.0 (compatible; philipkwong-agents/1.0 +scraper)';
const DOMAIN = 'data.cityofnewyork.us';

// SODA caps a single page at 50,000; 1,000 keeps each request small enough to
// retry cheaply and is well inside every dataset's limits.
export const SODA_PAGE = 1000;

export interface SodaQuery {
  // Socrata's four-by-four dataset id, e.g. 'hgx4-8ukb'.
  dataset: string;
  // Columns to return. Empty means every column.
  select?: string[];
  // A SoQL $where clause, already written in SoQL (not URL-encoded).
  where?: string;
  // REQUIRED. See note 1 above: paging without a stable order is a silent
  // correctness bug, so this is not optional and has no default.
  order: string;
  // Stop after this many rows. Guards against a filter that turns out to be
  // wider than intended.
  maxRows?: number;
}

export interface SodaResult<T = Record<string, unknown>> {
  rows: T[];
  // Requests issued, for the run report.
  pages: number;
  // False when a page failed: the rows are a PARTIAL harvest and the caller
  // must say so rather than treating the short result as "that is all there is".
  complete: boolean;
  // Why it stopped short, when it did.
  error: string | null;
  // True when maxRows stopped the harvest before the data ran out, so a capped
  // run never reads as an exhaustive one.
  capped: boolean;
}

function buildUrl(q: SodaQuery, limit: number, offset: number): string {
  const p = new URLSearchParams();
  if (q.select && q.select.length > 0) p.set('$select', q.select.join(','));
  if (q.where) p.set('$where', q.where);
  p.set('$order', q.order);
  p.set('$limit', String(limit));
  p.set('$offset', String(offset));
  return `https://${DOMAIN}/resource/${q.dataset}.json?${p.toString()}`;
}

// A Socrata error body, whatever the HTTP status. Returns the message, or null
// when the payload is a normal row array.
function sodaError(body: unknown): string | null {
  if (Array.isArray(body)) return null;
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>;
    const msg = o.message ?? o.error ?? o.errorCode;
    if (msg) return String(msg).slice(0, 200);
    return 'unrecognised Socrata response shape';
  }
  return 'unrecognised Socrata response shape';
}

async function fetchPage(url: string): Promise<{ rows: unknown[]; error: string | null }> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
        ...(process.env.SOCRATA_APP_TOKEN ? { 'X-App-Token': process.env.SOCRATA_APP_TOKEN } : {}),
      },
      signal: AbortSignal.timeout(60000),
    });
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return { rows: [], error: `HTTP ${res.status}: response was not JSON` };
    }
    const err = sodaError(body);
    if (err) return { rows: [], error: `HTTP ${res.status}: ${err}` };
    return { rows: body as unknown[], error: null };
  } catch (error) {
    return { rows: [], error: String(error).slice(0, 150) };
  }
}

// Page a dataset to exhaustion (or to maxRows). Never throws: a failure stops
// the harvest and is reported through `complete` and `error`.
export async function sodaFetchAll<T = Record<string, unknown>>(
  q: SodaQuery
): Promise<SodaResult<T>> {
  const rows: unknown[] = [];
  let pages = 0;
  let offset = 0;
  const max = q.maxRows ?? Number.POSITIVE_INFINITY;

  for (;;) {
    const want = Math.min(SODA_PAGE, max - rows.length);
    if (want <= 0) {
      return { rows: rows as T[], pages, complete: true, error: null, capped: true };
    }
    const { rows: page, error } = await fetchPage(buildUrl(q, want, offset));
    pages++;
    if (error) {
      return { rows: rows as T[], pages, complete: false, error, capped: false };
    }
    rows.push(...page);
    // A short page means the data ran out; a full page means there may be more.
    if (page.length < want) {
      return { rows: rows as T[], pages, complete: true, error: null, capped: false };
    }
    offset += page.length;
  }
}

// A single aggregate value ($select=count(*), max(col), ...). Used for the
// freshness and population probes the run report prints, so a stale source is
// named in the report rather than inferred from a low count.
export async function sodaScalar(
  dataset: string,
  select: string,
  where?: string
): Promise<string | null> {
  const p = new URLSearchParams();
  p.set('$select', select);
  if (where) p.set('$where', where);
  const { rows, error } = await fetchPage(`https://${DOMAIN}/resource/${dataset}.json?${p.toString()}`);
  if (error || rows.length === 0) return null;
  const first = rows[0] as Record<string, unknown>;
  const v = Object.values(first)[0];
  return v === undefined || v === null ? null : String(v);
}

// Escape a string for safe interpolation into a SoQL string literal. SoQL uses
// single quotes and escapes an embedded quote by doubling it.
export function soqlString(raw: string): string {
  return `'${raw.replace(/'/g, "''")}'`;
}

// A SoQL floating-timestamp literal for a date-only string, e.g. '2026-01-01'
// -> '2026-01-01T00:00:00'. Socrata rejects a bare date in a comparison.
export function soqlTimestamp(isoDate: string): string {
  const d = isoDate.length === 10 ? `${isoDate}T00:00:00` : isoDate;
  return `'${d}'`;
}
