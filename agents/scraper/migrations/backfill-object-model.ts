// One-off backfill: stamp object_type + milestone_date on every existing GLI lead
// (Phase 1, two-object model). Uses the same classifyLead logic as the write path.
//   object_type    = 'opportunity' if the lead has a source submission deadline,
//                    else 'project_event'.
//   milestone_date = MAX future date (2026-2035) parsed from title + raw_content.
// Idempotent. Requires migration 013 applied (object_type, milestone_date columns).
// DRY_RUN=1 reports the distribution without writing.
//   node --env-file=.env.local --import tsx agents/scraper/migrations/backfill-object-model.ts

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { classifyLead } from '../lead-date';
import type { NormalizedLead } from '../sources/types';

interface Row {
  id: string;
  stream: string | null;
  title: string | null;
  raw_content: string | null;
  deadline: string | null;
  published_date: string | null;
}

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === '1';
  // Base columns only, so DRY_RUN works before migration 013 is applied. The write
  // still needs 013 (object_type/milestone_date); a failed write is reported.
  const { data, error } = await supabaseAdmin
    .from('leads')
    .select('id, stream, title, raw_content, deadline, published_date')
    .eq('module', 'gli');
  if (error) {
    console.error('Fetch failed:', error.message);
    process.exit(1);
  }
  const rows = (data ?? []) as Row[];

  let opp = 0;
  let proj = 0;
  let withMilestone = 0;
  let updated = 0;
  let failed = 0;
  const verdicts: Record<string, number> = {};

  for (const r of rows) {
    const lead: NormalizedLead = {
      title: r.title ?? '', raw_content: r.raw_content ?? '', url: '', company: null,
      location: null, deadline: r.deadline, published_date: r.published_date,
      value_estimate: null, source: '',
    };
    const m = classifyLead(lead);
    if (m.object_type === 'opportunity') opp++;
    else proj++;
    if (m.milestone_date) withMilestone++;
    verdicts[`${m.object_type}:${m.verdict}`] = (verdicts[`${m.object_type}:${m.verdict}`] ?? 0) + 1;

    if (dryRun) {
      updated++;
      continue;
    }
    const patch = { object_type: m.object_type, milestone_date: m.milestone_date };
    const { error: upErr } = await supabaseAdmin.from('leads').update(patch).eq('id', r.id);
    if (upErr) {
      if (failed === 0) console.error(`Update failed (is migration 013 applied?): ${upErr.message}`);
      failed++;
      continue;
    }
    updated++;
  }

  console.log('\n===== GLI OBJECT-MODEL BACKFILL =====' + (dryRun ? '  (DRY_RUN: no writes)' : ''));
  console.log(`GLI leads scanned:     ${rows.length}`);
  console.log(`object_type opportunity: ${opp}`);
  console.log(`object_type project_event: ${proj}`);
  console.log(`with a future milestone_date: ${withMilestone}`);
  console.log(`Rows updated:          ${updated}${failed ? `  (failed: ${failed})` : ''}`);
  console.log('Verdict distribution:');
  for (const [k, v] of Object.entries(verdicts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(4)}  ${k}`);
  }
  console.log('=====================================\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
