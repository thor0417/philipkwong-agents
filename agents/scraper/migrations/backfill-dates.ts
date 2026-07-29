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

// NOT IDEMPOTENT AS ORIGINALLY WRITTEN, despite the claim above. On the first
// pass a text-parsed date is written to published_date and the row is marked
// date_source 'parsed'. On the SECOND pass the row is fed back through
// deriveLeadDates with that published_date in place, and step 1 of the
// derivation ("a real date the source exposed always wins") cannot tell a date
// we parsed from a date the source published, so it returns 'source'. The
// provenance is destroyed on the second run, and the DATE UNKNOWN badge with it.
//
// It also meant this backfill could never repair a wrong parsed date: it treated
// its own previous output as authoritative evidence. That is what kept six rows
// sitting in the future (2030-01-01 at worst) after parseDateFromText was fixed
// to exclude plan-horizon years.
//
// A row whose provenance is already 'parsed' therefore has its stored
// published_date withheld and is re-derived from its TEXT, which is the only
// evidence that was ever behind it.

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { deriveLeadDates } from '../lead-date';
import { selectAllPaged } from '../page-select';
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
  const { rows, complete } = await selectAllPaged<Row>(
    'leads',
    'id, stream, title, raw_content, deadline, published_date, date_source, first_seen',
    (q: unknown) => (q as { eq: (a: string, b: string) => unknown }).eq('module', 'gli'),
    'backfill-dates'
  );
  if (!complete) {
    console.error('Fetch was partial; refusing to backfill dates over an incomplete corpus.');
    process.exit(1);
  }

  // Before: how many carried a usable source date going in.
  const beforeDated = rows.filter((r) => usable(r.deadline) || usable(r.published_date)).length;

  let viaSource = 0;
  let viaParse = 0;
  let unknown = 0;
  let updated = 0;
  let firstSeenSet = 0;
  let failed = 0;

  let reparsed = 0;
  for (const r of rows) {
    const stream = (r.stream === 'government' || r.stream === 'intelligence' ? r.stream : 'opportunity');
    // A published_date this backfill itself parsed is not source evidence. Feed
    // the text back in instead, so the row is re-derived from what was actually
    // behind it and a wrong parse can be corrected.
    const wasParsed = r.date_source === 'parsed';
    if (wasParsed) reparsed++;
    const lead: NormalizedLead = {
      title: r.title ?? '',
      raw_content: r.raw_content ?? '',
      url: '',
      company: null,
      location: null,
      deadline: r.deadline,
      published_date: wasParsed ? null : r.published_date,
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
    // A row that WAS parsed and no longer parses to anything must have the old
    // parse CLEARED, not left behind under a first_seen provenance. Without this
    // the six future-dated rows kept their 2030 published_date while claiming to
    // be undated.
    if (wasParsed && dates.date_source !== 'parsed' && r.published_date !== null) {
      patch.published_date = null;
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
  console.log(`Re-derived from text:     ${reparsed}  (rows already marked 'parsed')`);
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
