// Backfill: resolve stored geography (country, region_state, market) for every
// existing lead from its location string, using the one resolver the write paths
// now use (lib/geography). Idempotent: re-running changes nothing once resolved.
//
// A row that resolves only to a country keeps country and leaves the lower
// levels null. A row that resolves to nothing keeps all three null and is
// reported with examples; it is never dropped, hidden, or guessed at.
//
// The legacy fuel and consulting rows (stream null) are resolved like everything
// else and reported as their own bucket. They are never assigned a GLI stream.
//
//   DRY_RUN=1 reports the distribution without writing.
//   node --env-file=.env.local --import tsx agents/scraper/migrations/backfill-geography.ts

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { resolveGeography } from '../../../lib/geography';

interface Row {
  id: string;
  location: string | null;
  stream: string | null;
  source: string | null;
  country: string | null;
  region_state: string | null;
  market: string | null;
}

const LEGACY = '(legacy fuel / consulting, no stream)';
const inc = (m: Record<string, number>, k: string): void => {
  m[k] = (m[k] ?? 0) + 1;
};

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === '1';
  const rows: Row[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id,location,stream,source,country,region_state,market')
      .range(from, from + 999);
    if (error) {
      console.error('Fetch failed:', error.message);
      process.exit(1);
    }
    if (!data?.length) break;
    rows.push(...(data as never[]));
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`leads: ${rows.length}${dryRun ? '  (DRY_RUN: no writes)' : ''}`);

  const perCountry: Record<string, number> = {};
  const perRegion: Record<string, number> = {};
  const perMarket: Record<string, number> = {};
  const perStreamResolved: Record<string, number> = {};
  const perStreamUnresolved: Record<string, number> = {};
  const perStreamTotal: Record<string, number> = {};
  const countryOnly: Record<string, number> = {};
  const unresolvedExamples: string[] = [];
  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  for (const r of rows) {
    const streamKey = r.stream ?? LEGACY;
    inc(perStreamTotal, streamKey);
    const g = resolveGeography(r.location);

    if (g.country) {
      inc(perCountry, g.country);
      inc(perStreamResolved, streamKey);
      if (g.region_state) inc(perRegion, `${g.country} / ${g.region_state}`);
      if (g.market) inc(perMarket, `${g.country} / ${g.region_state ?? '(no region)'} / ${g.market}`);
      if (!g.region_state && !g.market) inc(countryOnly, g.country);
    } else {
      inc(perStreamUnresolved, streamKey);
      if (unresolvedExamples.length < 20) {
        unresolvedExamples.push(`${JSON.stringify(r.location)} [${r.source ?? '(no source)'} | ${streamKey}]`);
      }
    }

    const same =
      (r.country ?? null) === g.country &&
      (r.region_state ?? null) === g.region_state &&
      (r.market ?? null) === g.market;
    if (same) {
      unchanged++;
      continue;
    }
    if (dryRun) {
      updated++;
      continue;
    }
    const { error } = await supabaseAdmin
      .from('leads')
      .update({ country: g.country, region_state: g.region_state, market: g.market })
      .eq('id', r.id);
    if (error) {
      console.error(`Update failed for ${r.id}: ${error.message}`);
      failed++;
      continue;
    }
    updated++;
  }

  const table = (m: Record<string, number>, limit = 40): string =>
    Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([k, v]) => `    ${String(v).padStart(5)}  ${k}`)
      .join('\n') || '    (none)';

  console.log(`\nrows updated: ${updated}   unchanged: ${unchanged}   failed: ${failed}`);
  console.log(`\nPER COUNTRY (${Object.keys(perCountry).length} distinct):`);
  console.log(table(perCountry));
  console.log(`\nPER REGION / STATE (${Object.keys(perRegion).length} distinct):`);
  console.log(table(perRegion));
  console.log(`\nPER MARKET (${Object.keys(perMarket).length} distinct):`);
  console.log(table(perMarket));
  console.log(`\nCOUNTRY ONLY (resolved to a country, no region or market): ${Object.values(countryOnly).reduce((a, b) => a + b, 0)}`);
  console.log(table(countryOnly, 15));

  const totalUnresolved = Object.values(perStreamUnresolved).reduce((a, b) => a + b, 0);
  console.log(`\nUNRESOLVED (no country): ${totalUnresolved}`);
  console.log('  examples:');
  for (const e of unresolvedExamples) console.log(`    ${e}`);

  console.log('\nRECONCILIATION per stream (resolved + unresolved = total):');
  let sumResolved = 0;
  let sumUnresolved = 0;
  let sumTotal = 0;
  for (const s of Object.keys(perStreamTotal).sort()) {
    const res = perStreamResolved[s] ?? 0;
    const un = perStreamUnresolved[s] ?? 0;
    const tot = perStreamTotal[s] ?? 0;
    sumResolved += res;
    sumUnresolved += un;
    sumTotal += tot;
    console.log(`    ${s.padEnd(38)} ${String(res).padStart(5)} + ${String(un).padStart(5)} = ${String(res + un).padStart(5)}  (stream total ${tot})${res + un === tot ? '' : '   MISMATCH'}`);
  }
  console.log(`    ${'ALL STREAMS'.padEnd(38)} ${String(sumResolved).padStart(5)} + ${String(sumUnresolved).padStart(5)} = ${String(sumResolved + sumUnresolved).padStart(5)}  (table total ${sumTotal})${sumResolved + sumUnresolved === sumTotal ? '  OK' : '   MISMATCH'}`);
}

main().catch((err) => {
  console.error('backfill-geography failed:', err);
  process.exitCode = 1;
});
