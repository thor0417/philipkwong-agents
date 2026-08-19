// MANUAL CONTROL OVER PROJECTS. Every write Philip makes from the register goes
// through here.
//
// Four columns are his, and no clustering path may touch them (enforced on the
// other side by agents/scraper/project-write.ts):
//   status, notes, watch, manual_overrides
//
// A rename or a hand-set stage is additionally recorded in manual_overrides, and
// THAT is what makes it permanent: the clusterer reads the overrides and refuses
// to recompute those fields. Without the record, the next run would quietly undo
// the correction and the register would drift back to whatever the rules said.

import { supabase } from './supabase';
import { recordManualEvent, eventForFieldEdit, type EventWriteResult } from './project-events';

// A REFUSED OR FAILED EVENT DOES NOT FAIL THE EDIT, AND IS NOT SWALLOWED EITHER.
//
// By the time an event is written the column write has already succeeded, so
// throwing would report a failed edit over a change that landed. Returning the
// result lets the mutation layer say "the change is saved, the audit trail did
// not take it" - which is the sentence nobody could say for three months.
//
// null means no event applies to this edit, which is different from one that
// was attempted and refused.
export type EditResult = EventWriteResult | null;

export interface ProjectOverrideEntry {
  field: string;
  previous: unknown;
  next: unknown;
  at: string;
}

// Fields a hand correction can pin. Each becomes a manual_overrides entry.
export const PROJECT_EDITABLE_FIELDS = [
  'name',
  'stage',
  'development_category',
  'venue_type',
  // A pinned score. Mirrors PROJECT_OVERRIDABLE on the scraper side, which is
  // what actually makes the clusterer and the backfill leave it alone.
  'significance',
] as const;
export type ProjectEditableField = (typeof PROJECT_EDITABLE_FIELDS)[number];

// Write a field AND record the override, merging with any override already on
// the project so an earlier correction is not lost.
export async function applyProjectEdit(
  id: string,
  field: ProjectEditableField,
  next: unknown
): Promise<EditResult> {
  const { data, error } = await supabase
    .from('projects')
    .select(`id, manual_overrides, ${field}`)
    .eq('id', id)
    .single();
  if (error) throw new Error(`project edit lookup failed: ${error.message}`);

  const row = data as unknown as Record<string, unknown>;
  const previous = row[field] ?? null;
  if (previous === next) return null;

  const existing = (row.manual_overrides as Record<string, ProjectOverrideEntry> | null) ?? {};
  const overrides: Record<string, ProjectOverrideEntry> = {
    ...existing,
    [field]: { field, previous, next, at: new Date().toISOString() },
  };

  const { error: upErr } = await supabase
    .from('projects')
    .update({ [field]: next, manual_overrides: overrides })
    .eq('id', id);
  if (upErr) throw new Error(`project edit failed: ${upErr.message}`);

  // Recorded AFTER the write succeeds. An event says a thing happened, so
  // emitting before the update would leave a permanent record of a change that
  // may not have landed.
  const ev = eventForFieldEdit(field, previous, next);
  return ev ? await recordManualEvent({ ...ev, project_id: id }) : null;
}

// A HAND-NAME SAYS SO. name_source answers which rule produced the name, and
// after a rename every automatic answer is false - the column went on reporting
// whichever rule the correction REPLACED. 'manual' is not a rule, it is Philip,
// and it is the one value no clustering run may write; project-write holds the
// column back for exactly as long as the override stands.
//
// It is also the value that makes the rename WORTH making: isProvisionalName is
// false for 'manual', so a project renamed off a provisional title becomes
// printable, which is why one is renamed at all.
export async function renameProject(id: string, name: string): Promise<EditResult> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('A project name cannot be empty.');
  const ev = await applyProjectEdit(id, 'name', trimmed);
  const { error } = await supabase
    .from('projects')
    .update({ name_source: 'manual' })
    .eq('id', id);
  if (error) throw new Error(`name source update failed: ${error.message}`);
  return ev;
}

// PIN A SCORE. Philip's judgement about what matters is the thing the model is
// trying to approximate, so where he has stated it the model does not get a
// second opinion: applyProjectEdit records 'significance' in manual_overrides,
// and both the clusterer and the backfill skip a project carrying it, on every
// future run and after any weight change.
export async function pinProjectSignificance(id: string, value: number): Promise<void> {
  const n = Math.max(0, Math.min(100, Math.round(value)));
  await applyProjectEdit(id, 'significance', n);
  // The breakdown would describe a computation that no longer produced this
  // number, so it is replaced by a statement of where the number came from.
  const { error } = await supabase
    .from('projects')
    .update({
      significance_detail: { pinned: { points: n, of: 100, why: 'pinned by hand; the model is not consulted' } },
      significance_computed_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw new Error(`pin detail update failed: ${error.message}`);
}

export async function setProjectStage(id: string, stage: string): Promise<EditResult> {
  return applyProjectEdit(id, 'stage', stage);
}

// watch and notes are Philip's outright and carry no override bookkeeping: the
// clusterer never writes them at all, so there is nothing to protect them from.
export async function setProjectWatch(id: string, watch: boolean): Promise<EditResult> {
  const { error } = await supabase.from('projects').update({ watch }).eq('id', id);
  if (error) throw new Error(`watch update failed: ${error.message}`);
  return recordManualEvent({
    project_id: id,
    event_type: watch ? 'watch_added' : 'watch_removed',
    to_value: String(watch),
  });
}

// STATUS. Philip's triage axis, and the only writer for it.
//
// The projects table has carried a status column since the register was built
// and every read path filters on it (the views, the counts, Trash), but nothing
// ever wrote it: triage existed on records only. This is that missing writer.
//
// Like watch and notes, status carries no override bookkeeping. The clusterer
// never writes it, so there is nothing to protect it from, and marking a
// project dismissed is a filter change rather than a claim about the world.
//
// NOTHING IS DELETED. Trash is a view over status = 'dismissed', so restoring is
// this same call with a different value.
export type ProjectStatus = 'new' | 'watchlist' | 'client_ready' | 'dismissed';

export async function setProjectStatus(id: string, status: ProjectStatus): Promise<EditResult> {
  const { error } = await supabase.from('projects').update({ status }).eq('id', id);
  if (error) throw new Error(`project status update failed: ${error.message}`);
  return recordManualEvent({
    project_id: id,
    event_type: 'status_changed',
    to_value: status,
  });
}

export async function setProjectNotes(id: string, notes: string): Promise<EditResult> {
  const { error } = await supabase
    .from('projects')
    .update({ notes: notes.trim() ? notes : null })
    .eq('id', id);
  if (error) throw new Error(`project note save failed: ${error.message}`);
  // The note's TEXT is not copied into the event. The note lives on the project
  // and can be edited; a copy here could not be, and the log would slowly fill
  // with stale versions of something the reader can simply go and read.
  return recordManualEvent({
    project_id: id,
    event_type: 'note_added',
    detail: { length: notes.trim().length },
  });
}

// DETACH. The record returns to the Inbox. It is not deleted, and it is not
// hidden.
//
// cluster_reason is set to 'detached' rather than cleared, and that is the whole
// point: the clusterer treats 'detached' the way it treats a dismissal, so the
// next run cannot quietly re-attach the record by the same rule Philip just
// overruled. A cleared reason would let it come straight back.
export async function detachRecord(leadId: string, projectId: string): Promise<EditResult> {
  const { error } = await supabase
    .from('leads')
    .update({ project_id: null, cluster_reason: 'detached' })
    .eq('id', leadId);
  if (error) throw new Error(`detach failed: ${error.message}`);
  const ev = await recordManualEvent({
    project_id: projectId,
    event_type: 'record_detached',
    lead_id: leadId,
    detail: { by_hand: true },
  });
  await refreshRecordCount(projectId);
  return ev;
}

// ATTACH BY HAND, from the Inbox. cluster_reason 'manual' is Philip's decision
// and the clusterer never recomputes it.
export async function attachRecord(leadId: string, projectId: string): Promise<EditResult> {
  const { error } = await supabase
    .from('leads')
    .update({ project_id: projectId, cluster_reason: 'manual' })
    .eq('id', leadId);
  if (error) throw new Error(`attach failed: ${error.message}`);
  const ev = await recordManualEvent({
    project_id: projectId,
    event_type: 'record_attached',
    lead_id: leadId,
    to_value: 'manual',
    detail: { by_hand: true },
  });
  await refreshRecordCount(projectId);
  return ev;
}

// Keep record_count honest immediately after a manual attach or detach, rather
// than waiting for the next scrape to reconcile it. A counter that is only right
// once a day is a counter nobody trusts.
async function refreshRecordCount(projectId: string): Promise<void> {
  const { count, error } = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId);
  if (error) return;
  await supabase.from('projects').update({ record_count: count ?? 0 }).eq('id', projectId);
}

export function projectOverriddenFields(overrides: unknown): string[] {
  if (!overrides || typeof overrides !== 'object') return [];
  return Object.keys(overrides as Record<string, unknown>);
}
