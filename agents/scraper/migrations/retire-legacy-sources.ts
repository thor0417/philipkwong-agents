// MARK EVERY RECORD FROM A RETIRED SOURCE. NOTHING IS DELETED.
//
//   DRY_RUN=1 node --env-file=.env.local --import tsx \
//     agents/scraper/migrations/retire-legacy-sources.ts
//   node --env-file=.env.local --import tsx \
//     agents/scraper/migrations/retire-legacy-sources.ts
//
// The sources are tombstoned in the registry (see opportunity/RETIRED_SOURCES);
// this marks what they already captured, so a row read a year from now says why
// it is inert.
//
// WHAT IT WRITES, AND WHAT IT REFUSES TO WRITE:
//
//   lifecycle     -> 'retired'   the scraper's own axis. A retired record is not
//                                dead, expired or dismissed: it is a record from
//                                a feed we stopped reading.
//   score_reason  -> RETIRED_REASON, which says "source retired ... not a US
//                                hospitality source ... kept, not deleted", so
//                                the row states a BUSINESS DECISION rather than
//                                reading as a capture failure.
//
//   status        NEVER. That column is Philip's and no scrape path writes it.
//                 A record he dismissed stays dismissed; one he has not judged
//                 stays unjudged. Retiring a source is not a judgement on a row.
//   project_id    NEVER cleared here. Detaching is the clusterer's job and it
//                 will do it on the next run, with a record_detached event, so
//                 the timeline says when and why. Clearing it here would delete
//                 that history silently.
//
// IDEMPOTENT. A row already at lifecycle 'retired' with the same reason is not
// rewritten, so a second run reports zero.

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { RETIRED_SOURCES, RETIRED_REASON } from '../opportunity';

interface Row {
  id: string;
  source: string | null;
  status: string | null;
  lifecycle: string | null;
  score_reason: string | null;
  project_id: string | null;
}

async function loadAll(): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id,source,status,lifecycle,score_reason,project_id')
      .in('source', RETIRED_SOURCES)
      .range(from, from + 999);
    if (error) throw new Error(`loadAll: ${error.message}`);
    if (!data?.length) break;
    out.push(...(data as unknown as Row[]));
    if (data.length < 1000) break;
  }
  return out;
}

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === '1';
  const rows = await loadAll();

  const bySource = new Map<string, { total: number; live: number; attached: number; toWrite: number }>();
  const toWrite: string[] = [];
  for (const r of rows) {
    const k = r.source ?? '(none)';
    const e = bySource.get(k) ?? { total: 0, live: 0, attached: 0, toWrite: 0 };
    e.total++;
    if (r.status !== 'dismissed') e.live++;
    if (r.project_id) e.attached++;
    const already = r.lifecycle === 'retired' && r.score_reason === RETIRED_REASON;
    if (!already) {
      e.toWrite++;
      toWrite.push(r.id);
    }
    bySource.set(k, e);
  }

  console.log('='.repeat(84));
  console.log(`RETIRING ${RETIRED_SOURCES.length} SOURCES${dryRun ? '  (DRY RUN, nothing written)' : ''}`);
  console.log('='.repeat(84));
  console.log('  source           records   live   attached   to mark');
  for (const [s, e] of [...bySource.entries()].sort((a, b) => b[1].total - a[1].total)) {
    console.log(
      `  ${s.padEnd(16)} ${String(e.total).padStart(7)} ${String(e.live).padStart(6)} ` +
        `${String(e.attached).padStart(10)} ${String(e.toWrite).padStart(9)}`
    );
  }
  const sourcesWithNothing = RETIRED_SOURCES.filter((s) => !bySource.has(s));
  if (sourcesWithNothing.length) {
    // A NAMED ZERO. A source in the list that captured nothing is not an error,
    // and saying so beats leaving a reader to wonder whether the query missed it.
    console.log(`\n  retired with no captured record: ${sourcesWithNothing.join(', ')}`);
  }
  console.log(`\n  total records from retired sources : ${rows.length}`);
  console.log(`  of those, live (not dismissed)     : ${rows.filter((r) => r.status !== 'dismissed').length}`);
  console.log(`  of those, attached to a project    : ${rows.filter((r) => r.project_id).length}`);
  console.log(`  rows to mark this run              : ${toWrite.length}`);

  if (dryRun) {
    console.log('\nDRY RUN. Nothing written. Re-run without DRY_RUN=1 to apply.');
    return;
  }
  if (toWrite.length === 0) {
    console.log('\nNothing to do: every record is already marked.');
    return;
  }

  let failed = 0;
  const CHUNK = 100;
  for (let i = 0; i < toWrite.length; i += CHUNK) {
    const slice = toWrite.slice(i, i + CHUNK);
    const { error } = await supabaseAdmin
      .from('leads')
      .update({ lifecycle: 'retired', score_reason: RETIRED_REASON })
      .in('id', slice);
    if (error) {
      console.error(`  update failed for ${slice.length} rows: ${error.message}`);
      failed += slice.length;
    }
  }
  console.log(`\nmarked ${toWrite.length - failed} rows, ${failed} failed.`);
  console.log('status untouched. project_id untouched: the clusterer detaches on its next run,');
  console.log('with a record_detached event, so the timeline keeps the reason and the date.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
