// PUT BACK WHAT THE DRAIN AUDIT TOOK.
//
// e2e/inbox.audit.ts proves the Inbox empties by dismissing twenty real records
// and watching the count fall. Twenty dismissals is twenty judgements nobody
// made, and this corpus is what client documents are generated from, so the
// audit records every id it touched and this puts them back at status 'new'.
//
// It is deliberately a separate command rather than a teardown inside the test:
// a teardown that fails leaves the corpus wrong and the run green, and the whole
// reason for this file is that a wrong corpus must never be quiet.
//
//     npm run inbox:restore
//
// Idempotent. Restoring a record already at 'new' writes 'new' again.

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { walkthroughOut } from '../e2e/artefacts';

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. This reads ../.env.local.');
}
const db = createClient(url, key, { auth: { persistSession: false } });

// Wrapped rather than top level: the dashboard package is CommonJS, where tsx
// rejects top-level await outright.
async function main(): Promise<void> {
  // The same root the harness writes to. Unset, that is the committed path,
  // which is what a hand-run restore wants; the gate sets E2E_SHOTS_ROOT and
  // reads its own copy instead.
  const PATH = walkthroughOut('inbox-drain.json');
  const drain = JSON.parse(readFileSync(PATH, 'utf8')) as {
    start: number;
    after: number;
    triaged: number;
    dismissed: string[];
  };

  console.log(`${PATH}: ${drain.start} -> ${drain.after}, ${drain.dismissed.length} ids to restore`);

  const { error } = await db
    .from('leads')
    .update({ status: 'new' })
    .in('id', drain.dismissed);
  if (error) throw new Error(`restore failed: ${error.message}`);

  // Verify rather than announce. A restore that reports success without reading
  // back is the same class of claim this project keeps finding and fixing.
  const { count, error: cErr } = await db
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .in('id', drain.dismissed)
    .neq('status', 'dismissed');
  if (cErr) throw new Error(`restore verification failed: ${cErr.message}`);

  console.log(`restored: ${count} of ${drain.dismissed.length} are no longer dismissed`);
  if ((count ?? 0) !== drain.dismissed.length) {
    console.error('NOT EVERY RECORD CAME BACK. Check the ids above by hand.');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
