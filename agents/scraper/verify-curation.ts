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
  const { data: curated } = await supabaseAdmin
    .from('projects')
    .select('id,name,status,notes,watch,manual_overrides,record_count')
    .or('notes.not.is.null,watch.is.true')
    .limit(5);
  const curatedRows = (curated ?? []) as Record<string, unknown>[];
  console.log(`       ${curatedRows.length} project(s) currently carry curation:`);
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
  const { data: projects } = await supabaseAdmin.from('projects').select('id,record_count');
  const { data: attached } = await supabaseAdmin
    .from('leads')
    .select('project_id,status')
    .not('project_id', 'is', null)
    .limit(5000);
  const liveCounts = new Map<string, number>();
  for (const l of (attached ?? []) as { project_id: string; status: string }[]) {
    if (l.status === 'dismissed') continue;
    liveCounts.set(l.project_id, (liveCounts.get(l.project_id) ?? 0) + 1);
  }
  const drift = ((projects ?? []) as { id: string; record_count: number | null }[]).filter(
    (p) => (p.record_count ?? 0) !== (liveCounts.get(p.id) ?? 0)
  );
  check('every project record_count matches its live rows', drift.length, 0);

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
