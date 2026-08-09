// STORED LINKS, FETCHED. Every URL in the corpus is a promise to a client that
// a document exists and can be opened; this is the only thing that checks it.
//
//   node --env-file=.env.local --import tsx agents/scraper/verify-urls.ts
//   node --env-file=.env.local --import tsx agents/scraper/verify-urls.ts nyc-ceqr nyc-zap
//
// WHY THIS EXISTS AS A SCRIPT RATHER THAN A SPOT CHECK. A previous run reported
// "five fetch-verified URLs per source" and that is close to meaningless: five
// of 114 is a four percent sample, and it was not even a random four percent -
// they were the first rows of the sample output, which are the rows most likely
// to be well formed. A stored link that errors is invisible until a client
// clicks it, so the check has to be exhaustive or it is theatre.
//
// SERIAL RETRY IS NOT OPTIONAL, and this is the part a naive version gets
// wrong. Fetching 313 URLs at concurrency 8 produced SEVEN apparent failures,
// every one of which returned 200 when retried one at a time: the host was rate
// limiting, and a report of "7 broken links" would have been entirely false.
// Anything that does not resolve concurrently is therefore re-checked serially
// before it is called broken.

import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../lib/supabase-admin';

const UA = 'Mozilla/5.0 (compatible; philipkwong-agents/1.0 +scraper)';
const CONCURRENCY = 6;

async function status(url: string, timeoutMs = 30000): Promise<number> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.status;
  } catch {
    // 0 means the fetch never completed: timeout, reset, DNS. It is NOT a 404,
    // and conflating the two is what produces false broken-link reports.
    return 0;
  }
}

interface Row {
  id: string;
  title: string | null;
  url: string;
  source: string | null;
  market: string | null;
}

export interface UrlAudit {
  source: string;
  total: number;
  ok: number;
  broken: { url: string; title: string; code: number }[];
  codes: Record<number, number>;
}

export async function auditUrls(sources: string[]): Promise<UrlAudit[]> {
  let q = supabaseAdmin.from('leads').select('id,title,url,source,market').not('url', 'is', null);
  if (sources.length) q = q.in('source', sources);
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q.range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...(data as unknown as Row[]));
    if (data.length < 1000) break;
  }

  const results = new Map<string, { code: number; row: Row }>();
  let next = 0;
  async function worker(): Promise<void> {
    while (next < rows.length) {
      const r = rows[next++];
      results.set(r.id, { code: await status(r.url), row: r });
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // THE SERIAL SECOND PASS. See the note at the top.
  const suspects = [...results.values()].filter((x) => x.code === 0 || x.code === 429);
  if (suspects.length) {
    console.log(`  re-checking ${suspects.length} unresolved URL(s) serially before calling them broken`);
    for (const s of suspects) {
      results.set(s.row.id, { code: await status(s.row.url, 45000), row: s.row });
    }
  }

  const bySource = new Map<string, UrlAudit>();
  for (const { code, row } of results.values()) {
    const src = row.source ?? '(null)';
    const a = bySource.get(src) ?? { source: src, total: 0, ok: 0, broken: [], codes: {} };
    a.total++;
    a.codes[code] = (a.codes[code] ?? 0) + 1;
    if (code >= 200 && code < 400) a.ok++;
    else a.broken.push({ url: row.url, title: row.title ?? '', code });
    bySource.set(src, a);
  }
  return [...bySource.values()].sort((x, y) => y.total - x.total);
}

async function main(): Promise<void> {
  const sources = process.argv.slice(2);
  console.log(sources.length ? `Auditing: ${sources.join(', ')}` : 'Auditing every stored URL');
  const audits = await auditUrls(sources);
  let brokenTotal = 0;
  for (const a of audits) {
    brokenTotal += a.broken.length;
    const pct = a.total ? ((100 * a.ok) / a.total).toFixed(1) : '0';
    console.log(`\n${a.source}: ${a.total} URLs -> ${a.ok} resolve (${pct}%), ${a.broken.length} broken`);
    console.log(
      '  codes: ' +
        Object.entries(a.codes)
          .sort((x, y) => y[1] - x[1])
          .map(([c, n]) => `${c === '0' ? 'unreachable' : c}:${n}`)
          .join('  ')
    );
    for (const b of a.broken.slice(0, 10)) {
      console.log(`     ${b.code}  ${b.title.slice(0, 46)}  ${b.url}`);
    }
  }
  console.log(`\n${brokenTotal} broken stored URL(s) across ${audits.length} source(s).`);
  if (brokenTotal > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
