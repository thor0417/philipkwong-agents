// One-off backfill: apply the current classification (classify.ts) to every lead
// already in the leads table, in place, without re-scraping. Fuel-module leads
// run through classifyFuel; everything else through classifyConsulting. It reads
// each row's stored text/source/company, so the tags match what a fresh scrape
// would now write. Idempotent: re-running yields the same tags.
//
// Run: node --env-file=.env.local --import tsx agents/scraper/migrations/backfill-classification.ts

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { classifyFuel, classifyConsulting } from '../classify';
import type { NormalizedLead } from '../sources/types';

interface LeadRow {
  id: string;
  source: string | null;
  title: string | null;
  raw_content: string | null;
  company: string | null;
  location: string | null;
  deadline: string | null;
  value_estimate: string | null;
  url: string | null;
  module: string | null;
  is_cargo: boolean | null;
}

function toNormalized(row: LeadRow): NormalizedLead {
  return {
    title: row.title ?? '',
    url: row.url ?? '',
    raw_content: row.raw_content ?? '',
    company: row.company,
    location: row.location,
    deadline: row.deadline,
    value_estimate: row.value_estimate,
    source: row.source ?? '',
  };
}

async function main(): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('leads')
    .select(
      'id, source, title, raw_content, company, location, deadline, value_estimate, url, module, is_cargo'
    );
  if (error) {
    console.error('Fetch failed:', error.message);
    process.exit(1);
  }
  const rows = (data ?? []) as LeadRow[];
  console.log(`Backfilling classification on ${rows.length} leads...`);

  let fuel = 0;
  let consulting = 0;
  let updated = 0;
  let failed = 0;
  let cargoCleared = 0;

  for (const row of rows) {
    const isFuel = row.module === 'fuel';
    const tags = isFuel ? classifyFuel(toNormalized(row)) : classifyConsulting(toNormalized(row));
    if (isFuel) fuel++;
    else consulting++;
    if (row.is_cargo === true && tags.is_cargo === false) cargoCleared++;

    const { error: upErr } = await supabaseAdmin
      .from('leads')
      .update({
        category: tags.category,
        subcategory: tags.subcategory,
        product_type: tags.product_type,
        is_cargo: tags.is_cargo,
        volume_estimate: tags.volume_estimate,
        sector: tags.sector,
      })
      .eq('id', row.id);
    if (upErr) {
      console.error(`Update failed for ${row.id}: ${upErr.message}`);
      failed++;
      continue;
    }
    updated++;
  }

  console.log(
    `Done. fuel=${fuel} consulting=${consulting} updated=${updated} failed=${failed} cargo_cleared=${cargoCleared}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
