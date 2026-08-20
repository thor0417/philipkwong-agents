// FILL projects.stage_press_reported FOR EVERY PROJECT ALREADY IN THE TABLE.
//
//   npm run stage:backfill          dry run
//   APPLY=1 npm run stage:backfill  write
//
// ---------------------------------------------------------------------------
// WHY A BACKFILL AND NOT JUST THE NEXT RUN.
// ---------------------------------------------------------------------------
//
// The clusterer now carries provenStage's pressReported onto the project it
// writes, so a project that gains a record gets the value in the same pass -
// the same recompute story significance has. But a project nothing has happened
// to is not rewritten, and this column has NEVER been written for any of them:
// migration 040 created it, the rule that computes the value shipped separately,
// and nothing carried one to the other. So the whole corpus is null and the next
// scrape would only fix the projects that happen to move.
//
// A FULL SCRAPE WOULD ALSO DO IT and is the wrong tool: it reaches the network,
// takes an hour, and changes what is in the corpus. This reads what is already
// stored and writes one column.
//
// ---------------------------------------------------------------------------
// IT CALLS THE SAME provenStage THE CLUSTERER CALLS.
// ---------------------------------------------------------------------------
//
// Not a copy of the rule and not a simplification of it. The evidence shape is
// built exactly as cluster.ts builds it - recordStage over recordText, isFiling
// off the stream - so a project backfilled here and the same project rewritten
// by the next clustering run cannot disagree. `attributed` is the one input this
// cannot reproduce, because it is a property of HOW a record joined its project
// and that reason is per-membership rather than stored on the row.
//
// THAT MATTERS IN ONE DIRECTION ONLY, and the direction is safe. `attributed`
// can only ever ADMIT a stage into `decided`, so treating every record as
// unattributed can only make `decided` lower, which can only make pressReported
// MORE likely to be set. The backfill can therefore say "the press runs ahead"
// where the clusterer would not, and never the reverse. Any project where the
// two differ is corrected the next time it is clustered, and the dry run prints
// the whole list so the difference is visible before it is written.
//
// NOTHING ELSE IS TOUCHED. One column, and never `stage`.

import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { provenStage, recordStage, type StageEvidence } from '../../../lib/taxonomy';
import { recordText, type ClusterRecord } from '../cluster';

const APPLY = process.env.APPLY === '1';

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

interface ProjectRow {
  id: string;
  name: string;
  market: string | null;
  stage: string | null;
  stage_press_reported: string | null;
  status: string | null;
}

interface LeadRow {
  id: string;
  project_id: string | null;
  status: string | null;
  stream: string | null;
  source: string | null;
  source_type: string | null;
  title: string | null;
  raw_content: string | null;
  url: string | null;
}

async function main(): Promise<void> {
  const projects = await pageAll<ProjectRow>(
    'projects',
    'id,name,market,stage,stage_press_reported,status'
  );
  const leads = await pageAll<LeadRow>(
    'leads',
    'id,project_id,status,stream,source,source_type,title,raw_content,url'
  );

  const byProject = new Map<string, LeadRow[]>();
  for (const l of leads) {
    if (l.status === 'dismissed' || !l.project_id) continue;
    if (!byProject.has(l.project_id)) byProject.set(l.project_id, []);
    byProject.get(l.project_id)!.push(l);
  }

  const changes: { p: ProjectRow; from: string | null; to: string | null }[] = [];
  let unchanged = 0;

  for (const p of projects) {
    const recs = byProject.get(p.id) ?? [];
    if (recs.length === 0) {
      if (p.stage_press_reported !== null) changes.push({ p, from: p.stage_press_reported, to: null });
      else unchanged++;
      continue;
    }
    const evidence: StageEvidence[] = recs.map((r) => ({
      // recordText reads title and raw_content and nothing else, which is
      // exactly what the clusterer hands it.
      stage: recordStage(
        recordText({ title: r.title, raw_content: r.raw_content } as unknown as ClusterRecord),
        r.source_type
      ),
      // See the note above: unreproducible here, and safe in the one direction
      // it can be wrong.
      attributed: false,
      isFiling: r.stream === 'government',
    }));
    const proven = provenStage(evidence);
    const next = proven.pressReported;
    if ((next ?? null) === (p.stage_press_reported ?? null)) unchanged++;
    else changes.push({ p, from: p.stage_press_reported, to: next ?? null });
  }

  console.log('='.repeat(96));
  console.log(`STAGE, AS THE PRESS REPORTS IT   over ${projects.length} projects`);
  console.log('='.repeat(96));
  console.log(`  already correct: ${unchanged}`);
  console.log(`  to write:        ${changes.length}`);
  console.log('');
  const setting = changes.filter((c) => c.to !== null);
  const clearing = changes.filter((c) => c.to === null);
  console.log(`  gaining a press-reported stage: ${setting.length}`);
  for (const c of setting) {
    console.log(
      `    ${String(c.p.name).slice(0, 44).padEnd(44)} ${String(c.p.market ?? '-').slice(0, 18).padEnd(18)} ` +
        `filings support ${String(c.p.stage ?? '-').padEnd(18)} press reports ${c.to}`
    );
  }
  console.log(`  clearing a stale value: ${clearing.length}`);
  for (const c of clearing) {
    console.log(`    ${String(c.p.name).slice(0, 44).padEnd(44)} was ${c.from}`);
  }

  if (!APPLY) {
    console.log('');
    console.log('DRY RUN. Nothing written. Re-run with APPLY=1 to write.');
    return;
  }

  let written = 0;
  for (const c of changes) {
    const { error } = await supabaseAdmin
      .from('projects')
      .update({ stage_press_reported: c.to })
      .eq('id', c.p.id);
    if (error) {
      console.error(`  write failed for ${c.p.name}: ${error.message}`);
      continue;
    }
    written++;
  }
  console.log('');
  console.log(`WROTE ${written} of ${changes.length}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
