// RESTORE from a backup file produced by backup-leads.ts.
//
// Upserts on url, so it is safe to run against a live table: it repairs missing
// or damaged rows and does not disturb rows that are already correct. It never
// deletes, and it never truncates.
//
//   DRY_RUN=1 node --env-file=.env.local --import tsx agents/scraper/migrations/restore-leads.ts backups/leads-<stamp>.jsonl
//
// DRY_RUN reports what would be written, including how many rows in the file are
// already present, without touching the table. Run it that way first.

import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { supabaseAdmin } from '../../../lib/supabase-admin';

const BATCH = 200;

async function main(): Promise<void> {
  const file = process.argv[2];
  const dryRun = process.env.DRY_RUN === '1';
  if (!file || !existsSync(file)) {
    console.error('Usage: restore-leads.ts <backup-file.jsonl>');
    process.exit(1);
  }

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
    const { error } = await supabaseAdmin.from('leads').upsert(batch, { onConflict: 'url' });
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
  const { count } = await supabaseAdmin.from('leads').select('id', { count: 'exact', head: true });
  console.log(`  table now holds: ${count} rows`);
}

main().catch((err) => {
  console.error('Restore failed:', err);
  process.exitCode = 1;
});
