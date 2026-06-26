// Supabase migration runner for the scraper engine.
// Adds the new lead columns + indexes. Idempotent.
//
// Run: npx tsx agents/scraper/migrations/run-migration.ts
//
// This is self-contained: it loads .env.local itself and builds its own
// service-role client, so it does not need node --env-file. The service role
// key talks to PostgREST, which cannot run DDL on its own, so the actual
// ALTER/CREATE statements go through an exec_sql(sql text) helper function in
// the database. If that helper is absent the script reports the exact SQL to
// paste into the Supabase SQL editor instead of failing silently.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const here = dirname(fileURLToPath(import.meta.url));

// Minimal .env.local loader. Does not depend on a particular Node minor version
// (process.loadEnvFile landed mid-20.x) and never overrides an already-set var.
function loadEnv(path: string): void {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnv(join(process.cwd(), '.env.local'));

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

const NEW_COLUMNS = [
  'industry',
  'module',
  'company',
  'contact_email',
  'deadline',
  'value_estimate',
  'location',
  'website_status',
];

// A select of an unknown column returns a PostgREST 42703 error, so a clean
// select of all new columns means the migration has already been applied.
async function allColumnsExist(): Promise<boolean> {
  const { error } = await supabase.from('leads').select(NEW_COLUMNS.join(',')).limit(1);
  return !error;
}

async function report(): Promise<void> {
  console.log('Column check on leads:');
  for (const col of NEW_COLUMNS) {
    const { error } = await supabase.from('leads').select(col).limit(1);
    console.log(`  ${error ? 'MISSING' : 'ok     '}  ${col}`);
  }
}

async function main(): Promise<void> {
  if (await allColumnsExist()) {
    console.log('All scraper columns already present on leads; nothing to migrate.');
    await report();
    return;
  }

  const sqlPath = join(here, '001_add_scraper_columns.sql');
  const sql = readFileSync(sqlPath, 'utf8');
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'));

  console.log(`Applying ${statements.length} migration statements via exec_sql RPC...`);
  for (const stmt of statements) {
    const { error } = await supabase.rpc('exec_sql', { sql: stmt });
    if (error) {
      console.error('\nMigration could not be applied automatically.');
      console.error(`exec_sql RPC failed: ${error.message}`);
      console.error(
        '\nThe service role key reaches the DB through PostgREST, which cannot run DDL'
      );
      console.error(
        'on its own. Create an exec_sql(sql text) helper once, or paste the SQL below'
      );
      console.error('into the Supabase SQL editor:\n');
      console.error(sql);
      process.exit(1);
    }
  }

  if (await allColumnsExist()) {
    console.log('Migration applied successfully.');
    await report();
  } else {
    console.error('Migration ran without error but columns are still missing. Investigate.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
