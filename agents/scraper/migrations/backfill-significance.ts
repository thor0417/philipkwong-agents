// SCORE EVERY PROJECT AND STORE IT.
//
//   npm run sig:backfill          dry run
//   APPLY=1 npm run sig:backfill  write
//
// ---------------------------------------------------------------------------
// THE RECOMPUTE STORY, WHICH THE COLUMN NAMES IMPLY AND NOTHING STATED.
// ---------------------------------------------------------------------------
//
// significance_computed_at exists because a score CAN go stale. Three things
// make it stale, and they are not equivalent:
//
//   1. A FILING ARRIVES. The project gains a record, so depth, span, recency,
//      source and possibly money and stage all move. Handled automatically:
//      the clusterer recomputes significance for every project it writes, on
//      every run, from the members it just assembled. A project that gains a
//      record is rewritten in the same pass. No separate trigger, no queue.
//
//   2. A WEIGHT CHANGES. This invalidates THE WHOLE CORPUS, not part of it.
//      Nine signals summing to 100 means changing one changes every score and
//      every rank, including for projects nothing has happened to. There is no
//      incremental path and pretending otherwise would leave two scoring
//      regimes in one column. A weight change REQUIRES a full pass: run this
//      migration with APPLY=1.
//
//   3. A PROJECT IS EDITED BY HAND. Stage, venue and applicant are all inputs.
//      The dashboard recomputes on those mutations.
//
// STALENESS IN THE UI. A score older than its project's last_activity is shown
// with its age, not hidden and not silently recomputed on read. Recomputing on
// read would make the register's cost scale with how often it is looked at,
// which is the same reason summary is a stored column; hiding it would present
// a stale ranking as a current one.
//
// A PINNED SCORE IS NEVER RECOMPUTED, by any of the three paths. See
// PROJECT_OVERRIDABLE in project-write.

import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { score, explain, MAX_SCORE, type SignificanceRecord } from '../significance';
import { overriddenFields } from '../write-guard';

const APPLY = process.env.APPLY === '1';

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
  manual_overrides: Record<string, unknown> | null;
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

async function main(): Promise<void> {
  console.log(APPLY ? 'SIGNIFICANCE BACKFILL: APPLYING' : 'SIGNIFICANCE BACKFILL: DRY RUN (APPLY=1 to write)');

  const projects = await page<ProjectRow>(
    'projects',
    'id,name,market,stage,venue_type,record_count,primary_applicant,primary_representative,last_activity,manual_overrides'
  );
  const leads = await page<SignificanceRecord & { project_id: string }>(
    'leads',
    'project_id,title,raw_content,source,source_type,stream,published_date',
    (q) => q.not('project_id', 'is', null).neq('status', 'dismissed')
  );
  const by = new Map<string, SignificanceRecord[]>();
  for (const l of leads) by.set(l.project_id, [...(by.get(l.project_id) ?? []), l]);

  const now = new Date().toISOString();
  let written = 0;
  let pinned = 0;
  const buckets = { over70: 0, mid: 0, low: 0, under30: 0 };

  for (const p of projects) {
    // A PINNED SCORE IS PHILIP'S JUDGEMENT AND OUTRANKS THE MODEL PERMANENTLY.
    if (overriddenFields(p.manual_overrides).has('significance')) {
      pinned++;
      continue;
    }
    const r = score({ ...p, records: by.get(p.id) ?? [] });
    if (r.score > 70) buckets.over70++;
    else if (r.score >= 50) buckets.mid++;
    else if (r.score >= 30) buckets.low++;
    else buckets.under30++;
    if (APPLY) {
      const { error } = await supabaseAdmin
        .from('projects')
        .update({ significance: r.score, significance_detail: r.detail, significance_computed_at: now })
        .eq('id', p.id);
      if (error) throw new Error(`significance write failed for ${p.name}: ${error.message}`);
    }
    written++;
  }

  console.log(`\nprojects: ${projects.length}   scored: ${written}   pinned, left alone: ${pinned}`);
  console.log(`scale: 0 to ${MAX_SCORE}`);
  console.log(
    `DISTRIBUTION: >70 = ${buckets.over70}   50-70 = ${buckets.mid}   30-50 = ${buckets.low}   <30 = ${buckets.under30}`
  );

  const top = projects
    .map((p) => ({ p, ...score({ ...p, records: by.get(p.id) ?? [] }) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
  console.log('\n=== TOP 20 ON DEFAULT SORT ===');
  top.forEach((r, i) => {
    console.log(`${String(i + 1).padStart(3)}. ${String(r.score).padStart(5)}  [${String(r.p.market ?? '').slice(0, 13).padEnd(13)}] ${String(r.p.name).slice(0, 46)}`);
    console.log(`             ${explain(r.detail)}`);
  });

  if (!APPLY) console.log('\nNothing was written. APPLY=1 to write.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
