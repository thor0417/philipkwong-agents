// NEW YORK CITY, LANE A: THE CEQR DOCUMENT INVENTORY.
//
// nyc-ceqr reads the two Socrata datasets and gets six columns and a milestone
// date. This reads what those columns POINT AT: the environmental review
// documents themselves - the EAS, the scoping documents, the lead agency letter,
// the determination of significance, the DEIS and the FEIS.
//
// It is an INVENTORY, not a reader. It answers "what documents exist, of what
// kind, at what URL, for which project", and stores that. Nothing is parsed out
// of a document here and nothing is written to the corpus. Measuring what 70
// projects yield is the point of the pass; deciding what to read out of them is
// the pass after it, and doing both at once is how a reader gets written against
// three examples.
//
// ---------------------------------------------------------------------------
// THE PUBLISHED URL IS DEAD, AND IT FAILS AS A 200
// ---------------------------------------------------------------------------
//
// The gezn-7mgk dataset publishes a per-project URL of the form
//
//   a002-ceqraccess.nyc.gov/ceqr/ProjectInformation/ProjectDetail/{id}-{ceqr}
//
// and that route no longer exists. It returns HTTP 200 with a body reading "Page
// Not Found - Error Code 404", which is the worst possible failure: every
// status-code check passes, every fetch-verification passes, and the content is
// a stock error page. nyc-ceqr.ts takes that URL as given and fetch-verifies it,
// so the verification has been passing on an error page.
//
// The live route is /ceqr/Details, reachable only through the search form.
//
// ---------------------------------------------------------------------------
// THE SEARCH IS ASP.NET WEBFORMS AND ITS EMPTY VALUE IS NOT EMPTY
// ---------------------------------------------------------------------------
//
// Three of the search fields are dropdowns whose "-- Select --" option has the
// literal value `XYU@2!`. Posting an empty string for them - the obvious thing,
// and what an empty field means everywhere else - returns
//
//   HTTP 200, "Internal Server Error - Error Code 500"
//
// A WRONG REQUEST HERE LOOKS LIKE THE SERVER BEING DOWN. That is worth stating
// plainly because it inverts the usual debugging instinct: a 500 from this host
// is far more likely to be our request than their outage, and a retry loop
// written on the other assumption would hammer a city server for nothing.
//
// ---------------------------------------------------------------------------
// THE DOCUMENT HREF IS ../Handlers/ AND IT MEANS IT
// ---------------------------------------------------------------------------
//
// Document links are written as `../Handlers/ProjectFile.ashx?...` on a page
// served from /ceqr/Details, so they resolve to /Handlers/ - one level ABOVE the
// application - and that is the path that works. The instinct is to read the
// `../` as a mistake and "correct" it to /ceqr/Handlers/, which is exactly the
// wrong move: measured, /Handlers/ returns HTTP 200 application/pdf, 244,973
// bytes beginning "%PDF-", and /ceqr/Handlers/ returns the 500 page.
//
// This is what the 500-not-404 note above is for. A wrong path here does not say
// "no such thing", it says "the server is broken", and a reader written against
// that signal will conclude the source is down and back off from a URL that was
// simply wrong. Both paths were tried side by side before this constant was set.
//
// ---------------------------------------------------------------------------
// THE FILE TYPE IS IN THE PATH, AND THE PATH IS IN THE QUERY STRING
// ---------------------------------------------------------------------------
//
// The `file=` parameter is base64 of the server-side Windows path, e.g.
//
//   2024\24DCP129K\eis\final_eis\24DCP129K_FEIS_04252025.zip
//
// so the document's KIND is knowable without fetching it: the directory segment
// is `eas`, `scope\draft_scope`, `scope\final_scope`, `lead_agency_letter`,
// `det_significance`, `eis\draft_eis` or `eis\final_eis`. That is what makes an
// inventory cheap: 70 projects cost 70 searches and 70 detail pages, and the
// type census needs no downloads at all.
//
// DEIS AND FEIS ARE .zip. The two documents with the most in them are archives
// containing a chapter per PDF, so any reader that reaches them needs an unzip
// step that the single-PDF readers do not have. The inventory records the
// extension so that cost is visible before anybody writes one.

import { setTimeout as sleep } from 'node:timers/promises';

export const CEQR_HOST = 'https://a002-ceqraccess.nyc.gov';
export const CEQR_SEARCH = `${CEQR_HOST}/ceqr/`;
// Where ../Handlers/ actually resolves to, one level above the application. A
// constant rather than a resolution rule, because the rule is the thing that
// gets "corrected" to /ceqr/Handlers/ by the next person who sees the ../ and
// assumes it is a typo. See the header for the measurement.
export const CEQR_HANDLER_BASE = `${CEQR_HOST}/Handlers/`;

const UA = 'philipkwong-agents/1.0 (+development intelligence; contact via nyc.gov open data)';

/** The sentinel the three dropdowns use for "no selection". Not the empty string. */
const NO_SELECTION = 'XYU@2!';

/**
 * WHAT KIND OF DOCUMENT THIS IS, read off the stored path.
 *
 * Ordered most specific first: `eis\draft_eis` must not be matched by a rule for
 * `eis`. Anything unrecognised is reported as its raw directory rather than
 * bucketed into 'other', because the point of an inventory is to find the kinds
 * nobody knew about.
 */
export type CeqrDocKind =
  | 'eas'
  | 'draft_scope'
  | 'final_scope'
  | 'lead_agency_letter'
  | 'det_significance'
  | 'draft_eis'
  | 'final_eis'
  | 'negative_declaration'
  | 'technical_memo'
  | string;

export function kindFromPath(path: string): CeqrDocKind {
  const p = path.replace(/\\/g, '/').toLowerCase();
  if (/\/eis\/draft_eis\//.test(p)) return 'draft_eis';
  if (/\/eis\/final_eis\//.test(p)) return 'final_eis';
  if (/\/scope\/draft_scope\//.test(p)) return 'draft_scope';
  if (/\/scope\/final_scope\//.test(p)) return 'final_scope';
  if (/\/lead_agency_letter\//.test(p)) return 'lead_agency_letter';
  if (/\/det_significance\//.test(p)) return 'det_significance';
  if (/\/neg_dec\//.test(p)) return 'negative_declaration';
  if (/\/tech_memo\//.test(p)) return 'technical_memo';
  if (/\/eas\//.test(p)) return 'eas';
  // The directory between the CEQR number and the filename, whatever it is.
  const m = /^[^/]+\/[^/]+\/(.+)\/[^/]+$/.exec(p);
  return m ? m[1] : 'unfiled';
}

// ---- THE DECODED PATH CARRIES A TRAILING BYTE THAT IS NOT PART OF IT --------
//
// The `file=` parameter is not padded to a multiple of four, so decoding it
// yields the path plus one stray character: `...24DCP129K_FEIS_04252025.zip5`
// and `..._Final_Scope_of_Work.pdf_10132023.pdf\r`. Read naively, the extension
// comes out as "zip5" and "pdf5", and the first census run duly reported that
// only 2 of 330 documents needed unzipping when the real number is 32: every
// DEIS and FEIS was typed as its own private file format and counted as
// readable.
//
// A DEFECT THAT INFLATES A CAPABILITY IS WORSE THAN ONE THAT BREAKS IT. Nothing
// failed; the number was just wrong in the direction that says the work is
// smaller than it is.
//
// So the extension is found by looking for a KNOWN extension and the path is
// truncated there. The LAST match, because the city writes the previous format
// into the filename: "Final_Scope_of_Work.pdf_10132023.pdf" is a PDF whose name
// records that it replaced a PDF, and the first ".pdf" in it is part of a name.
const KNOWN_EXTENSION = /\.(pdf|zip|docx?|html?|txt|xlsx?|pptx?)/gi;

export function normalisePath(raw: string): { path: string; extension: string } {
  const hits = [...raw.matchAll(KNOWN_EXTENSION)];
  const last = hits[hits.length - 1];
  if (!last || last.index === undefined) {
    // No extension we recognise. The trailing byte still has to go, and it is
    // stripped as "not printable ASCII or a stray trailing digit after a dot"
    // rather than blind, so a real filename ending in a digit survives.
    return { path: raw.replace(/[^\x20-\x7e]+$/, '').trim(), extension: '' };
  }
  return {
    path: raw.slice(0, last.index + last[0].length),
    extension: last[1].toLowerCase(),
  };
}

export interface CeqrDocument {
  ceqr: string;
  /** The link text, which is the filename without its extension. */
  label: string;
  kind: CeqrDocKind;
  /** 'pdf', 'zip', 'doc'. Lower-cased, no dot. */
  extension: string;
  /** The server-side path, decoded from the query string. Kept for the census. */
  storedPath: string;
  /** The URL that actually fetches, with the handler base corrected. */
  url: string;
  /** The date in the filename, ISO, when the filename carries one. */
  dateFromName: string | null;
}

export interface CeqrProjectDocuments {
  ceqr: string;
  detailUrl: string | null;
  documents: CeqrDocument[];
  /** Set when the project could not be reached, with what happened. */
  failure: string | null;
}

const decodeEntities = (s: string): string =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

function hiddenField(html: string, name: string): string {
  const m = new RegExp(`name="${name}"[^>]*value="([^"]*)"`).exec(html);
  return m ? decodeEntities(m[1]) : '';
}

/**
 * The filename's own date. Every CEQR filename this inventory has seen ends
 * MMDDYYYY, sometimes after a `.zip` that is part of the NAME rather than the
 * extension ("Final_Scope_of_Work.zip_12132024.zip").
 *
 * Returned as null rather than guessed when the digits are not a real date: a
 * document dated by a misread filename is worse than one with no date, because
 * the milestone order is what a reader would use it for.
 */
export function dateFromFilename(name: string): string | null {
  const m = /(?:^|[_-])(\d{2})(\d{2})(\d{4})(?:\D|$)/.exec(name);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  const iso = `${yyyy}-${mm}-${dd}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getUTCMonth() + 1 !== Number(mm) || d.getUTCDate() !== Number(dd)) return null;
  return iso;
}

/** A session: the cookie and the three ViewState tokens the form requires. */
interface Session {
  cookie: string;
  viewState: string;
  viewStateGenerator: string;
  eventValidation: string;
}

async function openSearch(): Promise<Session> {
  const res = await fetch(CEQR_SEARCH, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`CEQR search page: HTTP ${res.status}`);
  const html = await res.text();
  return {
    cookie: (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; '),
    viewState: hiddenField(html, '__VIEWSTATE'),
    viewStateGenerator: hiddenField(html, '__VIEWSTATEGENERATOR'),
    eventValidation: hiddenField(html, '__EVENTVALIDATION'),
  };
}

/**
 * Search by CEQR number and return the search-results HTML.
 *
 * A FRESH SESSION PER SEARCH. WebForms ViewState is per rendered page, and the
 * results page's ViewState is not the search page's, so reusing one across
 * projects returns the previous project's results or a 500. That is a real cost
 * - two requests per project instead of one - and it is the cost of the site
 * being what it is rather than something to optimise away.
 */
async function searchByCeqr(ceqr: string): Promise<{ html: string; cookie: string }> {
  const s = await openSearch();
  const body = new URLSearchParams({
    __LASTFOCUS: '',
    __EVENTTARGET: '',
    __EVENTARGUMENT: '',
    __VIEWSTATE: s.viewState,
    __VIEWSTATEGENERATOR: s.viewStateGenerator,
    __SCROLLPOSITIONX: '0',
    __SCROLLPOSITIONY: '0',
    __VIEWSTATEENCRYPTED: '',
    __EVENTVALIDATION: s.eventValidation,
    'ctl00$MainContent$txtKeyword': '',
    // The sentinel, not ''. An empty string here is what produces the 500 that
    // reads as an outage. See the header.
    'ctl00$MainContent$ddlLeadAgency': NO_SELECTION,
    'ctl00$MainContent$txtCeqrNumber': ceqr,
    'ctl00$MainContent$txtProjectName': '',
    'ctl00$MainContent$ddlCommunityDistrict': NO_SELECTION,
    'ctl00$MainContent$ddlBorough': NO_SELECTION,
    'ctl00$MainContent$txtBlock': '',
    'ctl00$MainContent$txtLot': '',
    'ctl00$MainContent$btnSearch': ' Search',
  });
  const res = await fetch(CEQR_SEARCH, {
    method: 'POST',
    headers: {
      'user-agent': UA,
      'content-type': 'application/x-www-form-urlencoded',
      cookie: s.cookie,
    },
    body,
  });
  const html = await res.text();
  // THE STATUS CODE IS NOT THE ANSWER ON THIS HOST. Both failure modes are
  // served as 200, so the body is what decides.
  if (/Internal Server Error/i.test(html)) {
    throw new Error(`CEQR search for ${ceqr}: server returned its 500 page as HTTP ${res.status}`);
  }
  if (/Page Not Found/i.test(html)) {
    throw new Error(`CEQR search for ${ceqr}: server returned its 404 page as HTTP ${res.status}`);
  }
  return { html, cookie: s.cookie };
}

/**
 * Every document link on a page, with the handler path corrected and the stored
 * path decoded.
 *
 * WHY THE LINK TEXT IS THE LABEL AND NOT A TITLE WE COMPOSE. The anchor text is
 * the filename, which is the city's own name for the document. Turning
 * "24DCP129K_Lead_Agency_Letter_1_05172024" into "Lead Agency Letter" is a
 * rewrite, and an inventory that rewrites what it inventories cannot be checked
 * against the source.
 */
export function documentsOnPage(html: string, ceqr: string): CeqrDocument[] {
  const out: CeqrDocument[] = [];
  const seen = new Set<string>();
  const re =
    /href="(\.\.\/Handlers\/ProjectFile\.ashx\?file=([^&"]+)&amp;signature=([^"]+))"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(re)) {
    const fileParam = m[2];
    const signature = m[3];
    let decoded = '';
    try {
      decoded = Buffer.from(
        fileParam.replace(/-/g, '+').replace(/_/g, '/'),
        'base64'
      ).toString('latin1');
    } catch {
      continue;
    }
    if (!decoded) continue;
    const label = m[4].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    if (seen.has(fileParam)) continue;
    seen.add(fileParam);
    // The extension of the stored PATH, not of the label: the label carries
    // ".zip" inside the NAME on the final scope of work, so reading the label
    // would type a PDF as an archive and vice versa. And the path has a stray
    // trailing byte - see normalisePath.
    const { path: storedPath, extension } = normalisePath(decoded);
    out.push({
      ceqr,
      label,
      kind: kindFromPath(storedPath),
      extension,
      storedPath,
      // ../Handlers resolved against the APPLICATION ROOT, not the page. See the
      // header: resolving it as written gives /Handlers/, which does not exist
      // and does not say so.
      url: `${CEQR_HANDLER_BASE}ProjectFile.ashx?file=${fileParam}&signature=${signature}`,
      dateFromName: dateFromFilename(label) ?? dateFromFilename(storedPath),
    });
  }
  return out;
}

/**
 * Every document CEQR Access holds for one project.
 *
 * Search, then follow the Details link, then enumerate. The search results page
 * ALSO carries some document links - the two most recent - so the details page
 * is what is enumerated: it carries the full set, and taking the search page's
 * two would be an inventory that silently stops at the newest milestone.
 */
export async function fetchCeqrDocuments(ceqr: string): Promise<CeqrProjectDocuments> {
  try {
    const { html, cookie } = await searchByCeqr(ceqr);
    const m = /href="(Details\?data=[^"]+)"/.exec(html);
    if (!m) {
      return {
        ceqr,
        detailUrl: null,
        documents: [],
        failure: 'the search returned no Details link for this CEQR number',
      };
    }
    const detailUrl = new URL(decodeEntities(m[1]), CEQR_SEARCH).toString();
    const res = await fetch(detailUrl, { headers: { 'user-agent': UA, cookie } });
    const detail = await res.text();
    if (/Internal Server Error/i.test(detail)) {
      return { ceqr, detailUrl, documents: [], failure: 'the detail page returned its 500 page' };
    }
    if (/Invalid Request/i.test(detail)) {
      return { ceqr, detailUrl, documents: [], failure: 'the detail page rejected the signed request' };
    }
    return { ceqr, detailUrl, documents: documentsOnPage(detail, ceqr), failure: null };
  } catch (e) {
    return { ceqr, detailUrl: null, documents: [], failure: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * RE-DERIVE EVERYTHING DERIVED, FROM THE TWO RAW HALVES.
 *
 * The inventory is cached to disk, and a cache holds whatever the parser said on
 * the day it was written. Twice already that has been wrong in a way that
 * survived the fix: the first run typed every archive as ".zip5", so the census
 * reported 2 documents needing an unzip step when the answer is 34; and it wrote
 * /ceqr/Handlers/ into every URL, which is the path that returns the 500 page,
 * so a sampling pass read nothing at all and reported it as the source failing.
 *
 * THE RAW HALVES ARE THE SIGNED QUERY STRING AND THE DECODED PATH. Everything
 * else - the kind, the extension, the host, the date - is computed off them, and
 * is recomputed here on every load rather than trusted. One implementation,
 * called by every reader of the cache, because the failure mode of caching a
 * derived value beside its raw source is that the two versions of the derivation
 * disagree and the stale one wins.
 */
export function rehydrate(projects: CeqrProjectDocuments[]): CeqrProjectDocuments[] {
  for (const p of projects) {
    for (const d of p.documents) {
      const { path, extension } = normalisePath(d.storedPath);
      d.storedPath = path;
      d.extension = extension;
      d.kind = kindFromPath(path);
      const q = d.url.indexOf('ProjectFile.ashx');
      if (q > -1) d.url = `${CEQR_HANDLER_BASE}${d.url.slice(q)}`;
      d.dateFromName = dateFromFilename(d.label) ?? dateFromFilename(path);
    }
  }
  return projects;
}

/**
 * The inventory for many projects, politely.
 *
 * SERIAL, WITH A PAUSE. This is a city server that answers a search in about a
 * second and returns a 500 rather than a 429 when it is unhappy, which means a
 * concurrency mistake here is indistinguishable from a wrong request. Two
 * requests per project times 70 projects is under three minutes serially and
 * there is nothing to gain by risking it.
 */
export async function fetchCeqrInventory(
  ceqrNumbers: string[],
  onProgress?: (done: number, total: number, result: CeqrProjectDocuments) => void
): Promise<CeqrProjectDocuments[]> {
  const out: CeqrProjectDocuments[] = [];
  for (const [i, ceqr] of ceqrNumbers.entries()) {
    const result = await fetchCeqrDocuments(ceqr);
    out.push(result);
    onProgress?.(i + 1, ceqrNumbers.length, result);
    if (i < ceqrNumbers.length - 1) await sleep(400);
  }
  return out;
}

// ---- THE BYTE CACHE, KEYED ON stored_path -----------------------------------
//
// THE DOWNLOAD IS THE WHOLE COST. Measured on two documents: 217s to fetch
// 7.79MB and 236.7s to fetch 7.78MB, about 33-35 KB/s, against 0.2s to parse the
// first three pages of either. A thousand to one. At that rate an exhaustive
// pass over the 330 documents in the inventory does not fit in a working day,
// and - worse - every re-run pays it again, so an iteration on the READER costs
// as much as the first fetch did.
//
// So bytes are cached on disk keyed on stored_path, which migration 036 already
// makes the identity for exactly this reason: the URL is signed per search
// session and expires, the path does not. A second run over the same document
// costs a stat.
//
// NOT IN THE REPO. It runs to hundreds of megabytes and every byte is
// re-fetchable. .ceqr-cache/ is gitignored, and the comment there says why.
//
// A ZIP IS NEVER FETCHED BY THIS. There are 34 of them, an unzip step does not
// exist, and downloading 34 archives to not read them would spend the schedule
// on nothing. Refused by name rather than skipped silently, so the count of what
// an archive step would add stays visible.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const CEQR_CACHE_DIR = '.ceqr-cache';

/** The cache file for a document. The hash is of the stable path, never the URL. */
export function cachePathFor(storedPath: string): string {
  return join(CEQR_CACHE_DIR, `${createHash('sha1').update(storedPath).digest('hex')}.bin`);
}

export interface FetchedBytes {
  bytes: Buffer | null;
  /** 'cache' | 'network' | a named negative. */
  how: string;
  seconds: number;
}

export async function fetchDocumentBytes(
  doc: CeqrDocument,
  opts: { timeoutMs?: number; allowZip?: boolean } = {}
): Promise<FetchedBytes> {
  const started = Date.now();
  const secs = () => (Date.now() - started) / 1000;
  if (doc.extension === 'zip' && !opts.allowZip) {
    return { bytes: null, how: 'refused: archive, and no unzip step exists', seconds: secs() };
  }
  const file = cachePathFor(doc.storedPath);
  if (existsSync(file) && statSync(file).size > 0) {
    return { bytes: readFileSync(file), how: 'cache', seconds: secs() };
  }
  try {
    const res = await fetch(doc.url, {
      headers: { 'user-agent': UA },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 300_000),
    });
    if (!res.ok) return { bytes: null, how: `HTTP ${res.status}`, seconds: secs() };
    const type = res.headers.get('content-type') ?? '';
    const buf = Buffer.from(await res.arrayBuffer());
    // THE HANDLER SERVES ITS ERROR PAGE AS 200. See the header: a status check
    // alone would cache an HTML error page as a PDF and every later run would
    // read it from disk without ever hitting the network again. The cache makes
    // a soft failure permanent, so the body is checked BEFORE it is written.
    if (/html/i.test(type) || buf.subarray(0, 5).toString('latin1') === '<!DOC') {
      return { bytes: null, how: 'the handler returned an HTML error page as HTTP 200', seconds: secs() };
    }
    mkdirSync(CEQR_CACHE_DIR, { recursive: true });
    writeFileSync(file, buf);
    return { bytes: buf, how: 'network', seconds: secs() };
  } catch (e) {
    const timedOut = e instanceof Error && /timed?\s*out|abort/i.test(e.name + e.message);
    return {
      bytes: null,
      how: timedOut ? `timed out after ${secs().toFixed(0)}s` : String(e).slice(0, 120),
      seconds: secs(),
    };
  }
}
