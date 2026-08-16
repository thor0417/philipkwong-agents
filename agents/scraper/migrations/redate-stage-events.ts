// REDATE THE STAGE EVENTS ALREADY STORED.
//
// The emitter dated a stage change at `last_activity ?? first_seen` and
// attributed it to the project's newest record. Both are "the most recent thing
// we hold" standing in for "the thing that happened", and the August report's
// first page carried the result:
//
//   Heart Hotel / Kulik River: approved to stalled    2026-08-10  gli_serper
//   OCVibe: under construction to approved            2026-08-10  gli_serper
//   Disneyland Resort: approved to under construction 2026-08-10  gli_serper
//
// all three dated the day press arrived. Clark County approved Heart Hotel on
// 2026-07-21; OCVibe's cause is an Anaheim agenda item from 2025-07-21.
//
// The emitter is fixed. This is the eleven rows already written.
//
// NOTHING IS DELETED. A row with no causing record is left exactly as it is and
// REPORTED, because deciding it should never have existed is a different call
// from correcting a date, and because "stalled" and "dormant" are real verdicts
// that the report layer now declines to print as movement rather than pretending
// they never happened.
//
//   npm run redate:stage-events            report only
//   npm run redate:stage-events -- --write apply

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { recordStage, STAGE_LADDER } from '../../../lib/taxonomy';

const WRITE = process.argv.includes('--write');
const onLadder = (s: string | null) => (STAGE_LADDER as readonly string[]).includes(String(s ?? ''));

interface Ev {
  id: string; project_id: string; occurred_at: string;
  from_value: string | null; to_value: string | null; lead_id: string | null;
}
interface Rec {
  id: string; project_id: string | null; title: string | null; raw_content: string | null;
  source: string | null; source_type: string | null;
  published_date: string | null; deadline: string | null; status: string | null;
}

async function main(): Promise<void> {
  const { data: evs, error } = await supabaseAdmin
    .from('project_events')
    .select('id,project_id,occurred_at,from_value,to_value,lead_id')
    .eq('event_type', 'stage_changed');
  if (error) throw new Error(error.message);
  const events = (evs ?? []) as Ev[];

  const pids = [...new Set(events.map((e) => e.project_id))];
  const { data: ps } = await supabaseAdmin.from('projects').select('id,name').in('id', pids);
  const names = new Map((ps ?? []).map((p) => [p.id as string, String(p.name)]));

  const recs: Rec[] = [];
  for (let i = 0; i < pids.length; i += 100) {
    const { data } = await supabaseAdmin
      .from('leads')
      .select('id,project_id,title,raw_content,source,source_type,published_date,deadline,status')
      .in('project_id', pids.slice(i, i + 100));
    recs.push(...((data ?? []) as Rec[]));
  }
  const byProject = new Map<string, Rec[]>();
  for (const r of recs) {
    if (!r.project_id) continue;
    if (!byProject.has(r.project_id)) byProject.set(r.project_id, []);
    byProject.get(r.project_id)!.push(r);
  }
  const at = (r: Rec) => r.deadline ?? r.published_date ?? null;

  // The same rule the emitter now uses: the earliest dated record whose own text
  // derives the stage moved to.
  function cause(e: Ev): Rec | null {
    const rs = (byProject.get(e.project_id) ?? []).filter((r) => r.status !== 'dismissed');
    const hits = rs.filter(
      (r) => at(r) && recordStage(`${r.title ?? ''} ${r.raw_content ?? ''}`, r.source_type) === e.to_value
    );
    hits.sort((a, b) => String(at(a)).localeCompare(String(at(b))));
    return hits[0] ?? null;
  }

  console.log('===== STAGE EVENTS: DATE AND ATTRIBUTION =====');
  console.log(WRITE ? 'MODE: WRITE\n' : 'MODE: report only\n');

  const fixes: { e: Ev; c: Rec }[] = [];
  const unsupported: Ev[] = [];
  for (const e of events) {
    const c = cause(e);
    const kind = !onLadder(e.from_value) || !onLadder(e.to_value)
      ? 'liveness'
      : (STAGE_LADDER as readonly string[]).indexOf(String(e.to_value)) >
          (STAGE_LADDER as readonly string[]).indexOf(String(e.from_value))
        ? 'advance'
        : 'correction';
    const was = e.occurred_at.slice(0, 10);
    const now = c ? String(at(c)).slice(0, 10) : null;
    console.log(
      `${kind.padEnd(11)} ${String(names.get(e.project_id) ?? '').slice(0, 32).padEnd(34)} ` +
        `${String(e.from_value).padEnd(18)} -> ${String(e.to_value).padEnd(18)} ${was}` +
        (c ? (now === was ? '  (already correct)' : `  ->  ${now}`) : '  (no causing record)')
    );
    if (c) {
      console.log(`            cause: ${c.source} "${String(c.title).slice(0, 56)}"`);
      if (now !== was || e.lead_id !== c.id) fixes.push({ e, c });
    } else {
      unsupported.push(e);
    }
  }

  console.log(`\n  to redate or reattribute: ${fixes.length}`);
  console.log(`  left alone, no causing record: ${unsupported.length}`);
  console.log('  (those are liveness verdicts or a stage no record supports; the report');
  console.log('   layer declines to print either as movement, and nothing is deleted here)');

  if (!WRITE) {
    console.log('\nNothing written. Re-run with --write to apply.');
    return;
  }
  for (const { e, c } of fixes) {
    const { error: up } = await supabaseAdmin
      .from('project_events')
      .update({ occurred_at: new Date(String(at(c))).toISOString(), lead_id: c.id })
      .eq('id', e.id);
    if (up) throw new Error(`update failed: ${up.message}`);
  }
  console.log(`\nRedated ${fixes.length} stage events onto the record that caused them.`);

  // AN EVENT WE CANNOT ATTRIBUTE MUST NOT NAME A SOURCE.
  //
  // "Disneyland Resort: approved to under construction, 2026-08-10, gli_serper"
  // survived the redate because it is a forward move and therefore a real
  // advance - but NO record of that project derives 'under construction', so the
  // lead_id was pointing at whatever arrived most recently, which was a press
  // item about OCVibe's concert hall.
  //
  // lead_id is nullable and this is what nullable means here: we know the stage
  // moved and we cannot say which document moved it. Cleared rather than
  // guessed, and the report's existing rule - a line with no source is not
  // printed and is counted instead - then does the right thing without needing
  // a second rule about it.
  const misattributed = unsupported.filter((e) => e.lead_id);
  for (const e of misattributed) {
    const { error: up } = await supabaseAdmin
      .from('project_events').update({ lead_id: null }).eq('id', e.id);
    if (up) throw new Error(`detach failed: ${up.message}`);
  }
  console.log(
    `Cleared lead_id on ${misattributed.length} event${misattributed.length === 1 ? '' : 's'} ` +
      `attributed to a record that does not support the stage.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
