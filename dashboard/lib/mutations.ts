// MANUAL CONTROL. Every write Philip makes from the dashboard goes through here.
//
// Two columns are his and no scrape path may touch them (enforced on the other
// side by agents/scraper/write-guard):
//   status           new | watchlist | client_ready | dismissed
//   manual_overrides a record of every field he has corrected by hand
//
// Every correction is recorded in manual_overrides as field, previous value, new
// value, and timestamp. That record is both the protection mechanism (the
// scraper reads it and refuses to overwrite those fields) and, later, the
// training signal for measuring where the classifiers are wrong.

import { supabase } from './supabase';

export const STATUS_VALUES = ['new', 'watchlist', 'client_ready', 'dismissed'] as const;
export type LeadStatus = (typeof STATUS_VALUES)[number];

export const STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  watchlist: 'Watchlist',
  client_ready: 'Client Ready',
  dismissed: 'Dismissed',
};

// Fields Philip can correct by hand from the detail panel. Each one becomes a
// manual_overrides entry when changed, which permanently protects it.
export const EDITABLE_FIELDS = [
  'title',
  'stream',
  'development_category',
  'venue_type',
  'market',
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

export interface OverrideEntry {
  field: string;
  previous: unknown;
  next: unknown;
  at: string;
}

// Set status on one or many rows. status_changed_at is stamped on every write so
// the triage history is legible.
export async function setStatus(ids: string[], status: LeadStatus): Promise<number> {
  if (ids.length === 0) return 0;
  const { error, count } = await supabase
    .from('leads')
    .update({ status, status_changed_at: new Date().toISOString() }, { count: 'exact' })
    .in('id', ids);
  if (error) throw new Error(`status update failed: ${error.message}`);
  return count ?? ids.length;
}

// Restore returns a dismissed row to the working set at 'new', which is what
// Trash's Restore does. Nothing was deleted, so nothing has to be recreated.
export async function restore(ids: string[]): Promise<number> {
  return setStatus(ids, 'new');
}

// Apply a hand correction: write the new value AND record the override, merging
// with any overrides already on the row so an earlier correction is not lost.
export async function applyEdit(
  id: string,
  field: EditableField,
  next: unknown
): Promise<void> {
  const { data, error } = await supabase
    .from('leads')
    .select(`id, manual_overrides, ${field}`)
    .eq('id', id)
    .single();
  if (error) throw new Error(`edit lookup failed: ${error.message}`);

  const row = data as unknown as Record<string, unknown>;
  const previous = row[field] ?? null;
  if (previous === next) return;

  const existing = (row.manual_overrides as Record<string, OverrideEntry> | null) ?? {};
  const overrides: Record<string, OverrideEntry> = {
    ...existing,
    [field]: { field, previous, next, at: new Date().toISOString() },
  };

  const { error: upErr } = await supabase
    .from('leads')
    .update({ [field]: next, manual_overrides: overrides })
    .eq('id', id);
  if (upErr) throw new Error(`edit failed: ${upErr.message}`);
}

// A free-text note per record. Notes are Philip's and the scraper never writes
// them, so this is a plain update with no override bookkeeping.
export async function setNotes(id: string, notes: string): Promise<void> {
  const { error } = await supabase
    .from('leads')
    .update({ notes: notes.trim() ? notes : null })
    .eq('id', id);
  if (error) throw new Error(`note save failed: ${error.message}`);
}

// Which fields on a row carry a hand correction, for the panel's markers.
export function overriddenFieldNames(overrides: unknown): string[] {
  if (!overrides || typeof overrides !== 'object') return [];
  return Object.keys(overrides as Record<string, unknown>);
}
