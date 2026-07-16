// One-off backfill: set development_category on every GLI lead already in the
// leads table, in place, without re-scraping. Uses the same classifier the
// scraper writes with (development-category.ts) over each row's stored title,
// content, and venue_type, so tags match what a fresh scrape would now write.
// Idempotent: re-running only touches rows whose category changed.
//
// Requires the 008 migration (development_category column) applied first.
// Run: node --env-file=.env.local --import tsx agents/scraper/migrations/backfill-development-category.ts

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { developmentCategory } from '../development-category';

interface Row {
  id: string;
  title: string | null;
  raw_content: string | null;
  venue_type: string | null;
  development_category: string | null;
}

async function main(): Promise<void> {
  const rows: Row[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id, title, raw_content, venue_type, development_category')
      .eq('module', 'gli')
      .range(from, from + 999);
    if (error) {
      console.error(`Backfill: query failed: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    rows.push(...((data as Row[]) ?? []));
    if (!data || data.length < 1000) break;
    from += 1000;
  }

  let updated = 0;
  const perCategory: Record<string, number> = {};
  for (const r of rows) {
    const cat = developmentCategory(r.title, r.raw_content, r.venue_type);
    perCategory[cat] = (perCategory[cat] ?? 0) + 1;
    if (r.development_category === cat) continue;
    const { error } = await supabaseAdmin
      .from('leads')
      .update({ development_category: cat })
      .eq('id', r.id);
    if (error) {
      console.error(`Backfill: update failed for ${r.id}: ${error.message}`);
      continue;
    }
    updated++;
  }

  console.log(`Backfilled development_category on ${updated} of ${rows.length} GLI rows.`);
  console.log('Per development_category:');
  for (const [k, v] of Object.entries(perCategory).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(v).padStart(4)}  ${k}`);
  }
}

main();
