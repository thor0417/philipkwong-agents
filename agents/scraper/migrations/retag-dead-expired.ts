// One-off re-tag: mark stored leads that are already awarded/dead or expired so
// they drop out of the actionable set, matching the write-path rules. Sets
// status='dead' for notices matching the dead terms (awarded/cancelled/withdrawn/
// superseded/award or intent notice) and status='expired' for leads whose
// deadline has passed. Dead takes precedence. Only rewrites leads still at
// status 'new' (or null), so a user's manual lifecycle status is never clobbered.
//
// Run: node --env-file=.env.local --import tsx agents/scraper/migrations/retag-dead-expired.ts

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { isDeadNotice } from '../classify';

interface Row {
  id: string;
  status: string | null;
  deadline: string | null;
  title: string | null;
  raw_content: string | null;
}

async function main(): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('leads')
    .select('id, status, deadline, title, raw_content');
  if (error) {
    console.error('Fetch failed:', error.message);
    process.exit(1);
  }
  const rows = (data ?? []) as Row[];
  const now = Date.now();

  let dead = 0;
  let expired = 0;
  let skippedNonNew = 0;
  let failed = 0;

  for (const r of rows) {
    // Never overwrite a user-set lifecycle status.
    if (r.status && r.status !== 'new') {
      continue;
    }
    const isDead = isDeadNotice(`${r.title ?? ''}\n${r.raw_content ?? ''}`);
    const isExpired = !!r.deadline && new Date(r.deadline).getTime() < now;
    const next = isDead ? 'dead' : isExpired ? 'expired' : null;
    if (!next) continue;
    if (r.status === next) {
      continue;
    }

    const { error: upErr } = await supabaseAdmin.from('leads').update({ status: next }).eq('id', r.id);
    if (upErr) {
      console.error(`Update failed for ${r.id}: ${upErr.message}`);
      failed++;
      continue;
    }
    if (next === 'dead') dead++;
    else expired++;
  }

  // Count of leads that were left alone because a user had already moved them.
  skippedNonNew = rows.filter((r) => r.status && r.status !== 'new').length;

  console.log(
    `Re-tag done. dead=${dead} expired=${expired} failed=${failed} (skipped ${skippedNonNew} with a non-new status).`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
