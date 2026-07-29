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
] as const;
export type ProjectEditableField = (typeof PROJECT_EDITABLE_FIELDS)[number];

// Write a field AND record the override, merging with any override already on
// the project so an earlier correction is not lost.
export async function applyProjectEdit(
  id: string,
  field: ProjectEditableField,
  next: unknown
): Promise<void> {
  const { data, error } = await supabase
    .from('projects')
    .select(`id, manual_overrides, ${field}`)
    .eq('id', id)
    .single();
  if (error) throw new Error(`project edit lookup failed: ${error.message}`);

  const row = data as unknown as Record<string, unknown>;
  const previous = row[field] ?? null;
  if (previous === next) return;

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
}

export async function renameProject(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('A project name cannot be empty.');
  await applyProjectEdit(id, 'name', trimmed);
}

export async function setProjectStage(id: string, stage: string): Promise<void> {
  await applyProjectEdit(id, 'stage', stage);
}

// watch and notes are Philip's outright and carry no override bookkeeping: the
// clusterer never writes them at all, so there is nothing to protect them from.
export async function setProjectWatch(id: string, watch: boolean): Promise<void> {
  const { error } = await supabase.from('projects').update({ watch }).eq('id', id);
  if (error) throw new Error(`watch update failed: ${error.message}`);
}

export async function setProjectNotes(id: string, notes: string): Promise<void> {
  const { error } = await supabase
    .from('projects')
    .update({ notes: notes.trim() ? notes : null })
    .eq('id', id);
  if (error) throw new Error(`project note save failed: ${error.message}`);
}

// DETACH. The record returns to the Inbox. It is not deleted, and it is not
// hidden.
//
// cluster_reason is set to 'detached' rather than cleared, and that is the whole
// point: the clusterer treats 'detached' the way it treats a dismissal, so the
// next run cannot quietly re-attach the record by the same rule Philip just
// overruled. A cleared reason would let it come straight back.
export async function detachRecord(leadId: string, projectId: string): Promise<void> {
  const { error } = await supabase
    .from('leads')
    .update({ project_id: null, cluster_reason: 'detached' })
    .eq('id', leadId);
  if (error) throw new Error(`detach failed: ${error.message}`);
  await refreshRecordCount(projectId);
}

// ATTACH BY HAND, from the Inbox. cluster_reason 'manual' is Philip's decision
// and the clusterer never recomputes it.
export async function attachRecord(leadId: string, projectId: string): Promise<void> {
  const { error } = await supabase
    .from('leads')
    .update({ project_id: projectId, cluster_reason: 'manual' })
    .eq('id', leadId);
  if (error) throw new Error(`attach failed: ${error.message}`);
  await refreshRecordCount(projectId);
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
