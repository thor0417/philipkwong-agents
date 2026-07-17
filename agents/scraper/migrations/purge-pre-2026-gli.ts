// Hard GLI date cutoff purge (current-year only).
//
// DELETES (not archives) every GLI lead (module 'gli', all streams) whose
// best-available date is before 2026-01-01, using the SAME classification as the
// capture gate (classifyGliByCutoff): a source date wins, else a date parsed from
// the lead's own title/body, else UNKNOWN. Genuinely undated leads are NEVER
// assumed old -- they are held (not deleted, not modified) and reported separately
// for manual review.
//
// Safety: before any delete, the full to-be-deleted set (id, stream, title, date,
// url) is written to a JSON backup in the scratchpad. DRY_RUN=1 reports without
// deleting. Run (no migration needed -- computes from existing columns):
//   DRY_RUN=1 node --env-file=.env.local --import tsx agents/scraper/migrations/purge-pre-2026-gli.ts
//   node --env-file=.env.local --import tsx agents/scraper/migrations/purge-pre-2026-gli.ts

import { writeFileSync } from 'node:fs';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { classifyGliByCutoff, type LeadStream } from '../lead-date';
import type { NormalizedLead } from '../sources/types';

interface Row {
  id: string;
  stream: string | null;
  title: string | null;
  raw_content: string | null;
  deadline: string | null;
  published_date: string | null;
  url: string | null;
  venue_type: string | null;
}

const BACKUP_PATH =
  (process.env.PURGE_BACKUP_DIR ?? '.') + '/gli-pre2026-deleted-backup.json';

const streamOf = (s: string | null): LeadStream =>
  s === 'government' || s === 'intelligence' ? s : 'opportunity';

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === '1';
  const { data, error } = await supabaseAdmin
    .from('leads')
    .select('id, stream, title, raw_content, deadline, published_date, url, venue_type')
    .eq('module', 'gli');
  if (error) {
    console.error('Fetch failed:', error.message);
    process.exit(1);
  }
  const rows = (data ?? []) as Row[];

  // stream label used in the report (keeps null distinct from the classifier default).
  const label = (s: string | null): string => s ?? 'null';
  const perStream: Record<string, { total: number; current: number; deleted: number; unknown: number }> = {};
  const ensure = (s: string): void => {
    perStream[s] ??= { total: 0, current: 0, deleted: 0, unknown: 0 };
  };

  const toDelete: Array<{ id: string; stream: string | null; title: string | null; date: string | null; url: string | null }> = [];
  const unknown: Row[] = [];
  let current = 0;

  for (const r of rows) {
    const lead: NormalizedLead = {
      title: r.title ?? '',
      raw_content: r.raw_content ?? '',
      url: r.url ?? '',
      company: null,
      location: null,
      deadline: r.deadline,
      published_date: r.published_date,
      value_estimate: null,
      source: '',
    };
    const { verdict, date } = classifyGliByCutoff(lead, streamOf(r.stream));
    const s = label(r.stream);
    ensure(s);
    perStream[s].total++;
    if (verdict === 'pre-cutoff') {
      perStream[s].deleted++;
      toDelete.push({ id: r.id, stream: r.stream, title: r.title, date, url: r.url });
    } else if (verdict === 'unknown') {
      perStream[s].unknown++;
      unknown.push(r);
    } else {
      perStream[s].current++;
      current++;
    }
  }

  // Feb-2013 style sanity check: any lead whose title/body mentions 2011-2025.
  const oldYear = /\b(201[1-9]|202[0-5])\b/;
  const survivingWithOldYear = rows.filter((r) => {
    const { verdict } = classifyGliByCutoff(
      {
        title: r.title ?? '', raw_content: r.raw_content ?? '', url: r.url ?? '', company: null,
        location: null, deadline: r.deadline, published_date: r.published_date, value_estimate: null, source: '',
      } as NormalizedLead,
      streamOf(r.stream)
    );
    return verdict === 'current' && oldYear.test(`${r.title ?? ''} ${r.raw_content ?? ''}`);
  });

  // ---- report ----
  console.log('\n===== GLI HARD CUTOFF PURGE (delete pre-2026) =====' + (dryRun ? '  (DRY_RUN: no deletes)' : ''));
  console.log(`Total GLI leads before:        ${rows.length}`);
  console.log(`Deleted as pre-2026:           ${toDelete.length}`);
  console.log(`Genuine 2026+ leads remaining: ${current}`);
  console.log(`DATE UNKNOWN (held for review): ${unknown.length}`);
  console.log('\nPer stream (total | current-kept | deleted | date-unknown-held):');
  for (const s of Object.keys(perStream).sort()) {
    const v = perStream[s];
    console.log(`  ${s.padEnd(13)} ${v.total} | ${v.current} | ${v.deleted} | ${v.unknown}`);
  }

  console.log('\nSample of deleted (pre-2026) leads [date | title]:');
  for (const d of toDelete.slice(0, 15)) {
    console.log(`  - ${(d.date ?? '????').slice(0, 10)} | ${(d.title ?? '').slice(0, 70)}`);
  }
  const deleted2013 = toDelete.filter((d) => (d.date ?? '').startsWith('2013'));
  console.log(`\nDeleted leads dated 2013: ${deleted2013.length}` + (deleted2013.length ? ` (e.g. "${(deleted2013[0].title ?? '').slice(0, 60)}")` : ''));
  console.log(`Kept "current" leads still mentioning a 2011-2025 year in text: ${survivingWithOldYear.length} (expected: forward-looking/plan titles or fresh source-dated articles)`);
  for (const r of survivingWithOldYear.slice(0, 10)) console.log(`  ~ ${(r.title ?? '').slice(0, 72)}`);

  console.log('\nDATE UNKNOWN leads held for review (up to 25 of ' + unknown.length + '):');
  for (const r of unknown.slice(0, 25)) console.log(`  ? [${label(r.stream)}] ${(r.title ?? '').slice(0, 72)}`);

  // ---- backup + delete ----
  if (toDelete.length === 0) {
    console.log('\nNothing to delete.');
    console.log('===================================================\n');
    return;
  }
  try {
    writeFileSync(BACKUP_PATH, JSON.stringify(toDelete, null, 2));
    console.log(`\nBackup of ${toDelete.length} to-be-deleted rows written to ${BACKUP_PATH}`);
  } catch (e) {
    console.error(`Backup write failed (${String(e).slice(0, 80)}).`);
    if (!dryRun) {
      console.error('Refusing to delete without a backup. Aborting.');
      process.exit(1);
    }
  }

  if (dryRun) {
    console.log('DRY_RUN: no rows deleted.');
    console.log('===================================================\n');
    return;
  }

  const ids = toDelete.map((d) => d.id);
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const { error: delErr } = await supabaseAdmin.from('leads').delete().in('id', batch);
    if (delErr) {
      console.error(`Delete batch ${i / 100} failed: ${delErr.message}`);
      continue;
    }
    deleted += batch.length;
  }
  console.log(`\nDeleted ${deleted} pre-2026 GLI leads.`);
  console.log('===================================================\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
