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
import { captureWriteFailure } from './sentry';

// Columns only Philip writes. Stripped from every scrape payload.
export const OWNED_BY_USER = ['status', 'notes', 'manual_overrides', 'status_changed_at'] as const;

// ENRICHMENT COLUMNS: absence of information must never erase information.
//
// These are filled by a step that can legitimately not run: attachment depth is
// skipped when LEGISTAR_ATTACHMENTS=0, a PDF fetch times out, a document has no
// contact block. When that happens the row builder still produces the key, with
// null, and an upsert writes that null straight over a value an earlier run had
// found.
//
// It is not hypothetical. Verifying an unrelated change with
// LEGISTAR_ATTACHMENTS=0 erased the document-sourced contacts on 12 Legistar
// rows: representative fell from 30 rows to 18 and primary_document_url from 38
// to 22, including Nancy Amundsen on the Heart Hotel tentative map. Nothing
// complained, because writing null is a successful write.
//
// So a null for one of these is treated as "this run learned nothing", and the
// key is dropped from the payload. Supabase upserts only the columns present, so
// the stored value survives untouched.
export const ENRICHMENT_FIELDS = [
  'presented_by',
  'applicant',
  'representative',
  'action_sought',
  'primary_document_url',
  'contact_name',
  'contact_email',
  'contact_phone',
] as const;

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
  // Enrichment values a run did not have, which were held back rather than
  // written as null over a value an earlier run found.
  erasuresPrevented: number;
  // URLs skipped, for row-by-row logging.
  skippedUrls: string[];
  // URLs actually written. The project attach pass needs to know which records
  // THIS run landed, to report where they ended up; counting `written` cannot
  // answer that.
  writtenUrls: string[];
}

export function emptyWriteReport(): WriteReport {
  return {
    attempted: 0,
    written: 0,
    skippedDismissed: 0,
    rowsWithProtectedFields: 0,
    protectedFields: {},
    failed: 0,
    erasuresPrevented: 0,
    skippedUrls: [],
    writtenUrls: [],
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

    // 4. A null enrichment value means this run learned nothing, not that the
    // previous run was wrong. Drop the key so the stored value survives.
    let erasuresPrevented = 0;
    for (const c of ENRICHMENT_FIELDS) {
      if (c in payload && (payload[c] === null || payload[c] === undefined)) {
        delete payload[c];
        erasuresPrevented++;
      }
    }
    // has_primary_document only means anything alongside a URL.
    if (!('primary_document_url' in payload) && payload.has_primary_document === false) {
      delete payload.has_primary_document;
    }
    if (erasuresPrevented > 0) report.erasuresPrevented += erasuresPrevented;

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
      captureWriteFailure(url, error.message);
      report.failed++;
      continue;
    }
    report.written++;
    report.writtenUrls.push(url);
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
      (r.erasuresPrevented ? ` | ${r.erasuresPrevented} enrichment values held back rather than nulled` : '') +
      (r.failed ? ` | ${r.failed} write failures` : '')
  );
  const fields = Object.entries(r.protectedFields);
  if (fields.length) {
    console.log(`  fields protected by override: ${fields.map(([f, n]) => `${f} x${n}`).join(', ')}`);
  }
  for (const u of r.skippedUrls.slice(0, 20)) console.log(`  tombstoned, not written: ${u}`);
}
