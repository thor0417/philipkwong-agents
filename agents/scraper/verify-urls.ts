// STORED LINKS, ACTUALLY VERIFIED. Every URL in the corpus is a promise to a
// client that a document exists and can be opened.
//
//   npm run verify:urls
//   npm run verify:urls -- nyc-ceqr nyc-zap
//
// ---------------------------------------------------------------------------
// WHY THIS FILE WAS REWRITTEN: IT REPORTED 325 OF 325 RESOLVING WHILE 114 WERE
// DEAD.
// ---------------------------------------------------------------------------
//
// The first version checked the HTTP STATUS CODE and nothing else. CEQR Access
// answers a retired project route with:
//
//     HTTP 200, 8,949 bytes, <h1>Page Not Found</h1>
//
// A status check passes that. It passes it for EVERY id, including ones the
// dataset itself publishes, and it passes it for a deliberately invalid id -
// the responses are byte-identical. So the audit could not have failed, on any
// input, and its "zero broken" result carried no information at all.
//
// That is worse than having no audit: a check that cannot fail is read as
// evidence when it is only ceremony. The five-URL spot check it replaced was at
// least visibly a sample.
//
// THREE FAILURE MODES, AND ONLY ONE OF THEM IS A STATUS CODE:
//
//   HARD 404      status says so.                     City Record does this.
//   SOFT 404      status 200, body says not found.    CEQR Access does this.
//   OPAQUE SPA    status 200, IDENTICAL body for a
//                 valid and an invalid id, because
//                 the page is rendered by JavaScript
//                 after load.                          ZAP does this.
//
// The third cannot be settled by fetching at all, and pretending otherwise is
// what produced the false green. For those hosts the URL is verified against
// the PUBLISHING DATASET instead: the identifier either exists in the source of
// record or it does not, which is the real question the fetch was standing in
// for.
//
// EVERY HOST IS CALIBRATED AGAINST A CONTROL. Before auditing a host, this
// requests a deliberately invalid identifier on it and records the response. If
// a real URL is indistinguishable from that control, the host is opaque and is
// reported as UNVERIFIABLE rather than as passing. A control is the only thing
// that can tell "everything works" apart from "nothing is being checked".

import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../lib/supabase-admin';

const UA = 'Mozilla/5.0 (compatible; philipkwong-agents/1.0 +scraper)';
const CONCURRENCY = 6;

// Bodies that mean "no such record" while the status says 200.
const SOFT_404 = [
  /<h1[^>]*>\s*page not found\s*<\/h1>/i,
  /<title>\s*(?:404|page not found|not found)\s*<\/title>/i,
  /\bthe page you (?:are looking for|requested) (?:could not be found|does not exist)\b/i,
];

interface Fetched {
  status: number;
  body: string;
  bytes: number;
  error: string | null;
}

async function get(url: string, timeoutMs = 30000): Promise<Fetched> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await res.text();
    return { status: res.status, body, bytes: body.length, error: null };
  } catch (e) {
    // 0 means the fetch never completed: timeout, reset, DNS. NOT a 404, and
    // conflating the two produces false broken-link reports.
    return { status: 0, body: '', bytes: 0, error: String(e).slice(0, 120) };
  }
}

// MATCH THE RENDERED PAGE, NOT THE SCRIPT PAYLOAD. NYC Open Data ships a
// 533,691-byte bundle carrying every UI string it might ever need, including
// {"not_found_404": {"message": "Sorry, the page you requested could not be
// found."}} - a phrase that is present on a working page and absent from the
// markup. Matching the raw body condemned all 114 working links in one pass.
// Stripping scripts and styles leaves 10,335 bytes of actual document, and the
// patterns above then mean what they say.
const rendered = (body: string): string =>
  body.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');

const softDead = (f: Fetched): boolean => {
  const r = rendered(f.body);
  return SOFT_404.some((re) => re.test(r));
};

// ---------------------------------------------------------------------------
// IDENTIFIER CHECKS, FOR HOSTS THAT CANNOT ANSWER A FETCH.
// ---------------------------------------------------------------------------
//
// ZAP and the Open Data explore view both render after load, so every URL on
// them looks identical whether the record exists or not. Reporting them as
// "resolving" would be the same empty claim this file was rewritten to stop
// making, and reporting them as unknown would leave the largest source in the
// corpus unchecked.
//
// So the identifier is checked against the PUBLISHING DATASET instead. That is
// the question the fetch was standing in for: does the record this URL claims
// to show actually exist where it comes from. The dataset endpoint answers a
// real id with a row and an invented one with [], and each check below is
// calibrated against a deliberately invalid id exactly as the fetch path is.

interface IdentifierCheck {
  what: string;
  /** Pull the record identifier back out of the stored URL. */
  idFrom: (url: string) => string | null;
  /** The dataset query that proves that identifier exists. */
  probe: (id: string) => string;
  /** An identifier nothing can own, to prove the probe can say no. */
  control: string;
}

const IDENTIFIER_CHECKS: Record<string, IdentifierCheck> = {
  'nyc-ceqr': {
    what: 'CEQR number in the CEQR Projects dataset (gezn-7mgk)',
    idFrom: (url) => {
      const m = /ceqr%3D'([^']+)'/i.exec(url) ?? /ceqr='([^']+)'/i.exec(url);
      return m ? decodeURIComponent(m[1]) : null;
    },
    probe: (id) => `https://data.cityofnewyork.us/resource/gezn-7mgk.json?ceqr=${encodeURIComponent(id)}`,
    control: '99ZZZ999Z',
  },
  'nyc-zap': {
    what: 'project id in the ULURP/ZAP dataset (hgx4-8ukb)',
    idFrom: (url) => {
      const m = /\/projects\/([A-Za-z0-9]+)\/?$/.exec(url);
      return m ? m[1] : null;
    },
    probe: (id) => `https://data.cityofnewyork.us/resource/hgx4-8ukb.json?project_id=${encodeURIComponent(id)}`,
    control: '9999Z9999',
  },
};

/** true = the dataset holds this identifier, false = it does not, null = the probe failed. */
async function identifierExists(check: IdentifierCheck, id: string): Promise<boolean | null> {
  const f = await get(check.probe(id));
  if (f.status !== 200) return null;
  try {
    const rows = JSON.parse(f.body);
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return null;
  }
}

/** A URL on this host that is guaranteed not to exist. */
function controlUrlFor(sample: string): string | null {
  try {
    const u = new URL(sample);
    // Replace the last path segment with an identifier nothing can own.
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length === 0) return null;
    parts[parts.length - 1] = 'zzz-philipkwong-does-not-exist-000';
    u.pathname = `/${parts.join('/')}`;
    return u.toString();
  } catch {
    return null;
  }
}

export type HostVerdict = 'fetch' | 'identifier' | 'unverifiable';

export interface UrlAudit {
  source: string;
  host: string;
  verdict: HostVerdict;
  method: string;
  total: number;
  ok: number;
  dead: { url: string; title: string; why: string }[];
  control: string;
}

interface Row {
  id: string;
  title: string | null;
  url: string;
  source: string | null;
}

export async function auditUrls(sources: string[]): Promise<UrlAudit[]> {
  let q = supabaseAdmin.from('leads').select('id,title,url,source').not('url', 'is', null);
  if (sources.length) q = q.in('source', sources);
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q.range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...(data as unknown as Row[]));
    if (data.length < 1000) break;
  }

  const bySource = new Map<string, Row[]>();
  for (const r of rows) {
    const s = r.source ?? '(null)';
    bySource.set(s, [...(bySource.get(s) ?? []), r]);
  }

  const audits: UrlAudit[] = [];
  for (const [source, list] of bySource) {
    const host = (() => {
      try {
        return new URL(list[0].url).hostname;
      } catch {
        return '(unparseable)';
      }
    })();

    // CALIBRATE FIRST. What does this host do with an id that cannot exist?
    const controlUrl = controlUrlFor(list[0].url);
    const control = controlUrl ? await get(controlUrl) : null;
    const controlDead = control ? control.status >= 400 || softDead(control) : false;
    const controlBytes = control?.bytes ?? -1;
    const controlDesc = control
      ? `${control.status} / ${control.bytes}b / ${controlDead ? 'recognised as dead' : 'looks alive'}`
      : 'no control could be built';

    const audit: UrlAudit = {
      source,
      host,
      verdict: controlDead ? 'fetch' : 'unverifiable',
      method: controlDead ? 'fetched the page and read the body' : 'none: the host answers every id identically',
      total: list.length,
      ok: 0,
      dead: [],
      control: controlDesc,
    };

    // The host answers an impossible id exactly as it answers a real one, so
    // fetching every URL on it would produce a number that means nothing. Ask
    // the publishing dataset instead, if this source has a way in.
    if (!controlDead) {
      const check = IDENTIFIER_CHECKS[source];
      if (!check) {
        audits.push(audit);
        continue;
      }

      // Calibrate the probe before trusting it, same as the fetch path.
      const controlSays = await identifierExists(check, check.control);
      if (controlSays !== false) {
        audit.control = `${controlDesc}; identifier probe FAILED calibration (control returned ${controlSays})`;
        audits.push(audit);
        continue;
      }

      audit.verdict = 'identifier';
      audit.method = `page renders after load, so the ${check.what} was checked instead`;
      audit.control = `${controlDesc}; probe control ${check.control} correctly reports absent`;

      let j = 0;
      await Promise.all(
        Array.from({ length: CONCURRENCY }, async () => {
          while (j < list.length) {
            const r = list[j++];
            const id = check.idFrom(r.url);
            if (!id) {
              audit.dead.push({ url: r.url, title: r.title ?? '', why: 'no identifier could be read from the URL' });
              continue;
            }
            const exists = await identifierExists(check, id);
            if (exists === true) audit.ok++;
            else if (exists === false)
              audit.dead.push({ url: r.url, title: r.title ?? '', why: `${id} is not in the publishing dataset` });
            else audit.dead.push({ url: r.url, title: r.title ?? '', why: `probe for ${id} did not answer` });
          }
        })
      );
      audits.push(audit);
      continue;
    }

    let i = 0;
    const results = new Map<string, Fetched>();
    async function worker(): Promise<void> {
      while (i < list.length) {
        const r = list[i++];
        results.set(r.id, await get(r.url));
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    // SERIAL RETRY, for transport failures only. Fetching hundreds of URLs
    // concurrently makes hosts rate limit, and an earlier run reported eleven
    // "broken" links that all returned 200 one at a time. A 404 is NEVER
    // retried: retrying until a different answer appears is how a real failure
    // gets masked, which is a fair question to ask of any retry loop.
    const transient = [...results.entries()].filter(([, f]) => f.status === 0 || f.status === 429);
    if (transient.length) {
      console.log(`  ${source}: re-checking ${transient.length} unreachable URL(s) serially`);
      for (const [id] of transient) {
        const r = list.find((x) => x.id === id)!;
        results.set(id, await get(r.url, 45000));
      }
    }

    for (const r of list) {
      const f = results.get(r.id)!;
      let why = '';
      if (f.status === 0) why = `unreachable (${f.error})`;
      else if (f.status >= 400) why = `HTTP ${f.status}`;
      else if (softDead(f)) why = `HTTP ${f.status} but the body is a not-found page`;
      // Identical size to the control is the other soft-404 tell, for hosts
      // whose not-found page carries no recognisable wording.
      else if (controlBytes > 0 && f.bytes === controlBytes) why = `byte-identical to the not-found control (${f.bytes}b)`;
      if (why) audit.dead.push({ url: r.url, title: r.title ?? '', why });
      else audit.ok++;
    }
    audits.push(audit);
  }
  return audits.sort((a, b) => b.total - a.total);
}

async function main(): Promise<void> {
  const sources = process.argv.slice(2);
  console.log(sources.length ? `Auditing: ${sources.join(', ')}` : 'Auditing every stored URL');
  const audits = await auditUrls(sources);
  let deadTotal = 0;
  let unchecked = 0;
  for (const a of audits) {
    console.log(`\n${a.source}  (${a.host})`);
    console.log(`  method:  ${a.method}`);
    console.log(`  control: ${a.control}`);
    if (a.verdict === 'unverifiable') {
      unchecked += a.total;
      console.log(`  NOT CHECKED: this host answers an impossible id the same way it answers a`);
      console.log(`  real one, and no identifier check is registered for this source, so its`);
      console.log(`  ${a.total} URLs are unverified. Do not read this as passing.`);
      continue;
    }
    deadTotal += a.dead.length;
    console.log(`  ${a.total} URLs -> ${a.ok} verified, ${a.dead.length} DEAD`);
    for (const d of a.dead.slice(0, 8)) {
      console.log(`     ${d.why}  ${d.title.slice(0, 40)}`);
      console.log(`        ${d.url}`);
    }
    if (a.dead.length > 8) console.log(`     ... and ${a.dead.length - 8} more`);
  }
  console.log(`\n${deadTotal} dead stored URL(s); ${unchecked} URL(s) left unverified.`);
  if (deadTotal > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
