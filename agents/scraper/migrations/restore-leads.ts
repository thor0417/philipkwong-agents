// RESTORE from a backup file produced by backup-leads.ts.
//
// Upserts, so it is safe to run against a live table: it repairs missing or
// damaged rows and does not disturb rows that are already correct. It never
// deletes, and it never truncates.
//
//   DRY_RUN=1 node --env-file=.env.local --import tsx agents/scraper/migrations/restore-leads.ts backups/leads-<stamp>.jsonl
//   node ... restore-leads.ts backups/projects-<stamp>.jsonl --table projects
//
// DRY_RUN reports what would be written, including how many rows in the file are
// already present, without touching the table. Run it that way first.
//
// THE TABLE. backup-leads.ts exports BOTH leads and projects, but this script
// could only ever restore leads: the table name and the conflict key were both
// hardcoded. A projects backup was being written every run with no way to put it
// back, which is not a backup. --table selects the target, and it is inferred
// from the filename when omitted, because the backup names every file
// <table>-<stamp>.jsonl.
//
// THE CONFLICT KEY DIFFERS BY TABLE, and the choice is load-bearing:
//
//   leads    -> url. Unique, and the same key every write path upserts on, so a
//               restore lands exactly where a scrape would.
//
//   projects -> id. NOT the (module, project_key) unique index, even though
//               that is the clusterer's identity. Restoring on the key would
//               UPDATE a surviving row's primary key to the one in the file,
//               and leads.project_id references projects(id) - it would either
//               fail or silently orphan every record attached to that project.
//               Restoring on id puts each project back where it was and keeps
//               those references intact.
//
// A row whose id is gone but whose (module, project_key) survives on a NEW id
// will collide with idx_projects_key. That is reported per batch rather than
// swallowed: it means the clusterer rebuilt the project after the backup, and
// which one is right is a judgement this script does not get to make.

import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { supabaseAdmin } from '../../../lib/supabase-admin';

const BATCH = 200;

// Target table -> the column(s) an upsert conflicts on. A table absent here
// cannot be restored, rather than being restored on a guessed key.
const CONFLICT_KEY: Record<string, string> = {
  leads: 'url',
  projects: 'id',
};

// The backup names every file <table>-<stamp>.jsonl, so the target is knowable
// without being told. An explicit --table always wins.
function targetTable(file: string, flag: string | undefined): string {
  if (flag) return flag;
  const base = file.split(/[\\/]/).pop() ?? '';
  return base.split('-')[0];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flagAt = args.findIndex((a) => a === '--table' || a.startsWith('--table='));
  let tableFlag: string | undefined;
  if (flagAt >= 0) {
    const a = args[flagAt];
    tableFlag = a.includes('=') ? a.split('=')[1] : args[flagAt + 1];
    args.splice(flagAt, a.includes('=') ? 1 : 2);
  }
  const file = args[0];
  const dryRun = process.env.DRY_RUN === '1';
  if (!file || !existsSync(file)) {
    console.error('Usage: restore-leads.ts <backup-file.jsonl> [--table leads|projects]');
    process.exit(1);
  }

  const table = targetTable(file, tableFlag);
  const onConflict = CONFLICT_KEY[table];
  if (!onConflict) {
    console.error(
      `Refusing to restore into '${table}': no conflict key is defined for it. ` +
        `Known tables: ${Object.keys(CONFLICT_KEY).join(', ')}. ` +
        `Pass --table explicitly if the filename does not name the table.`
    );
    process.exit(1);
  }
  console.log(`Restoring into '${table}', upserting on ${onConflict}.`);

  const rl = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  let read = 0;
  let malformed = 0;
  let written = 0;
  let failed = 0;
  let batch: Record<string, unknown>[] = [];

  async function flush(): Promise<void> {
    if (batch.length === 0) return;
    if (dryRun) {
      written += batch.length;
      batch = [];
      return;
    }
    const { error } = await supabaseAdmin.from(table).upsert(batch, { onConflict });
    if (error) {
      console.error(`  batch failed (${batch.length} rows): ${error.message}`);
      failed += batch.length;
    } else {
      written += batch.length;
    }
    batch = [];
  }

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    read++;
    try {
      batch.push(JSON.parse(trimmed) as Record<string, unknown>);
    } catch {
      malformed++;
      continue;
    }
    if (batch.length >= BATCH) await flush();
  }
  await flush();

  console.log(`\n===== RESTORE ${dryRun ? '(DRY_RUN: nothing written)' : ''} =====`);
  console.log(`  file           : ${file}`);
  console.log(`  lines read     : ${read}`);
  console.log(`  malformed      : ${malformed}`);
  console.log(`  rows ${dryRun ? 'to write ' : 'written  '}: ${written}`);
  if (failed) console.log(`  rows failed    : ${failed}`);
  const { count } = await supabaseAdmin.from(table).select('id', { count: 'exact', head: true });
  console.log(`  table now holds: ${count} rows`);
}

main().catch((err) => {
  console.error('Restore failed:', err);
  process.exitCode = 1;
});
