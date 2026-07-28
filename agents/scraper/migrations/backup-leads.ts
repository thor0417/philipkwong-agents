// DATABASE BACKUP. Exports the leads table (and the projects table once it
// exists) to a timestamped JSON Lines file.
//
// WHY JSON LINES. One row per line, so a 20,000-row export streams rather than
// building one enormous JSON document, a truncated file loses only its last line
// rather than parsing as nothing, and the file greps.
//
// The export is a full-fidelity copy: every column, no transformation, no
// filtering. Dismissed rows are included, because dismissal is a status and the
// row still exists; a backup that dropped them would silently discard the
// tombstones that stop the scraper resurrecting them.
//
//   node --env-file=.env.local --import tsx agents/scraper/migrations/backup-leads.ts
//   BACKUP_DIR=/some/path node ... (default ./backups)
//
// RESTORE: see the procedure printed at the end of a run, and BACKUP.md.

import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { supabaseAdmin } from '../../../lib/supabase-admin';

const PAGE = 1000;

interface TableResult {
  table: string;
  rows: number;
  file: string;
  bytes: number;
  skipped?: string;
}

// Stamp a filename with an ISO instant, colons removed so it is a legal filename
// on every platform: leads-2026-07-28T04-15-33-102Z.jsonl
function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function exportTable(table: string, dir: string, at: string): Promise<TableResult> {
  const file = `${dir}/${table}-${at}.jsonl`;

  // A table that does not exist yet (projects, before the clustering phase) is
  // reported and skipped rather than failing the backup. A head-only count does
  // NOT reliably surface a missing table (PostgREST answers it without touching
  // the relation), so the first real read is what proves the table is there.
  const probe = await supabaseAdmin.from(table).select('id').limit(1);
  if (probe.error) {
    return { table, rows: 0, file, bytes: 0, skipped: probe.error.message };
  }
  const { count, error: countErr } = await supabaseAdmin
    .from(table)
    .select('id', { count: 'exact', head: true });
  if (countErr) {
    return { table, rows: 0, file, bytes: 0, skipped: countErr.message };
  }
  const expected = count ?? 0;

  const out = createWriteStream(file, { encoding: 'utf8' });
  let written = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select('*')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: export failed at offset ${from}: ${error.message}`);
    if (!data?.length) break;
    for (const row of data) {
      out.write(`${JSON.stringify(row)}\n`);
      written++;
    }
    if (data.length < PAGE) break;
  }
  await new Promise<void>((resolve, reject) => {
    out.on('error', reject);
    out.end(resolve);
  });

  if (written !== expected) {
    throw new Error(
      `${table}: exported ${written} rows but the table reports ${expected}. Backup NOT trustworthy.`
    );
  }
  return { table, rows: written, file, bytes: statSync(file).size };
}

async function main(): Promise<void> {
  const dir = process.env.BACKUP_DIR ?? 'backups';
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const at = stamp();

  console.log(`Backup starting. Directory: ${dir}`);
  const results: TableResult[] = [];
  for (const table of ['leads', 'projects']) {
    results.push(await exportTable(table, dir, at));
  }

  console.log('\n===== BACKUP =====');
  for (const r of results) {
    if (r.skipped) {
      console.log(`  ${r.table.padEnd(10)} skipped: ${r.skipped.slice(0, 70)}`);
      continue;
    }
    console.log(
      `  ${r.table.padEnd(10)} ${String(r.rows).padStart(6)} rows  ${String(Math.round(r.bytes / 1024)).padStart(6)} KB  ${r.file}`
    );
  }

  // Verification is part of the backup, not a separate step: the row count in
  // the file is compared with the row count in the table, and a mismatch throws
  // above rather than leaving a plausible-looking file behind.
  console.log('\n  Row counts verified against the live table for every exported table.');
  console.log('\n===== RESTORE =====');
  console.log('  See BACKUP.md. In short:');
  console.log('    node --env-file=.env.local --import tsx agents/scraper/migrations/restore-leads.ts <file>');
  console.log('  The restore upserts on url, so it is safe to run against a live table:');
  console.log('  it repairs missing or damaged rows and leaves newer ones alone.');
}

main().catch((err) => {
  console.error('Backup failed:', err);
  process.exitCode = 1;
});
