// BACKFILL: the project history that can honestly be inferred, and nothing else.
//
//   node --env-file=.env.local --import tsx agents/scraper/migrations/backfill-project-events.ts
//   EVENTS_BACKFILL_DRY=1 to report without writing.
//
// The event table starts empty against a corpus of 184 projects and 364 attached
// records that already exist. Three classes of history are RECOVERABLE from what
// is stored, because the stored row carries the date the thing happened:
//
//   project_created   at the project's first_seen
//   record_attached   at the record's own date (published/deadline/first_seen)
//   party_identified  where a project carries an applicant or representative,
//                     dated at the record that names them
//
// ---- WHAT IS NOT RECOVERABLE, AND WHY IT IS LEFT EMPTY ----------------------
//
// STAGE HISTORY BEGINS NOW. Stage is recomputed from scratch on every run and
// never stored anywhere but the projects row, so there is no record of what any
// project's stage was yesterday. A transition could only be invented - "it is
// approved now, it was probably filed before, so let us write a stage_changed
// dated at the earliest record" - and that would be a fabrication with a
// plausible date on it.
//
// The one thing this table is FOR is being trustworthy about what moved. A
// single invented transition poisons every answer it will ever give, because a
// reader cannot tell the invented rows from the observed ones. So there are no
// stage_changed rows before the first run of the emitter, the register will
// answer "what moved" only for periods after that, and this file says so rather
// than quietly leaving a gap for someone to misread as "nothing moved".
//
// The same reasoning excludes record_detached (we do not know what was ever
// detached), watch/status/note events (curation began after this), and
// merged/split.

import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { selectAllPaged } from '../page-select';
import { emitProjectEvents, printEmitReport, type ProjectEventInput } from '../project-events';

const MODULE = 'gli';

interface ProjectRow {
  id: string;
  name: string;
  market: string | null;
  stage: string | null;
  first_seen: string | null;
  last_activity: string | null;
  primary_applicant: string | null;
  primary_representative: string | null;
}

interface LeadRow {
  id: string;
  title: string | null;
  source: string | null;
  project_id: string | null;
  cluster_reason: string | null;
  applicant: string | null;
  representative: string | null;
  published_date: string | null;
  deadline: string | null;
  first_seen: string | null;
}

// The date a record itself carries, in the same precedence the clusterer uses.
function leadDate(l: LeadRow): string | null {
  return l.deadline ?? l.published_date ?? l.first_seen ?? null;
}

export async function backfillProjectEvents(): Promise<void> {
  const dry = process.env.EVENTS_BACKFILL_DRY === '1';
  console.log('===== PROJECT EVENT BACKFILL =====');
  if (dry) console.log('(EVENTS_BACKFILL_DRY=1: nothing will be written)');

  const { rows: projects, complete: pOk } = await selectAllPaged<ProjectRow>(
    'projects',
    'id,name,market,stage,first_seen,last_activity,primary_applicant,primary_representative',
    (q: unknown) => (q as { eq: (a: string, b: string) => unknown }).eq('module', MODULE),
    'projects'
  );
  const { rows: leads, complete: lOk } = await selectAllPaged<LeadRow>(
    'leads',
    'id,title,source,project_id,cluster_reason,applicant,representative,published_date,deadline,first_seen',
    (q: unknown) => (q as { eq: (a: string, b: string) => unknown }).eq('module', MODULE),
    'leads'
  );
  if (!pOk || !lOk) {
    console.error('Read was incomplete; refusing to backfill a partial history.');
    process.exitCode = 1;
    return;
  }
  const byProject = new Map<string, LeadRow[]>();
  for (const l of leads) {
    if (!l.project_id) continue;
    if (!byProject.has(l.project_id)) byProject.set(l.project_id, []);
    byProject.get(l.project_id)!.push(l);
  }
  console.log(`\n${projects.length} projects, ${leads.filter((l) => l.project_id).length} attached records.`);

  const events: ProjectEventInput[] = [];
  let skippedNoDate = 0;

  for (const p of projects) {
    const members = byProject.get(p.id) ?? [];

    // 1. project_created, at first_seen.
    const created = p.first_seen ?? p.last_activity;
    if (created) {
      events.push({
        project_id: p.id,
        event_type: 'project_created',
        occurred_at: created,
        to_value: p.name,
        detail: { market: p.market, backfilled: true },
      });
    } else {
      skippedNoDate++;
    }

    // 2. record_attached, at the record's own date.
    for (const m of members) {
      const at = leadDate(m);
      if (!at) {
        skippedNoDate++;
        continue;
      }
      events.push({
        project_id: p.id,
        event_type: 'record_attached',
        occurred_at: at,
        to_value: m.cluster_reason,
        lead_id: m.id,
        detail: { title: (m.title ?? '').slice(0, 120), source: m.source, backfilled: true },
      });
    }

    // 3. party_identified, dated at the EARLIEST record that names the party -
    // that is when the party became knowable, not when the project row was last
    // written. A project whose applicant appears on no member record is skipped
    // rather than dated at a guess.
    for (const [role, value] of [
      ['applicant', p.primary_applicant],
      ['representative', p.primary_representative],
    ] as const) {
      if (!value) continue;
      const naming = members
        .filter((m) => (role === 'applicant' ? m.applicant : m.representative) === value)
        .map((m) => ({ m, at: leadDate(m) }))
        .filter((x): x is { m: LeadRow; at: string } => Boolean(x.at))
        .sort((a, b) => a.at.localeCompare(b.at))[0];
      if (!naming) {
        skippedNoDate++;
        continue;
      }
      events.push({
        project_id: p.id,
        event_type: 'party_identified',
        occurred_at: naming.at,
        to_value: value,
        lead_id: naming.m.id,
        detail: { role, backfilled: true },
      });
    }
  }

  const derivedByType: Record<string, number> = {};
  for (const e of events) derivedByType[e.event_type] = (derivedByType[e.event_type] ?? 0) + 1;
  console.log('\nDerived from stored data:');
  for (const [t, n] of Object.entries(derivedByType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)}  ${t}`);
  }
  if (skippedNoDate > 0) {
    console.log(`  ${String(skippedNoDate).padStart(5)}  skipped: no date to place them at (never invented)`);
  }

  console.log('\nNOT BACKFILLED, on purpose:');
  console.log('     stage_changed   STAGE HISTORY BEGINS NOW. Stage is recomputed every');
  console.log('                     run and never stored historically, so no transition');
  console.log('                     before this point is recoverable. Inventing one would');
  console.log('                     put a plausible date on a fabrication, and a reader');
  console.log('                     could not tell it from an observed row.');
  console.log('     record_detached we have no record of what was ever detached.');
  console.log('     watch/status/note/renamed  curation has not begun; 0 projects carry any.');
  console.log('     merged/split    reserved for hand-run repairs.');

  const report = await emitProjectEvents(events, { module: MODULE, noWrite: dry });
  printEmitReport('Backfilled', report);

  if (!dry) {
    const { data: range } = await supabaseAdmin
      .from('project_events')
      .select('occurred_at')
      .order('occurred_at', { ascending: true })
      .limit(1);
    const { data: latest } = await supabaseAdmin
      .from('project_events')
      .select('occurred_at')
      .order('occurred_at', { ascending: false })
      .limit(1);
    const { count } = await supabaseAdmin
      .from('project_events')
      .select('*', { count: 'exact', head: true });
    console.log(
      `\nSTORED: ${count} events, earliest ${String(range?.[0]?.occurred_at ?? '-').slice(0, 10)}, ` +
        `latest ${String(latest?.[0]?.occurred_at ?? '-').slice(0, 10)}.`
    );
  }
  console.log('==================================\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  backfillProjectEvents().catch((err) => {
    console.error('Project event backfill failed:', err);
    process.exitCode = 1;
  });
}
