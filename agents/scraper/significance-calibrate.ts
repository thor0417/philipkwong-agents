// CALIBRATE THE SIGNIFICANCE MODEL AGAINST KNOWN GROUND TRUTH.
//
//   npm run sig:calibrate
//
// Scores the whole corpus IN MEMORY and prints the top 30, the bottom 20, the
// distribution, and twelve named sanity checks. Writes nothing.
//
// WHAT SINKS MATTERS AS MUCH AS WHAT RISES. A ranking is judged at both ends: a
// model that floats the Willets Point casino to the top and leaves an outdoor
// cafe concession in the top fifty has not worked. So the bottom 20 are printed
// with their breakdowns too.
//
// THE SANITY CHECKS ARE NAMED PROJECTS, NOT THRESHOLDS. Eight projects that
// must reach the top 40 and four classes that must sit in the bottom quartile.
// If a known-important project ranks low, the fix is the model, read off its
// own signal breakdown - never a special case for that project, which would
// make the ranking unfalsifiable.

import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../lib/supabase-admin';
import { score, explain, type SignificanceRecord } from './significance';

interface ProjectRow {
  id: string;
  name: string;
  market: string | null;
  stage: string | null;
  venue_type: string | null;
  record_count: number | null;
  primary_applicant: string | null;
  primary_representative: string | null;
  last_activity: string | null;
}

async function page<T>(table: string, cols: string, f?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; ; i += 1000) {
    let q: any = supabaseAdmin.from(table).select(cols).range(i, i + 999);
    if (f) q = f(q);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

export async function scoreCorpus(): Promise<
  { p: ProjectRow; score: number; detail: ReturnType<typeof score>['detail'] }[]
> {
  const projects = await page<ProjectRow>(
    'projects',
    'id,name,market,stage,venue_type,record_count,primary_applicant,primary_representative,last_activity'
  );
  const leads = await page<SignificanceRecord & { project_id: string }>(
    'leads',
    'project_id,title,raw_content,source,source_type,stream,published_date',
    (q) => q.not('project_id', 'is', null).neq('status', 'dismissed')
  );
  const by = new Map<string, SignificanceRecord[]>();
  for (const l of leads) by.set(l.project_id, [...(by.get(l.project_id) ?? []), l]);
  return projects
    .map((p) => ({ p, ...score({ ...p, records: by.get(p.id) ?? [] }) }))
    .sort((a, b) => b.score - a.score);
}

// Eight projects that must reach the top 40. Each is a matter Philip has named
// or worked, so a model that buries one is wrong about something structural.
const MUST_RISE: [string, RegExp][] = [
  ['Metropolitan Park / Willets Point', /Metropolitan Park|Willets/i],
  ['The Coney', /The Coney/i],
  ["Bally's Bronx", /Bally/i],
  ['Hudson Yards / Western Rail Yard', /Hudson Yards|Western Rail/i],
  ['Heart Hotel / Kulik River', /Heart Hotel/i],
  ['OCVibe', /OCVibe/i],
  ['Disney / CFTOD', /CFTOD|Disney \//i],
  ['Madison Square Garden', /Madison Square/i],
];

// Four classes that must sit in the bottom quartile. These are the records that
// made the old ordering unreadable.
// TWO OF THESE NO LONGER EXIST, AND SAYING SO IS THE RESULT.
//
// The Reedy Creek Elementary records and the seniors-residence rezonings were
// dismissed in Brief H part 8, so neither has a project to rank. The first
// version of this check used /senior/i, which matched World Bank job postings
// ("Senior Credit Officer") and reported a model failure that was a test
// failure. A sanity check that matches the wrong rows is worse than none: it
// spends the model's credibility on noise.
const MUST_SINK: [string, RegExp][] = [
  ['Busters Marine cafe concession', /Busters Marine|10 Kent/i],
  ['Nashville TIF resolutions', /Redevelopment Plan$/i],
  ['Reedy Creek Elementary', /Reedy Creek Elementary School/i],
  ['seniors-residence rezonings', /(senior|elderly) (housing|residence)|affordable senior/i],
];

async function main(): Promise<void> {
  const scored = await scoreCorpus();
  const line = (r: (typeof scored)[number], rank: number): void => {
    console.log(
      `${String(rank).padStart(3)}. ${String(r.score).padStart(5)}  [${String(r.p.market ?? '').slice(0, 13).padEnd(13)}] ${String(r.p.name).slice(0, 46)}`
    );
    console.log(`             ${explain(r.detail)}`);
  };

  console.log(`scored ${scored.length} projects\n`);
  console.log('=== TOP 30 ===');
  scored.slice(0, 30).forEach((r, i) => line(r, i + 1));

  console.log('\n=== BOTTOM 20 ===');
  scored.slice(-20).forEach((r, i) => line(r, scored.length - 20 + i + 1));

  const b = { over70: 0, mid: 0, low: 0, under30: 0 };
  for (const r of scored) {
    if (r.score > 70) b.over70++;
    else if (r.score >= 50) b.mid++;
    else if (r.score >= 30) b.low++;
    else b.under30++;
  }
  console.log(
    `\nDISTRIBUTION: >70 = ${b.over70}   50-70 = ${b.mid}   30-50 = ${b.low}   <30 = ${b.under30}`
  );

  let pass = 0;
  let fail = 0;
  console.log('\n=== SANITY: must reach the TOP 40 ===');
  for (const [label, re] of MUST_RISE) {
    const i = scored.findIndex((r) => re.test(r.p.name));
    const ok = i >= 0 && i < 40;
    ok ? pass++ : fail++;
    console.log(
      `  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(34)} ${i < 0 ? 'NOT IN CORPUS' : `rank ${i + 1}, score ${scored[i].score}`}`
    );
    if (i >= 0 && !ok) console.log(`          ${explain(scored[i].detail)}`);
  }

  const cut = Math.ceil(scored.length * 0.75);
  console.log(`\n=== SANITY: must sit in the BOTTOM QUARTILE (rank >= ${cut}) ===`);
  for (const [label, re] of MUST_SINK) {
    const hits = scored.map((r, i) => ({ r, rank: i + 1 })).filter((x) => re.test(x.r.p.name));
    if (hits.length === 0) {
      console.log(`  n/a   ${label.padEnd(34)} not in the corpus`);
      continue;
    }
    const best = Math.min(...hits.map((h) => h.rank));
    const ok = best >= cut;
    ok ? pass++ : fail++;
    console.log(
      `  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(34)} ${hits.length} matched, highest rank ${best}, scores ${hits.map((h) => h.r.score).join(', ')}`
    );
    if (!ok) {
      const worst = hits.find((h) => h.rank === best)!;
      console.log(`          ${worst.r.p.name.slice(0, 60)}`);
      console.log(`          ${explain(worst.r.detail)}`);
    }
  }
  console.log(`\nsanity: ${pass} pass, ${fail} fail`);
  if (fail > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
