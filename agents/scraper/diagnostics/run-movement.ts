// READ-ONLY. WHAT MOVED IN THE FRESH RUN, AND DID THE BROWARD ROWS COME BACK?
//
//   node --env-file=.env.local --import tsx \
//     agents/scraper/diagnostics/run-movement.ts --since 2026-09-07T08:55:00Z
//
// Brief U item 4. Nothing is written. The cut is a TIMESTAMP taken from the
// labelled before-snapshot, so "new" means "arrived after that snapshot" rather
// than "looks recent", which is a different question and the one a first_seen
// filter would answer wrongly.
//
// ---------------------------------------------------------------------------
// AND THE QUESTION THE GATE NOTE ASKED
// ---------------------------------------------------------------------------
//
// GATE-NOTE-COMPREHENSIVE-PLAN.md logs the claim that removing 'comprehensive
// plan' from the gate vocabulary, with an LLM free-text path still admitting it,
// means the same 71 Broward rows return on the next capture. The cleanout
// tombstoned them rather than deleting them, precisely so the return could be
// COUNTED rather than argued about. Three things are checked, and the third is
// the one that decides it:
//
//   1. how many Broward records this run admitted, against 23 on 2026-09-02
//   2. how many carry 'comprehensive plan' in their title
//   3. whether any TOMBSTONED project came back to a live status, and by which
//      path - the same row resurrected, or a new row for the same matter

import { pathToFileURL } from 'node:url';
import { selectAllPaged } from '../page-select';

const arg = (n: string): string | null => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? (process.argv[i + 1] ?? null) : null;
};

type Row = Record<string, unknown>;

const tidy = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim();

async function main(): Promise<void> {
  const since = arg('since');
  if (!since) throw new Error('--since <iso> is required. Take it from the before-snapshot filename.');

  const { rows: projects, complete: pc } = await selectAllPaged<Row>(
    'projects',
    'id,name,market,module,status,stage,created_at,first_seen,last_activity,record_count,notes,significance,name_source',
    (q) => q,
    'movement-projects'
  );
  const { rows: leads, complete: lc } = await selectAllPaged<Row>(
    'leads',
    'id,title,url,source,stream,market,status,lifecycle,project_id,first_seen,published_date,filing_facts',
    (q) => q,
    'movement-leads'
  );
  if (!pc || !lc) throw new Error('a read was partial; refusing to report movement on a slice.');

  console.log('='.repeat(104));
  console.log(`THE FRESH RUN, MOVEMENT SINCE ${since}`);
  console.log('='.repeat(104));
  console.log('NO CAP: projects and leads both paged to exhaustion.');
  console.log('');

  const newProjects = projects.filter((p) => tidy(p.created_at) >= since);
  // LEADS HAVE NO created_at. The table carries `first_seen`, which the
  // date-capture standard defines as "when we first saw this row" and which the
  // write path sets on insert and never on update. So it is the arrival column
  // for a record, exactly as created_at is for a project, and using it is not a
  // substitution: it is the column that answers the question.
  const newLeads = leads.filter((l) => tidy(l.first_seen) >= since);
  const liveProjects = projects.filter((p) => String(p.status) !== 'dismissed');

  console.log('---- 1. NEW PROJECTS ----');
  console.log(`  ${newProjects.length} project row(s) created`);
  for (const p of newProjects) {
    console.log(
      `    ${String(p.market ?? '(none)').slice(0, 18).padEnd(19)} ${String(p.stage).padEnd(12)} ` +
        `${tidy(p.name).slice(0, 60)}`
    );
  }

  console.log('');
  console.log('---- 2. NEW RECORDS ----');
  console.log(`  ${newLeads.length} record(s) created`);
  const onExisting = newLeads.filter(
    (l) => l.project_id && !newProjects.some((p) => p.id === l.project_id)
  );
  console.log(`    on a project that already existed : ${onExisting.length}`);
  console.log(`    on a project created this run     : ${newLeads.filter((l) => l.project_id && newProjects.some((p) => p.id === l.project_id)).length}`);
  console.log(`    unclustered (Inbox)               : ${newLeads.filter((l) => !l.project_id).length}`);

  console.log('');
  console.log('  per source:');
  const bySource = new Map<string, number>();
  for (const l of newLeads) bySource.set(String(l.source ?? '(null)'), (bySource.get(String(l.source ?? '(null)')) ?? 0) + 1);
  for (const [s, n] of [...bySource.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${s.padEnd(22)} ${String(n).padStart(4)}`);
  }
  console.log('  per market:');
  const byMarket = new Map<string, number>();
  for (const l of newLeads) byMarket.set(String(l.market ?? '(none)'), (byMarket.get(String(l.market ?? '(none)')) ?? 0) + 1);
  for (const [m, n] of [...byMarket.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${m.slice(0, 22).padEnd(23)} ${String(n).padStart(4)}`);
  }

  // ---- 3. THE GATE NOTE'S QUESTION -----------------------------------------
  console.log('');
  console.log('---- 3. DID THE BROWARD ROWS COME BACK? ----');
  const broward = leads.filter((l) => String(l.market ?? '') === 'Broward County');
  const browardLive = broward.filter((l) => String(l.status) !== 'dismissed');
  const browardNew = newLeads.filter((l) => String(l.market ?? '') === 'Broward County');
  const compRe = /comprehensive\s+plan|land\s+use\s+plan/i;
  console.log(`  Broward records in the corpus     : ${broward.length}`);
  console.log(`  of those, live                    : ${browardLive.length}`);
  console.log(`  CREATED THIS RUN                  : ${browardNew.length}`);
  console.log(`  of those, title says comp/land-use plan : ${browardNew.filter((l) => compRe.test(tidy(l.title))).length}`);
  for (const l of browardNew.slice(0, 15)) {
    console.log(`    ${String(l.status).padEnd(10)} ${tidy(l.title).slice(0, 84)}`);
  }

  console.log('');
  console.log('  TOMBSTONED PROJECTS: did any come back to life?');
  const tombstoned = projects.filter((p) => tidy(p.notes).startsWith('[tombstoned'));
  const resurrected = tombstoned.filter((p) => String(p.status) !== 'dismissed');
  console.log(`    projects carrying a tombstone note : ${tombstoned.length}`);
  console.log(`    of those, no longer dismissed      : ${resurrected.length}`);
  for (const p of resurrected) console.log(`      RESURRECTED  ${tidy(p.name).slice(0, 70)}`);
  const tombIds = new Set(tombstoned.map((p) => String(p.id)));
  const newOnTomb = newLeads.filter((l) => l.project_id && tombIds.has(String(l.project_id)));
  console.log(`    records written this run onto a tombstoned project : ${newOnTomb.length}`);

  // A NEW ROW FOR THE SAME MATTER is the other path back, and a status check
  // cannot see it. Matched on name+market against the tombstoned set.
  const tombKeys = new Set(tombstoned.map((p) => `${tidy(p.name).toLowerCase()}||${tidy(p.market).toLowerCase()}`));
  const reborn = newProjects.filter((p) => tombKeys.has(`${tidy(p.name).toLowerCase()}||${tidy(p.market).toLowerCase()}`));
  console.log(`    NEW project rows matching a tombstoned name+market : ${reborn.length}`);
  for (const p of reborn) console.log(`      REBORN  ${tidy(p.name).slice(0, 70)} (${p.market})`);

  // ---- 4. STAGE CHANGES ----------------------------------------------------
  console.log('');
  console.log('---- 4. THE REGISTER NOW ----');
  console.log(`  project rows      : ${projects.length}`);
  console.log(`  live (not dismissed): ${liveProjects.length}`);
  console.log(`  records           : ${leads.length}`);
  console.log(`  records live      : ${leads.filter((l) => String(l.status) !== 'dismissed').length}`);
  const byStage = new Map<string, number>();
  for (const p of liveProjects) byStage.set(String(p.stage ?? '(none)'), (byStage.get(String(p.stage ?? '(none)')) ?? 0) + 1);
  console.log('  per stage:');
  for (const [s, n] of [...byStage.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${s.padEnd(22)} ${String(n).padStart(4)}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
