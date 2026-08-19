// RECORDING WHAT PHILIP DID. The dashboard half of the project event log.
//
// The scraper writes events with actor 'system'; everything here writes actor
// 'philip'. That distinction is the reason the column exists: a year from now,
// "approved" because the clusterer read a staff report and "approved" because
// Philip decided it look identical without it, and only one of those is
// evidence.
//
// A SEPARATE FILE FROM agents/scraper/project-events.ts, and not by choice: the
// dashboard is its own Next.js project and cannot import the root module (the
// same constraint that makes dashboard/lib/taxonomy.ts a mirror). This is
// deliberately the SMALLEST possible mirror - one insert - rather than a copy of
// the emitter, because the scraper's three-layer idempotency machinery solves a
// problem this side does not have.
//
// WHY occurred_at IS THE CLOCK HERE, when the scraper is forbidden from using
// it. The scraper RECOMPUTES: it derives the same logical event on every run, so
// a clock-derived timestamp would give it a new identity each time and duplicate
// it forever. A person clicking rename does it ONCE, at a moment, and that
// moment is the honest answer to "when did this happen". There is nothing to
// deduplicate because there is no recompute.
//
// A FAILED EVENT MUST NOT FAIL THE EDIT. The edit is the thing Philip asked for;
// the event is bookkeeping about it. If the insert fails we log and carry on,
// because losing one audit row is much better than a rename that appears to have
// failed and gets retried into a second rename.

import { LIVE_PIPELINE_STORAGE_KEY } from './pipelines';
import { supabase } from './supabase';

// Mirrors PROJECT_EVENT_TYPES in lib/taxonomy.ts. Keep the two in sync; the root
// module is the authority.
export type ProjectEventType =
  | 'project_created'
  | 'stage_changed'
  | 'record_attached'
  | 'record_detached'
  | 'party_identified'
  | 'milestone_set'
  | 'watch_added'
  | 'watch_removed'
  | 'renamed'
  | 'status_changed'
  | 'note_added'
  | 'merged'
  | 'split';

export interface ManualEvent {
  project_id: string;
  event_type: ProjectEventType;
  from_value?: string | null;
  to_value?: string | null;
  lead_id?: string | null;
  detail?: Record<string, unknown> | null;
}

// WHAT HAPPENED TO THE EVENT, RETURNED RATHER THAN SWALLOWED.
//
// This used to log to console.error and return void, so every caller believed
// the event was recorded and no screen could say otherwise. It hid a real fault
// for three months: a repeat watch toggle returns 23505 on an index that omits
// occurred_at, so project_events held exactly one watch_added/watch_removed pair
// per project, ever, while the harness wrote eight per run.
//
// STILL NOT THROWN, and that is a separate decision from being silent. The
// column write has already succeeded by the time this runs, so throwing would
// report a failed edit that in fact landed - the pane would say the rename
// failed over a renamed project. The caller gets a result and decides.
export type EventWriteResult =
  | { ok: true }
  // The database refused it as a duplicate. After migration 039 this means a
  // genuine repeat of the same event at the same instant, which is one event
  // observed twice. Before 039 it also meant a distinct event on a coarser key.
  | { ok: false; reason: 'refused'; message: string }
  | { ok: false; reason: 'failed'; message: string };

const UNIQUE_VIOLATION = '23505';

export async function recordManualEvent(e: ManualEvent): Promise<EventWriteResult> {
  const { error } = await supabase.from('project_events').insert({
    project_id: e.project_id,
    module: LIVE_PIPELINE_STORAGE_KEY,
    event_type: e.event_type,
    occurred_at: new Date().toISOString(),
    actor: 'philip',
    from_value: e.from_value ?? null,
    to_value: e.to_value ?? null,
    lead_id: e.lead_id ?? null,
    detail: e.detail ?? null,
  });
  if (!error) return { ok: true };
  const reason = error.code === UNIQUE_VIOLATION ? 'refused' : 'failed';
  // Kept, because a console line is still worth having when nothing is watching
  // the return value. It is no longer the ONLY place this is reported.
  console.error(`project event not recorded (${e.event_type}, ${reason}): ${error.message}`);
  return { ok: false, reason, message: error.message };
}

function asText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return typeof v === 'string' ? v : JSON.stringify(v);
}

// The event a field edit corresponds to.
//
// Only name and stage map to an event, because only those two describe the
// project MOVING or being RE-IDENTIFIED. development_category and venue_type are
// attribute corrections - fixing a mislabel - and logging them would fill the
// timeline with bookkeeping that answers none of the questions the table exists
// for. They are still protected by manual_overrides exactly as before.
export function eventForFieldEdit(
  field: string,
  previous: unknown,
  next: unknown
): Omit<ManualEvent, 'project_id'> | null {
  if (field === 'name') {
    return { event_type: 'renamed', from_value: asText(previous), to_value: asText(next) };
  }
  if (field === 'stage') {
    return {
      event_type: 'stage_changed',
      from_value: asText(previous),
      to_value: asText(next),
      detail: { manual_override: true },
    };
  }
  return null;
}
