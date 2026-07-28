// Re-tag: mark stored leads that are already awarded/dead or expired so they
// drop out of the actionable set, matching the write-path rules. Sets
// lifecycle='dead' for notices matching the dead terms (awarded/cancelled/
// withdrawn/superseded/award or intent notice) and lifecycle='expired' for leads
// whose deadline has passed. Dead takes precedence.
//
// This writes LIFECYCLE, never status. status is Philip's triage column
// (new / watchlist / client_ready / dismissed) and no scrape or migration path
// may touch it; lifecycle is the scraper's factual axis (active/expired/dead).
// Only rewrites rows still at lifecycle 'active' (or null), so a row already
// classified is not churned.
//
// Run: node --env-file=.env.local --import tsx agents/scraper/migrations/retag-dead-expired.ts

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { isDeadNotice } from '../classify';
import type { NormalizedLead } from '../sources/types';

interface Row {
  id: string;
  lifecycle: string | null;
  deadline: string | null;
  title: string | null;
  raw_content: string | null;
  source: string | null;
}

async function main(): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('leads')
    .select('id, lifecycle, deadline, title, raw_content, source');
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
    // Never churn a row already classified on the lifecycle axis.
    if (r.lifecycle && r.lifecycle !== 'active') {
      continue;
    }
    const isDead = isDeadNotice({
      title: r.title ?? '',
      raw_content: r.raw_content ?? '',
      source: r.source ?? '',
    } as NormalizedLead);
    const isExpired = !!r.deadline && new Date(r.deadline).getTime() < now;
    const next = isDead ? 'dead' : isExpired ? 'expired' : null;
    if (!next) continue;
    if (r.lifecycle === next) {
      continue;
    }

    const { error: upErr } = await supabaseAdmin.from('leads').update({ lifecycle: next }).eq('id', r.id);
    if (upErr) {
      console.error(`Update failed for ${r.id}: ${upErr.message}`);
      failed++;
      continue;
    }
    if (next === 'dead') dead++;
    else expired++;
  }

  // Count of leads that were left alone because a user had already moved them.
  skippedNonNew = rows.filter((r) => r.lifecycle && r.lifecycle !== 'active').length;

  console.log(
    `Re-tag done. dead=${dead} expired=${expired} failed=${failed} (skipped ${skippedNonNew} with a non-new status).`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
