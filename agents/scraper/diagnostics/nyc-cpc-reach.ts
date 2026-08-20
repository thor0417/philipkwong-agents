// READ-ONLY. HOW MANY NEW YORK PROJECTS COULD REACH A CPC REPORT, AND FROM A
// PUBLISHED FIELD RATHER THAN FROM PROSE?
//
//   node --env-file=.env.local --import tsx \
//     agents/scraper/diagnostics/nyc-cpc-reach.ts [--probe] [--read=<ulurp>]
//
// Nothing is written and no reader is built. New York is the largest market in
// the corpus and every New York project carries ZERO conditions, while Clark
// County gives 51 on one project - because Legistar attaches staff reports and
// we read them. This measures whether the New York equivalent is reachable.
//
// ---------------------------------------------------------------------------
// A PUBLISHED FIELD IS NOT A REGEX OVER PROSE, AND THE DIFFERENCE IS THE POINT.
// ---------------------------------------------------------------------------
//
// sources/nyc-zap writes `ULURP numbers: …` from r.ulurp_numbers, which is a
// COLUMN on the ZAP dataset row - the source stating its own identifier. A
// number scraped out of a sentence somewhere else is a different quality of
// fact: it can be a cross-reference to another project, a number quoted in
// passing, or a misread. An earlier pass found 33 by regex where the source
// publishes 28, and that gap is the whole reason to separate them here.
//
// So this counts them apart and never merges them.
//
// --probe fetches the CPC report route for each DISTINCT published number, one
// request at a walking pace. --read=<ulurp> pulls one report and prints what it
// contains, because "what a CPC report carries" cannot be answered from a
// status code.

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { LIVE_PIPELINE_STORAGE_KEY } from '../pipelines';
import { inCorpusScope } from '../../../lib/corpus-scope';

const PROBE = process.argv.includes('--probe');
const READ = (process.argv.find((a) => a.startsWith('--read=')) ?? '').split('=')[1] ?? '';
const UA = 'philipkwong-agents/1.0 (+development intelligence)';
const CPC = (n: string) => `https://www.nyc.gov/assets/planning/download/pdf/about/cpc/${n}.pdf`;

interface Lead {
  id: string;
  source: string | null;
  status: string | null;
  project_id: string | null;
  raw_content: string | null;
  title: string | null;
}

async function pageAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabaseAdmin.from(table).select(columns).range(from, from + 499);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...(data as T[]));
    if (data.length < 500) break;
  }
  return out;
}

// A ULURP application number: six digits and a two-or-three letter action/borough
// suffix. The CPC report is filed under the BARE SIX DIGITS.
const ULURP_RE = /\b(\d{6})([A-Z]{2,4})\b/g;

/** Numbers the SOURCE published, read off the line nyc-zap writes from its column. */
function publishedUlurps(raw: string | null | undefined): string[] {
  const m = /^ULURP numbers:\s*(.+)$/m.exec(String(raw ?? ''));
  if (!m) return [];
  const out: string[] = [];
  ULURP_RE.lastIndex = 0;
  let hit: RegExpExecArray | null;
  while ((hit = ULURP_RE.exec(m[1]))) out.push(hit[1] + hit[2]);
  return out;
}

/** Numbers found anywhere in the text, which is what a prose regex would take. */
function proseUlurps(raw: string | null | undefined): string[] {
  const text = String(raw ?? '');
  const out: string[] = [];
  ULURP_RE.lastIndex = 0;
  let hit: RegExpExecArray | null;
  while ((hit = ULURP_RE.exec(text))) out.push(hit[1] + hit[2]);
  return out;
}

async function fetchIt(url: string): Promise<{ what: string; buf: Buffer | null }> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return { what: `HTTP ${res.status}`, buf: null };
    const buf = Buffer.from(await res.arrayBuffer());
    // A SOFT FAILURE IS THE HOUSE STYLE ON NYC HOSTS - see the golden case
    // a-200-is-not-a-live-page. The first bytes decide, never the status.
    if (buf.subarray(0, 5).toString('latin1') === '%PDF-') {
      return { what: `PDF ${(buf.length / 1e6).toFixed(2)}MB`, buf };
    }
    const head = buf.subarray(0, 4000).toString('utf8');
    if (/Page Not Found|Error Code 404|404/i.test(head)) return { what: 'soft 404 (HTTP 200)', buf: null };
    return { what: `not a pdf, ${buf.length}b`, buf: null };
  } catch (e) {
    return { what: e instanceof Error && /timed?\s*out|abort/i.test(e.name + e.message) ? 'timed out' : String(e).slice(0, 50), buf: null };
  }
}

async function main(): Promise<void> {
  if (READ) {
    const { what, buf } = await fetchIt(CPC(READ));
    console.log(`${CPC(READ)}  ->  ${what}`);
    if (!buf) return;
    const pdf = (await import('pdf-parse/lib/pdf-parse.js')).default;
    const data = await pdf(buf);
    const text = String(data.text ?? '');
    console.log(`  pages ${data.numpages}, ${text.length} chars`);
    console.log('');
    console.log('  ---- WHAT IT CARRIES ------------------------------------------');
    const cond = text.match(/\b(shall|must|subject to the following|condition)\b/gi) ?? [];
    const resolved = text.match(/RESOLVED/g) ?? [];
    const votes = /\b(In Favor|Against|Abstain|Absent)\b/i.test(text);
    console.log(`    'shall'/'must'/'condition' occurrences : ${cond.length}`);
    console.log(`    'RESOLVED' occurrences                 : ${resolved.length}`);
    console.log(`    a recorded vote (In Favor/Against)     : ${votes ? 'yes' : 'no'}`);
    console.log('');
    console.log('  ---- FIRST 1800 CHARACTERS ------------------------------------');
    console.log(text.replace(/\n{3,}/g, '\n\n').slice(0, 1800));
    return;
  }

  const projects = await pageAll<{ id: string; name: string; market: string | null; module: string | null; status: string | null; country: string | null; stage: string | null }>(
    'projects',
    'id,name,market,module,status,country,stage'
  );
  const live = new Map(
    projects
      .filter((p) => p.module === LIVE_PIPELINE_STORAGE_KEY && p.status !== 'dismissed' && inCorpusScope(p.country))
      .map((p) => [p.id, p])
  );
  const ny = [...live.values()].filter((p) => /new york/i.test(String(p.market ?? '')));
  const nyIds = new Set(ny.map((p) => p.id));

  const leads = await pageAll<Lead>('leads', 'id,source,status,project_id,raw_content,title');
  const mine = leads.filter((l) => l.status !== 'dismissed' && l.project_id && nyIds.has(l.project_id));

  const publishedByProject = new Map<string, Set<string>>();
  const proseByProject = new Map<string, Set<string>>();
  for (const l of mine) {
    const pid = l.project_id!;
    for (const u of publishedUlurps(l.raw_content)) {
      if (!publishedByProject.has(pid)) publishedByProject.set(pid, new Set());
      publishedByProject.get(pid)!.add(u);
    }
    for (const u of proseUlurps(l.raw_content)) {
      if (!proseByProject.has(pid)) proseByProject.set(pid, new Set());
      proseByProject.get(pid)!.add(u);
    }
  }

  const allPublished = new Set([...publishedByProject.values()].flatMap((s) => [...s]));
  const allProse = new Set([...proseByProject.values()].flatMap((s) => [...s]));
  const proseOnly = [...allProse].filter((u) => !allPublished.has(u));

  console.log('='.repeat(100));
  console.log(`NEW YORK, AND THE ROUTE TO A CPC REPORT`);
  console.log('='.repeat(100));
  console.log(`  live New York projects:                            ${ny.length}`);
  console.log(`  records on them:                                   ${mine.length}`);
  console.log('');
  console.log(`  projects with a ULURP number FROM A PUBLISHED FIELD: ${publishedByProject.size}`);
  console.log(`  projects with a ULURP-shaped number anywhere:        ${proseByProject.size}`);
  console.log('');
  console.log(`  distinct numbers the source publishes:              ${allPublished.size}`);
  console.log(`  distinct numbers a prose regex would take:          ${allProse.size}`);
  console.log(`  of those, NOT published anywhere - prose only:      ${proseOnly.length}`);
  if (proseOnly.length) console.log(`      ${proseOnly.slice(0, 14).join(', ')}`);

  console.log('');
  console.log('-'.repeat(100));
  console.log('PROJECTS WITH A PUBLISHED NUMBER');
  console.log('-'.repeat(100));
  for (const [pid, set] of publishedByProject) {
    console.log(`  ${String(live.get(pid)!.name).slice(0, 50).padEnd(51)} ${[...set].join(', ').slice(0, 44)}`);
  }

  if (!PROBE) {
    console.log('');
    console.log('Pass --probe to fetch the CPC report route for each distinct published number.');
    return;
  }

  console.log('');
  console.log('-'.repeat(100));
  console.log(`CPC REPORT ROUTE, one request per distinct published number (${allPublished.size})`);
  console.log('-'.repeat(100));
  let pdfs = 0;
  for (const u of allPublished) {
    const bare = u.slice(0, 6);
    const { what } = await fetchIt(CPC(bare));
    if (what.startsWith('PDF')) pdfs++;
    console.log(`  ${u.padEnd(12)} -> ${bare}.pdf  ${what}`);
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log('');
  console.log(`  RETURNED A REAL PDF: ${pdfs} of ${allPublished.size}`);
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
