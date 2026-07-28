// THE TOMBSTONE AND OVERRIDE GUARD. Every scrape write goes through here.
//
// The rule: the scraper must respect Philip's decisions permanently, or every
// sweep he does is undone by the next run. Three protections, in order:
//
//   1. TOMBSTONE. A row whose status is 'dismissed' is never written again. Not
//      resurrected, not overwritten, not re-tagged. The URL is dead to the
//      scraper. Dismissal is a status, never a deletion, so the tombstone
//      survives in the table and keeps working forever.
//
//   2. OVERRIDES. A field listed in manual_overrides is never overwritten. The
//      classifier fills only what Philip has not corrected.
//
//   3. OWNED COLUMNS. status, notes, manual_overrides and status_changed_at are
//      Philip's, and no scrape path may write them at any time, on any row. They
//      are stripped from every payload before it reaches the database, so a new
//      write path cannot reintroduce the bug by forgetting.
//
// lifecycle is the scraper's own axis (active / expired / dead) and IS written
// here. That separation is the reason status can be protected absolutely.

import { supabaseAdmin } from '../../lib/supabase-admin';
import { logger } from './logger';

// Columns only Philip writes. Stripped from every scrape payload.
export const OWNED_BY_USER = ['status', 'notes', 'manual_overrides', 'status_changed_at'] as const;

export interface WriteReport {
  attempted: number;
  written: number;
  // Rows not written because the stored row is dismissed (the tombstone).
  skippedDismissed: number;
  // Rows where at least one field was held back by a manual override.
  rowsWithProtectedFields: number;
  // Per-field tally of values held back by an override.
  protectedFields: Record<string, number>;
  failed: number;
  // URLs skipped, for row-by-row logging.
  skippedUrls: string[];
}

export function emptyWriteReport(): WriteReport {
  return {
    attempted: 0,
    written: 0,
    skippedDismissed: 0,
    rowsWithProtectedFields: 0,
    protectedFields: {},
    failed: 0,
    skippedUrls: [],
  };
}

interface ExistingRow {
  url: string;
  status: string | null;
  manual_overrides: Record<string, unknown> | null;
}

// The stored status and overrides for a set of URLs, in chunks so the query
// string cannot overflow on a large run.
async function loadExisting(urls: string[]): Promise<Map<string, ExistingRow>> {
  const out = new Map<string, ExistingRow>();
  const CHUNK = 100;
  for (let i = 0; i < urls.length; i += CHUNK) {
    const slice = urls.slice(i, i + CHUNK);
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('url,status,manual_overrides')
      .in('url', slice);
    if (error) {
      console.warn(`write-guard: existing lookup failed (${error.message}); treating chunk as new.`);
      continue;
    }
    for (const r of (data ?? []) as ExistingRow[]) out.set(r.url, r);
  }
  return out;
}

// The field names a row's manual_overrides protects. Accepts both shapes the
// dashboard may store: a map keyed by field, and an array of entries.
export function overriddenFields(overrides: unknown): Set<string> {
  const out = new Set<string>();
  if (!overrides) return out;
  if (Array.isArray(overrides)) {
    for (const e of overrides) {
      const f = (e as { field?: unknown })?.field;
      if (typeof f === 'string') out.add(f);
    }
    return out;
  }
  if (typeof overrides === 'object') {
    for (const k of Object.keys(overrides as Record<string, unknown>)) out.add(k);
  }
  return out;
}

// Upsert scrape rows with all three protections applied. Rows must carry `url`.
export async function guardedUpsert(
  rows: Record<string, unknown>[],
  report: WriteReport = emptyWriteReport(),
  opts: { logSkips?: boolean } = {}
): Promise<WriteReport> {
  if (rows.length === 0) return report;
  report.attempted += rows.length;

  const urls = rows.map((r) => String(r.url)).filter(Boolean);
  const existing = await loadExisting(urls);

  for (const row of rows) {
    const url = String(row.url ?? '');
    const prior = existing.get(url);

    // 1. Tombstone.
    if (prior?.status === 'dismissed') {
      report.skippedDismissed++;
      if (report.skippedUrls.length < 200) report.skippedUrls.push(url);
      logger.debug({ event: 'write.tombstone', url }, 'skipped a dismissed row');
      if (opts.logSkips) console.log(`  tombstone: skipped dismissed row ${url}`);
      continue;
    }

    // 3. Owned columns are stripped from every payload, always.
    const payload: Record<string, unknown> = { ...row };
    for (const c of OWNED_BY_USER) delete payload[c];

    // 2. Overridden fields are held back.
    const overridden = overriddenFields(prior?.manual_overrides);
    let held = 0;
    for (const f of overridden) {
      if (f in payload) {
        delete payload[f];
        report.protectedFields[f] = (report.protectedFields[f] ?? 0) + 1;
        held++;
      }
    }
    if (held > 0) report.rowsWithProtectedFields++;

    const { error } = await supabaseAdmin.from('leads').upsert(payload, { onConflict: 'url' });
    if (error) {
      logger.error({ event: 'write.failed', url, err: error.message }, 'lead write failed');
      report.failed++;
      continue;
    }
    report.written++;
  }
  return report;
}

// One row, same protections. Returns whether it was written.
export async function guardedUpsertOne(
  row: Record<string, unknown>,
  report?: WriteReport
): Promise<boolean> {
  const r = await guardedUpsert([row], report ?? emptyWriteReport());
  return r.written > 0;
}

export function printWriteReport(label: string, r: WriteReport): void {
  console.log(
    `${label}: ${r.written} written of ${r.attempted} attempted | ` +
      `${r.skippedDismissed} skipped as dismissed (tombstone) | ` +
      `${r.rowsWithProtectedFields} rows had a field held back by a manual override` +
      (r.failed ? ` | ${r.failed} write failures` : '')
  );
  const fields = Object.entries(r.protectedFields);
  if (fields.length) {
    console.log(`  fields protected by override: ${fields.map(([f, n]) => `${f} x${n}`).join(', ')}`);
  }
  for (const u of r.skippedUrls.slice(0, 20)) console.log(`  tombstoned, not written: ${u}`);
}
