// READ-ONLY. WHAT ARRIVED IN A WINDOW, AND WHY THE REGISTER RANKS IT THAT WAY.
//
//   node --env-file=.env.local --import tsx \
//     agents/scraper/diagnostics/significance-window.ts [--since=YYYY-MM-DD] [--market=<name>]
//
// Nothing is written. The register sorts by significance and the composer does
// not, so "the items I care about are on page five" is a statement about this
// score and about nothing else. This prints the score of every project a record
// arrived on inside the window, with EVERY SIGNAL'S CONTRIBUTION, because a
// ranking nobody can interrogate is a ranking nobody can correct.
//
// THE SCORE IS READ, NOT RECOMPUTED. projects.significance is what the register
// sorts on; recomputing here would report what the model WOULD say rather than
// what the screen does, and the two differ whenever a backfill is outstanding.
// significance_computed_at is printed so a stale score is visible as stale.

import { supabaseAdmin } from '../../../lib/supabase-admin';

const arg = (k: string) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').split('=')[1] ?? '';
const SINCE = arg('since') || '2026-08-19';
const MARKET = arg('market');

interface Lead {
  id: string;
  title: string | null;
  project_id: string | null;
  status: string | null;
  first_seen: string | null;
  published_date: string | null;
  market: string | null;
  source: string | null;
  stream: string | null;
}
interface Proj {
  id: string;
  name: string;
  market: string | null;
  stage: string | null;
  status: string | null;
  significance: number | null;
  significance_computed_at: string | null;
  last_activity: string | null;
  significance_detail: Record<string, { points: number; of: number; why: string }> | null;
}

async function pageAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

async function main(): Promise<void> {
  const leads = await pageAll<Lead>(
    'leads',
    'id,title,project_id,status,first_seen,published_date,market,source,stream'
  );
  const projects = await pageAll<Proj>(
    'projects',
    'id,name,market,stage,status,significance,significance_computed_at,last_activity,significance_detail'
  );
  const byId = new Map(projects.map((p) => [p.id, p]));

  const cutoff = Date.parse(`${SINCE}T00:00:00Z`);
  const recent = leads.filter(
    (l) => l.status !== 'dismissed' && l.first_seen && Date.parse(l.first_seen) >= cutoff
  );

  console.log('='.repeat(104));
  console.log(`RECORDS FIRST SEEN SINCE ${SINCE}: ${recent.length}`);
  console.log('='.repeat(104));

  const marketOf = (l: Lead) => (l.project_id ? byId.get(l.project_id)?.market : null) ?? l.market ?? '(unplaced)';
  const byMarket = new Map<string, Lead[]>();
  for (const l of recent) {
    const m = marketOf(l);
    if (!byMarket.has(m)) byMarket.set(m, []);
    byMarket.get(m)!.push(l);
  }
  console.log('\nBY MARKET');
  for (const [m, ls] of [...byMarket.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const sources = [...new Set(ls.map((l) => l.source ?? '-'))].join(', ');
    console.log(`  ${String(ls.length).padStart(3)}  ${m.padEnd(34)} ${sources}`);
  }

  const touched = new Map<string, Proj>();
  for (const l of recent) {
    const p = l.project_id ? byId.get(l.project_id) : null;
    if (p && p.status !== 'dismissed') touched.set(p.id, p);
  }
  let rows = [...touched.values()];
  if (MARKET) rows = rows.filter((p) => (p.market ?? '').toLowerCase().includes(MARKET.toLowerCase()));
  rows.sort((a, b) => (b.significance ?? 0) - (a.significance ?? 0));

  console.log(
    `\nTHE PROJECTS THOSE RECORDS LANDED ON: ${rows.length}, IN THE ORDER THE REGISTER SHOWS THEM`
  );
  console.log('(the register sorts by significance descending, 25 rows to a page)');
  console.log('');
  console.log('  row  page    sig  market                stage             name');
  console.log('  ' + '-'.repeat(100));
  rows.forEach((p, i) => {
    console.log(
      `  ${String(i + 1).padStart(3)}  ${String(Math.floor(i / 25) + 1).padStart(4)}  ` +
        `${String(p.significance ?? '-').padStart(5)}  ${(p.market ?? '-').slice(0, 20).padEnd(20)}  ` +
        `${(p.stage ?? '-').padEnd(17)} ${p.name.slice(0, 46)}`
    );
  });

  console.log('\n' + '='.repeat(104));
  console.log('EVERY SIGNAL, EVERY PROJECT ABOVE');
  console.log('='.repeat(104));
  for (const p of rows) {
    const d = p.significance_detail ?? {};
    console.log(
      `\n  ${p.name.slice(0, 62)}   [${p.market ?? '-'}]   ${p.significance ?? '-'}` +
        `   scored ${p.significance_computed_at?.slice(0, 10) ?? 'never'}`
    );
    if (!Object.keys(d).length) {
      console.log('      no stored breakdown - this project has never been scored');
      continue;
    }
    for (const [k, v] of Object.entries(d).sort((a, b) => b[1].points - a[1].points)) {
      console.log(`      ${k.padEnd(15)} ${String(v.points).padStart(6)} of ${String(v.of).padStart(4)}   ${v.why}`);
    }
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
