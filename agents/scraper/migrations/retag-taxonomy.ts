// One-off re-tag: re-classify every existing GLI lead's venue_type against the
// canonical taxonomy (lib/taxonomy.ts), in place, without re-scraping. Splits
// previously-collapsed leads (amusement parks, casinos, entertainment districts
// lumped as "Leisure Destination/Mixed") back into their distinct types, and
// gives smart-city / infrastructure leads their proper urban/infra venue types.
// Deterministic and idempotent. Nothing is deleted.
//
// development_category is DERIVED from venue_type (VENUE_TO_CATEGORY), so it is
// reported here; it is persisted on write by the scraper once the 008 column
// migration is applied. This script only updates the venue_type column (which
// already exists).
//
// Run: node --env-file=.env.local --import tsx agents/scraper/migrations/retag-taxonomy.ts

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { classifyVenueType, categoryForVenue } from '../../../lib/taxonomy';

interface Row {
  id: string;
  title: string | null;
  raw_content: string | null;
  venue_type: string | null;
}

async function main(): Promise<void> {
  const rows: Row[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id, title, raw_content, venue_type')
      .eq('module', 'gli')
      .range(from, from + 999);
    if (error) {
      console.error(`Re-tag: query failed: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    rows.push(...((data as Row[]) ?? []));
    if (!data || data.length < 1000) break;
    from += 1000;
  }

  let updated = 0;
  const perVenue: Record<string, number> = {};
  const perCategory: Record<string, number> = {};
  for (const r of rows) {
    const venue = classifyVenueType(`${r.title ?? ''} ${r.raw_content ?? ''} ${r.venue_type ?? ''}`);
    perVenue[venue] = (perVenue[venue] ?? 0) + 1;
    const cat = categoryForVenue(venue);
    perCategory[cat] = (perCategory[cat] ?? 0) + 1;
    if (r.venue_type === venue) continue;
    const { error } = await supabaseAdmin.from('leads').update({ venue_type: venue }).eq('id', r.id);
    if (error) {
      console.error(`Re-tag: update failed for ${r.id}: ${error.message}`);
      continue;
    }
    updated++;
  }

  const table = (m: Record<string, number>): void => {
    for (const [k, v] of Object.entries(m).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(v).padStart(4)}  ${k}`);
    }
  };
  console.log(`Re-tagged venue_type on ${updated} of ${rows.length} GLI leads (canonical taxonomy).`);
  console.log('Count per venue_type:');
  table(perVenue);
  console.log('Count per development_category (derived from venue):');
  table(perCategory);
}

main();
