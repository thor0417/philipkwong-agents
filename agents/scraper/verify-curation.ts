// VERIFY THE CURATION LAYER. Every protection Philip depends on, demonstrated
// against the live database rather than asserted in a comment.
//
// These were demonstrated once, by hand, when each protection was built. That is
// not something you can re-run after a brief's worth of changes to the write
// paths, migrations and sweeps, so this makes it repeatable. Run it after any
// change that touches how rows are written.
//
// It uses a FIXTURE it creates and removes: one lead on a reserved URL that no
// adapter can produce. Philip's rows are read but never written. The fixture is
// deleted at the end - it is test scaffolding, not data, and the "nothing is
// hard deleted" rule is about the corpus.
//
// Run: node --env-file=.env.local --import tsx agents/scraper/verify-curation.ts

import { LIVE_PIPELINE_STORAGE_KEY } from './pipelines';
import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../lib/supabase-admin';
import { guardedUpsert, emptyWriteReport, OWNED_BY_USER } from './write-guard';
import { PROJECT_OWNED_BY_USER } from './project-write';
import { orphanIsCurated } from './migrations/backfill-projects';
import { selectAllPaged } from './page-select';
import type { NormalizedLead } from './sources/types';

const FIXTURE_URL = 'https://verify-curation.invalid/fixture#1';

let pass = 0;
let fail = 0;
function check(label: string, got: unknown, expected: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}`);
  if (!ok) console.log(`       got=${JSON.stringify(got)} exp=${JSON.stringify(expected)}`);
}

function fixtureLead(title: string, extra: Record<string, unknown> = {}): NormalizedLead {
  return {
    title,
    url: FIXTURE_URL,
    raw_content: 'curation verification fixture',
    company: 'Fixture Co',
    location: 'Nowhere',
    deadline: null,
    published_date: null,
    value_estimate: null,
    source: 'verify-curation',
    ...extra,
  } as NormalizedLead;
}

async function readFixture(): Promise<Record<string, unknown> | null> {
  const { data } = await supabaseAdmin.from('leads').select('*').eq('url', FIXTURE_URL).limit(1);
  return ((data ?? [])[0] as Record<string, unknown>) ?? null;
}

async function write(lead: NormalizedLead, extra: Record<string, unknown> = {}): Promise<void> {
  const report = emptyWriteReport();
  await guardedUpsert([{ ...(lead as unknown as Record<string, unknown>), ...extra }], report);
}

async function cleanup(): Promise<void> {
  await supabaseAdmin.from('leads').delete().eq('url', FIXTURE_URL);
}

async function main(): Promise<void> {
  console.log('===== CURATION LAYER VERIFICATION =====');
  await cleanup();

  // ---- 1. TOMBSTONE ---------------------------------------------------------
  // A dismissed row is never written again. This is what makes Philip's triage
  // permanent instead of a suggestion the next scrape overrules.
  console.log('\n--- 1. TOMBSTONE: a dismissed row is never rewritten ---');
  await write(fixtureLead('Original title'));
  const created = await readFixture();
  check('fixture written', created?.title, 'Original title');

  await supabaseAdmin.from('leads').update({ status: 'dismissed' }).eq('url', FIXTURE_URL);
  await write(fixtureLead('Scraper tried to overwrite a dismissed row'));
  const afterTombstone = await readFixture();
  check('title unchanged after a scrape write', afterTombstone?.title, 'Original title');
  check('status still dismissed', afterTombstone?.status, 'dismissed');

  // ---- 2. OWNED COLUMNS -----------------------------------------------------
  // status, notes, manual_overrides and status_changed_at are Philip's. A scrape
  // payload carrying them must have them stripped, not honoured, so a new write
  // path cannot reintroduce the bug by forgetting.
  console.log('\n--- 2. OWNED COLUMNS: stripped from every scrape payload ---');
  await supabaseAdmin
    .from('leads')
    .update({ status: 'watchlist', notes: 'Philip note' })
    .eq('url', FIXTURE_URL);
  await write(fixtureLead('Second title'), {
    status: 'new',
    notes: 'scraper tried to overwrite the note',
    manual_overrides: { title: true },
  });
  const afterOwned = await readFixture();
  check('status survived a payload that set it', afterOwned?.status, 'watchlist');
  check('notes survived a payload that set them', afterOwned?.notes, 'Philip note');
  check('manual_overrides not set by the scraper', afterOwned?.manual_overrides, null);
  check('non-owned field DID update', afterOwned?.title, 'Second title');
  console.log(`       owned columns: ${OWNED_BY_USER.join(', ')}`);

  // ---- 3. OVERRIDES ---------------------------------------------------------
  // A field named in manual_overrides is Philip's correction and is never
  // overwritten, while everything he has not corrected still enriches.
  console.log('\n--- 3. OVERRIDES: a corrected field is never overwritten ---');
  await supabaseAdmin
    .from('leads')
    .update({ manual_overrides: { title: true }, title: 'Philip corrected this title' })
    .eq('url', FIXTURE_URL);
  await write(fixtureLead('Scraper title'), { company: 'Enriched Co' });
  const afterOverride = await readFixture();
  check('overridden title untouched', afterOverride?.title, 'Philip corrected this title');
  check('non-overridden field still enriched', afterOverride?.company, 'Enriched Co');

  // ---- 4. PROJECT CURATION AND DETACH ---------------------------------------
  // The same separation on the register: a project's status, notes, watch flag
  // and manual_overrides belong to Philip, and a record he has detached must not
  // be silently reattached.
  console.log('\n--- 4. PROJECT CURATION: owned columns and detachment ---');
  console.log(`       project owned columns: ${PROJECT_OWNED_BY_USER.join(', ')}`);
  // THE COUNT IS COUNTED, THE SAMPLE IS SAMPLED, AND THEY ARE TWO QUERIES.
  //
  // This read five rows and then printed "N project(s) currently carry
  // curation" from the length of the five, so the answer was 5 whenever it was
  // 5 or more. Standing rule 13: a figure taken from a capped read states the
  // cap beside it, and the honest fix here is not to state the cap but to stop
  // capping the thing being counted.
  const { count: curatedTotal } = await supabaseAdmin
    .from('projects')
    .select('id', { count: 'exact', head: true })
    .or('notes.not.is.null,watch.is.true');
  const SAMPLE = 5;
  const { data: curated } = await supabaseAdmin
    .from('projects')
    .select('id,name,status,notes,watch,manual_overrides,record_count')
    .or('notes.not.is.null,watch.is.true')
    .limit(SAMPLE);
  const curatedRows = (curated ?? []) as Record<string, unknown>[];
  console.log(
    `       ${curatedTotal ?? '?'} project(s) currently carry curation` +
      `${(curatedTotal ?? 0) > curatedRows.length ? `, showing the first ${curatedRows.length}` : ''}:`
  );
  for (const p of curatedRows) {
    console.log(
      `         ${String(p.id).slice(0, 8)} status=${p.status} watch=${p.watch} ` +
        `notes=${p.notes ? 'yes' : '-'} records=${p.record_count}  "${String(p.name).slice(0, 44)}"`
    );
  }

  // Detachment is recorded on the LEAD, so a detached record is one with no
  // project_id that the clusterer would otherwise have claimed. Report the
  // count rather than manufacturing one on Philip's data.
  const { count: detached } = await supabaseAdmin
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('module', LIVE_PIPELINE_STORAGE_KEY)
    .is('project_id', null)
    .neq('status', 'dismissed');
  console.log(`       ${detached} live GLI records sit in the Inbox with no project.`);

  // Cached counts must agree with the rows behind them, on every project.
  //
  // PAGED, NOT CAPPED. This read the leads with `.limit(5000)` and the projects
  // with no range at all, which PostgREST answers with its own default of 1000.
  // Both caps fed an ASSERTION rather than a display: past them, a project's
  // rows stop being counted, its cached count stops matching, and the check
  // reports drift that is really truncation. 713 attached rows today and 340
  // projects, so neither had bitten - which is the condition under which a
  // wrong clause hides. Standing rule 13 says state the cap beside the number;
  // where the number is a pass/fail, the answer is to remove the cap.
  const { rows: projects, complete: projectsComplete } = await selectAllPaged<{
    id: string;
    record_count: number | null;
  }>('projects', 'id,record_count', (q) => q, 'record_count drift: projects');
  const { rows: attached, complete: attachedComplete } = await selectAllPaged<{
    project_id: string;
    status: string;
  }>('leads', 'project_id,status', (q) => (q as { not: (c: string, o: string, v: unknown) => unknown }).not('project_id', 'is', null), 'record_count drift: attached leads');
  check('the drift check read every project', projectsComplete, true);
  check('the drift check read every attached record', attachedComplete, true);
  const liveCounts = new Map<string, number>();
  for (const l of attached) {
    if (l.status === 'dismissed') continue;
    liveCounts.set(l.project_id, (liveCounts.get(l.project_id) ?? 0) + 1);
  }
  const drift = projects.filter((p) => (p.record_count ?? 0) !== (liveCounts.get(p.id) ?? 0));
  console.log(`       drift checked over ${projects.length} projects and ${attached.length} attached records, uncapped.`);
  check('every project record_count matches its live rows', drift.length, 0);

  // ---- THE ORPHAN SWEEP MAY NOT DELETE A PROJECT A CLIENT HOLDS -------------
  //
  // client_projects.project_id is `on delete cascade` (migration 033), so a
  // shell deleted by the sweep does not orphan Philip's confirmation, it erases
  // it: no tombstone, no line in the removal log, and nothing on disk that
  // enumerates a confirmed set to reconstruct it from. It happened on
  // 2026-08-21, when the backfill re-keyed three projects and JKR's confirmed
  // count fell from 116 to 115. Which project it was is not recoverable.
  //
  // Asserted here rather than through the sweep itself because the sweep has no
  // dry run: PROJECTS_NO_WRITE=1 returns from runBackfill before it is reached.
  const bare = { status: 'new' as string | null, watch: null, notes: null, manual_overrides: null };
  check('an untouched empty shell may be deleted', orphanIsCurated(bare, false), false);
  check('a shell a client PROPOSED is kept', orphanIsCurated(bare, true), true);
  check('a shell with notes is kept', orphanIsCurated({ ...bare, notes: 'x' }, false), true);
  check('a shell that is watched is kept', orphanIsCurated({ ...bare, watch: true }, false), true);
  check('a shell with a manual override is kept', orphanIsCurated({ ...bare, manual_overrides: { name: 1 } }, false), true);
  check('a shell with a hand-set status is kept', orphanIsCurated({ ...bare, status: 'dismissed' }, false), true);

  // Every membership row in the database points at a project that still exists.
  // If the sweep ever deletes one again this reads zero anyway, because the
  // cascade removes the evidence with it - so the real guard is the six checks
  // above and this is the corroborating read.
  const { data: memberships } = await supabaseAdmin.from('client_projects').select('project_id');
  const memberIds = [...new Set(((memberships ?? []) as { project_id: string }[]).map((m) => m.project_id))];
  const alive = new Set<string>();
  for (let i = 0; i < memberIds.length; i += 40) {
    const { data } = await supabaseAdmin.from('projects').select('id').in('id', memberIds.slice(i, i + 40));
    for (const p of (data ?? []) as { id: string }[]) alive.add(p.id);
  }
  check('every client_projects row points at a live project', memberIds.filter((id) => !alive.has(id)).length, 0);

  await cleanup();
  const gone = await readFixture();
  check('fixture removed', gone, null);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
