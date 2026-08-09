// BACKFILL: re-resolve stored geography after the "Bronx -> Brazil" fix.
//
// resolveGeography read a bare single-token location as a NUTS region code
// before consulting the configured-jurisdiction table. "BRONX" satisfies the
// NUTS shape (BR + ONX), so the BR prefix was read as Brazil and 17 New York
// City records were written with country 'Brazil', region_state null and market
// null on the first scoped NYC run.
//
// The fix is in lib/geography. This re-runs the resolver over every stored row
// and updates only those whose answer CHANGED, so it is safe to run repeatedly
// and touches nothing the fix did not affect.
//
// DRY RUN BY DEFAULT. Pass --apply to write. Without it this only reports, so
// the blast radius is known before anything moves.

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { resolveGeography } from '../../../lib/geography';

interface Row {
  id: string;
  location: string | null;
  country: string | null;
  region_state: string | null;
  market: string | null;
}

const PAGE = 1000;

async function readAll(): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id,location,country,region_state,market')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...(data as Row[]));
    if (data.length < PAGE) break;
  }
  return rows;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const rows = await readAll();
  const changes: { row: Row; next: ReturnType<typeof resolveGeography> }[] = [];

  // A BACKFILL MAY FILL IN OR CORRECT. IT MAY NEVER DOWNGRADE.
  //
  // Re-running a resolver over a live corpus is not automatically safe: three
  // rows carrying location "New York City, USA" store region_state 'New York',
  // and the resolver returns null for that string - it has done so all along,
  // so those values came from somewhere else and are BETTER than what a rescan
  // produces. Blindly writing the resolver's answer would erase them.
  //
  // So a change is only applied when it does not replace a stored non-null with
  // a null. That keeps this migration to the bug it was written for.
  const downgrades: { row: Row; next: ReturnType<typeof resolveGeography> }[] = [];
  for (const row of rows) {
    const next = resolveGeography(row.location);
    if (
      next.country === row.country &&
      next.region_state === row.region_state &&
      next.market === row.market
    ) {
      continue;
    }
    const wouldNull =
      (row.country !== null && next.country === null) ||
      (row.region_state !== null && next.region_state === null) ||
      (row.market !== null && next.market === null);
    if (wouldNull) {
      downgrades.push({ row, next });
      continue;
    }
    changes.push({ row, next });
  }

  if (downgrades.length > 0) {
    console.log(`Skipped ${downgrades.length} rows that would have lost a stored value:`);
    const d: Record<string, number> = {};
    for (const c of downgrades) {
      const k =
        `${JSON.stringify(c.row.location)}: ` +
        `${c.row.country}/${c.row.region_state}/${c.row.market} -> ` +
        `${c.next.country}/${c.next.region_state}/${c.next.market}`;
      d[k] = (d[k] ?? 0) + 1;
    }
    for (const [k, v] of Object.entries(d)) console.log(`  ${String(v).padStart(4)}  ${k}`);
    console.log('');
  }

  console.log(`Scanned ${rows.length} rows; ${changes.length} would change.`);
  const summary: Record<string, number> = {};
  for (const c of changes) {
    const k =
      `${JSON.stringify(c.row.location)}: ` +
      `${c.row.country}/${c.row.region_state}/${c.row.market} -> ` +
      `${c.next.country}/${c.next.region_state}/${c.next.market}`;
    summary[k] = (summary[k] ?? 0) + 1;
  }
  for (const [k, v] of Object.entries(summary).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(4)}  ${k}`);
  }

  if (!apply) {
    console.log('\nDRY RUN. Pass --apply to write these changes.');
    return;
  }

  let written = 0;
  let failed = 0;
  for (const c of changes) {
    const { error } = await supabaseAdmin
      .from('leads')
      .update({ country: c.next.country, region_state: c.next.region_state, market: c.next.market })
      .eq('id', c.row.id);
    if (error) {
      failed++;
      console.error(`  update failed for ${c.row.id}: ${error.message}`);
    } else {
      written++;
    }
  }
  console.log(`\nApplied: ${written} rows updated, ${failed} failed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
