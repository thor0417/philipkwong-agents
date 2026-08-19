// EMITTING PROJECT EVENTS. The register's memory of change.
//
// The clusterer RECOMPUTES everything on every run. That is the right design for
// a partition - it is why re-running is idempotent and why the acceptance test
// can be reproduced - but it means the projects table only ever shows the
// present. A project that moved from filed to approved this week looks exactly
// like one approved a year ago, and nothing anywhere records that it moved.
//
// This module writes the difference between runs. Every event is append-only: a
// row here is never updated and never deleted, because a history that can be
// rewritten is not a history.
//
// ---- IDEMPOTENCY, which is the whole problem ---------------------------------
//
// The backfill runs on every scrape, and attach-on-write runs the SAME backfill.
// So the emitter is called repeatedly with overlapping inputs, and "re-running
// must not duplicate events" is not a nice property, it is the difference
// between a usable table and a growing pile of noise.
//
// THREE LAYERS, deliberately, because each catches what the one below cannot:
//
//   1. IN-BATCH DEDUPE. One run can derive the same event twice (a project
//      appears in two passes). Collapsed on the identity key before any I/O.
//
//   2. EXISTING-KEY FILTER. The identities already stored for the projects this
//      run touches are read once, and matching events are dropped. This is what
//      makes a repeat run write ZERO rows rather than relying on the database to
//      reject thousands of inserts.
//
//   3. A UNIQUE INDEX IN THE DATABASE (migration 020). The backstop. A guard
//      that lives only in TypeScript is a guard a future caller forgets, and the
//      database cannot be bypassed by a new code path. Verified live: a second
//      identical insert is rejected with SQLSTATE 23505.
//
// WHY NOT `on conflict do nothing`, which would be simpler? Because the unique
// index is on EXPRESSIONS - coalesce(from_value,'') and coalesce(to_value,'') -
// and PostgREST's on_conflict parameter can only name plain columns, so Postgres
// cannot infer the index and the statement errors with "no unique or exclusion
// constraint matching the ON CONFLICT specification". Verified against the live
// database rather than assumed. The coalesce is not optional either: a null does
// not compare equal to another null in a Postgres unique index, so without it
// every event with a null from_value - which is most of them - would duplicate
// freely. So layer 2 does the work and layer 3 catches the race, and a 23505 on
// insert is treated as SUCCESS rather than as an error, because it means the row
// this run wanted is already there.

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { LIVE_PIPELINE_STORAGE_KEY } from './pipelines';
import { supabaseAdmin } from '../../lib/supabase-admin';
import type { ProjectEventType, EventActor } from '../../lib/taxonomy';

export interface ProjectEventInput {
  project_id: string;
  event_type: ProjectEventType;
  // When it HAPPENED, which is not when it was observed. A record attached
  // during a backfill is dated at the record's own date, so the timeline reads
  // as the world happened rather than as we happened to scrape it.
  occurred_at: string;
  actor?: EventActor;
  from_value?: string | null;
  to_value?: string | null;
  lead_id?: string | null;
  detail?: Record<string, unknown> | null;
  module?: string;
}

export interface EmitReport {
  // Events the caller derived.
  derived: number;
  // Dropped because the same event appeared twice in this batch.
  duplicatesInBatch: number;
  // Dropped because the event is already stored.
  alreadyStored: number;
  // Rows actually inserted.
  inserted: number;
  // Rows the database rejected as duplicates (layer 3 caught a race). Not an
  // error: the row is present, which is what the caller wanted.
  rejectedAsDuplicate: number;
  // REFUSED BY AN INDEX COARSER THAN THE ONE THIS FILE ENFORCES, and counted
  // apart from rejectedAsDuplicate because it is the opposite kind of fact.
  //
  // Layers 1 and 2 already filtered on the FULL identity, occurred_at included.
  // So anything that reaches the database and still collides is colliding on
  // FEWER columns than we think identify an event: it is not a duplicate, it is
  // a distinct event the database refused, and counting it as a duplicate is how
  // three real stage changes went missing for three months while every run
  // reported success.
  //
  // Layer 3 can legitimately catch a race - two processes deriving the same
  // event at once - and that IS a duplicate. It is indistinguishable from a
  // coarse refusal at the row level, so this counter is a CEILING and says so
  // wherever it prints. A run with no concurrent writer, which is every run this
  // repo makes, has no races, and any non-zero value here is a refusal.
  refusedByACoarserIndex: number;
  writeFailures: number;
  byType: Record<string, number>;
}

export function emptyEmitReport(): EmitReport {
  return {
    derived: 0,
    duplicatesInBatch: 0,
    alreadyStored: 0,
    inserted: 0,
    rejectedAsDuplicate: 0,
    refusedByACoarserIndex: 0,
    writeFailures: 0,
    byType: {},
  };
}

// THE IDENTITY OF AN EVENT.
//
// LEAD_ID IS PART OF IT, and migration 020's index was wrong to omit it. I wrote
// that index; the backfill is what proved it wrong. Deriving history over the
// stored corpus produced 712 events and collapsed 89 of them, because two
// DIFFERENT records attaching to one project on the same date with the same
// cluster_reason are identical under (project, type, date, from, to) - and they
// are not one event, they are two records joining. Losing 89 of 364 attachments
// would have silently gutted the one query that makes "approved by this filing"
// answerable.
//
// Migration 023 corrects the index to match this function. Until it is applied
// the database rejects those 89 as duplicates, which the emitter counts as
// `rejectedAsDuplicate` rather than as an error - the run is honest about what
// it could not store, and re-running after 023 fills them in, because every
// layer here is idempotent.
//
// Two events of the same type on the same project at the same instant, carrying
// the same record and the same from/to values, do not exist: that is one event
// observed twice.
export function eventIdentity(e: {
  project_id: string;
  event_type: string;
  occurred_at: string;
  from_value?: string | null;
  to_value?: string | null;
  lead_id?: string | null;
}): string {
  return [
    e.project_id,
    e.event_type,
    new Date(e.occurred_at).toISOString(),
    e.from_value ?? '',
    e.to_value ?? '',
    e.lead_id ?? '',
  ].join('|');
}

const CHUNK = 500;
const UNIQUE_VIOLATION = '23505';

// Identities already stored for a set of projects. Read in chunks because a
// backfill touches every project and an `in` list has a practical size limit.
async function storedIdentities(projectIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const ids = [...new Set(projectIds)];
  for (let i = 0; i < ids.length; i += 100) {
    const slice = ids.slice(i, i + 100);
    let from = 0;
    for (;;) {
      const { data, error } = await supabaseAdmin
        .from('project_events')
        .select('project_id,event_type,occurred_at,from_value,to_value,lead_id')
        .in('project_id', slice)
        .range(from, from + 999);
      if (error) {
        // A read failure must not cause duplicate writes, so this is loud and
        // the caller's inserts will still be protected by the unique index.
        console.warn(`  events: could not read existing identities (${error.message.slice(0, 70)}).`);
        return out;
      }
      const rows = data ?? [];
      for (const r of rows) out.add(eventIdentity(r as never));
      if (rows.length < 1000) break;
      from += 1000;
    }
  }
  return out;
}

// Emit a batch. Safe to call with anything, including an empty array, and safe
// to call twice with the same input.
export async function emitProjectEvents(
  events: ProjectEventInput[],
  opts: { module?: string; noWrite?: boolean } = {}
): Promise<EmitReport> {
  const report = emptyEmitReport();
  report.derived = events.length;
  if (events.length === 0) return report;

  // Layer 1: collapse duplicates within this batch.
  const byIdentity = new Map<string, ProjectEventInput>();
  for (const e of events) {
    const k = eventIdentity(e);
    if (byIdentity.has(k)) {
      report.duplicatesInBatch++;
      continue;
    }
    byIdentity.set(k, e);
  }

  if (opts.noWrite) {
    for (const e of byIdentity.values()) {
      report.byType[e.event_type] = (report.byType[e.event_type] ?? 0) + 1;
    }
    return report;
  }

  // Layer 2: drop what is already stored.
  const existing = await storedIdentities([...byIdentity.values()].map((e) => e.project_id));
  const fresh: ProjectEventInput[] = [];
  for (const [k, e] of byIdentity) {
    if (existing.has(k)) {
      report.alreadyStored++;
      continue;
    }
    fresh.push(e);
  }
  if (fresh.length === 0) return report;

  const rows = fresh.map((e) => ({
    project_id: e.project_id,
    module: e.module ?? opts.module ?? LIVE_PIPELINE_STORAGE_KEY,
    event_type: e.event_type,
    occurred_at: new Date(e.occurred_at).toISOString(),
    actor: e.actor ?? 'system',
    from_value: e.from_value ?? null,
    to_value: e.to_value ?? null,
    lead_id: e.lead_id ?? null,
    detail: e.detail ?? null,
  }));

  // Layer 3 is the database. A chunk that hits the unique index is retried row
  // by row so one duplicate cannot discard the other 499 genuinely new events.
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabaseAdmin.from('project_events').insert(chunk);
    if (!error) {
      report.inserted += chunk.length;
      for (const r of chunk) report.byType[r.event_type] = (report.byType[r.event_type] ?? 0) + 1;
      continue;
    }
    if (error.code !== UNIQUE_VIOLATION) {
      console.error(`  events: insert failed (${error.message.slice(0, 90)}).`);
      report.writeFailures += chunk.length;
      continue;
    }
    for (const r of chunk) {
      const one = await supabaseAdmin.from('project_events').insert(r);
      if (!one.error) {
        report.inserted++;
        report.byType[r.event_type] = (report.byType[r.event_type] ?? 0) + 1;
      } else if (one.error.code === UNIQUE_VIOLATION) {
        // Layer 2 read this project's stored identities and did NOT find this
        // one, so the database is enforcing a narrower key than we identify an
        // event by. See refusedByACoarserIndex.
        report.rejectedAsDuplicate++;
        report.refusedByACoarserIndex++;
        console.error(
          `  events: REFUSED, and it is not a duplicate by our identity - ` +
            `${r.event_type} on ${r.project_id} at ${r.occurred_at} ` +
            `(${one.error.message.slice(0, 70)})`
        );
      } else {
        console.error(`  events: row insert failed (${one.error.message.slice(0, 80)}).`);
        report.writeFailures++;
      }
    }
  }
  return report;
}

// ---- THE LEDGER -------------------------------------------------------------
//
// THE COUNTERS EXISTED AND WENT TO STDOUT ONLY, so the number that would have
// said the audit trail was lossy was itself not kept, for three months. The
// question "how many event inserts did the last capture run attempt, and how
// many landed" was unanswerable from anything that survived the run.
//
// One appended line per emit, in snapshots/ beside the corpus snapshots and the
// orphan-deletion logs, which is where this repo already puts a run's artefacts.
// Append rather than overwrite: the history is the point, and a file holding
// only the last run cannot show a counter climbing.
//
// It is deliberately NOT a table. A table needs a migration, a migration is
// blocking on Philip, and the smallest change that survives a run is a file.
const LEDGER_DIR = 'snapshots';
const LEDGER = path.join(LEDGER_DIR, 'project-events-emit.jsonl');

export function persistEmitReport(label: string, r: EmitReport): string {
  mkdirSync(LEDGER_DIR, { recursive: true });
  const line = JSON.stringify({
    at: new Date().toISOString(),
    label,
    derived: r.derived,
    duplicatesInBatch: r.duplicatesInBatch,
    alreadyStored: r.alreadyStored,
    // ATTEMPTED is what actually reached the database: derived, less what the
    // two in-process layers removed. It is the half of "attempted versus landed"
    // that was never recoverable after the run.
    attempted: r.derived - r.duplicatesInBatch - r.alreadyStored,
    inserted: r.inserted,
    rejectedAsDuplicate: r.rejectedAsDuplicate,
    refusedByACoarserIndex: r.refusedByACoarserIndex,
    writeFailures: r.writeFailures,
    byType: r.byType,
  });
  appendFileSync(LEDGER, line + '\n', 'utf8');
  // READ BACK, per standing rule 11. A writer that reports a path it did not
  // produce is the defect that rule exists for, and this one runs unattended.
  const written = readFileSync(LEDGER, 'utf8').trimEnd().split('\n');
  if (written[written.length - 1] !== line) {
    throw new Error(`emit ledger did not read back from ${LEDGER}`);
  }
  return LEDGER;
}

export function printEmitReport(label: string, r: EmitReport): void {
  if (r.derived === 0) {
    console.log(`\n${label} events: none derived.`);
    return;
  }
  console.log(
    `\n${label} events: ${r.derived} derived -> ${r.inserted} written ` +
      `(${r.duplicatesInBatch} duplicate in batch, ${r.alreadyStored} already stored, ` +
      `${r.rejectedAsDuplicate} rejected by the unique index, ${r.writeFailures} failed).`
  );
  // LOUD, because it is the one number here that means something was LOST.
  if (r.refusedByACoarserIndex > 0) {
    console.log(
      `  ${r.refusedByACoarserIndex} of those were refused on a key NARROWER than our identity: ` +
        `layer 2 did not find them stored, so they are distinct events the database would not ` +
        `take. At most this many are concurrent-write races; this repo runs no concurrent writer, ` +
        `so treat it as the count LOST. See migration 039.`
    );
  }
  const types = Object.entries(r.byType).sort((a, b) => b[1] - a[1]);
  if (types.length === 0) {
    console.log('  nothing new: every derived event was already recorded (a repeat run).');
    return;
  }
  for (const [t, n] of types) console.log(`  ${String(n).padStart(5)}  ${t}`);
}
