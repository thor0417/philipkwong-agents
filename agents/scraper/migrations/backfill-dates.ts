// One-off backfill: give every existing GLI lead a best-available date and a
// date_source provenance (Brief 1, Part D).
//
// Runs the SAME deriveLeadDates logic the write path uses over all stored GLI
// leads (module 'gli' -> all three streams: opportunity, government, intelligence),
// so backfilled and freshly-scraped rows are scored identically:
//   - an existing source date (deadline / published_date) -> date_source 'source'
//   - else a date parsed from the lead's title / raw_content -> 'parsed'
//   - else no date at all -> 'first_seen'
// It also sets first_seen where the column is still null (the honest floor: we do
// not know the true first-seen, so migration/backfill time is used). Existing
// source dates are never overwritten; only date_source (and a newly-parsed
// published_date) are written. Idempotent: re-running changes nothing.
//
// Run (AFTER applying migration 012): node --env-file=.env.local --import tsx \
//   agents/scraper/migrations/backfill-dates.ts
// DRY_RUN=1 reports the outcome without writing.

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { deriveLeadDates } from '../lead-date';
import type { NormalizedLead } from '../sources/types';

interface Row {
  id: string;
  stream: string | null;
  title: string | null;
  raw_content: string | null;
  deadline: string | null;
  published_date: string | null;
  date_source: string | null;
  first_seen: string | null;
}

function usable(iso: string | null): boolean {
  return !!iso && !Number.isNaN(new Date(iso).getTime());
}

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === '1';
  const { data, error } = await supabaseAdmin
    .from('leads')
    .select('id, stream, title, raw_content, deadline, published_date, date_source, first_seen')
    .eq('module', 'gli');
  if (error) {
    console.error('Fetch failed:', error.message);
    process.exit(1);
  }
  const rows = (data ?? []) as Row[];

  // Before: how many carried a usable source date going in.
  const beforeDated = rows.filter((r) => usable(r.deadline) || usable(r.published_date)).length;

  let viaSource = 0;
  let viaParse = 0;
  let unknown = 0;
  let updated = 0;
  let firstSeenSet = 0;
  let failed = 0;

  for (const r of rows) {
    const stream = (r.stream === 'government' || r.stream === 'intelligence' ? r.stream : 'opportunity');
    const lead: NormalizedLead = {
      title: r.title ?? '',
      raw_content: r.raw_content ?? '',
      url: '',
      company: null,
      location: null,
      deadline: r.deadline,
      published_date: r.published_date,
      value_estimate: null,
      source: '',
    };
    const dates = deriveLeadDates(lead, stream);
    if (dates.date_source === 'source') viaSource++;
    else if (dates.date_source === 'parsed') viaParse++;
    else unknown++;

    // Only write what actually changed: date_source always, published_date when a
    // parse newly filled it, first_seen only when still null (honest floor).
    const patch: Record<string, unknown> = {};
    if (r.date_source !== dates.date_source) patch.date_source = dates.date_source;
    if (dates.date_source === 'parsed' && r.published_date !== dates.published_date) {
      patch.published_date = dates.published_date;
    }
    if (!r.first_seen) {
      patch.first_seen = new Date().toISOString();
      firstSeenSet++;
    }
    if (Object.keys(patch).length === 0) continue;

    if (dryRun) {
      updated++;
      continue;
    }
    const { error: upErr } = await supabaseAdmin.from('leads').update(patch).eq('id', r.id);
    if (upErr) {
      console.error(`Update failed for ${r.id}: ${upErr.message}`);
      failed++;
      continue;
    }
    updated++;
  }

  // After: rows now carrying a real content date (source OR parsed).
  const afterDated = viaSource + viaParse;

  console.log('\n===== GLI DATE BACKFILL =====' + (dryRun ? '  (DRY_RUN: no writes)' : ''));
  console.log(`GLI leads scanned:        ${rows.length}`);
  console.log(`Dated via source:         ${viaSource}`);
  console.log(`Dated via parse:          ${viaParse}`);
  console.log(`Still unknown (first_seen): ${unknown}`);
  console.log(`first_seen set (was null):  ${firstSeenSet}`);
  console.log(`Rows updated:             ${updated}${failed ? `  (failed: ${failed})` : ''}`);
  console.log(
    `Content-dated coverage:   ${beforeDated} -> ${afterDated} of ${rows.length}` +
      `  (+${afterDated - beforeDated} newly dated by text parse)`
  );
  console.log('=============================\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
