// WHICH MARKETS THE SCORECARD HAS ROWS FOR, AND HOW BIG EACH IS. UNCAPPED.
//
//     npm run diag:scorecard-rows
//
// MARKET-CHECKLIST.md's grid was cut on counts measured 2026-08-27. A grid
// scoped on a stale count puts a market in the deferred block that has since
// grown past the ones above it, so the row list is re-derived from the corpus
// on the day the pass runs rather than copied forward.
//
// PAGED, NOT CAPPED. PostgREST's silent default is 1,000 rows, and a market
// census taken through it is a fact about the first thousand records. Standing
// rule 13.

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { hospitalityModuleValues } from '../pipelines';
import { isCoveredMarket } from '../../../lib/coverage';
import { deadFeedForMarket } from '../../../lib/dead-feeds';

interface Row {
  market: string | null;
  status: string | null;
  module: string | null;
}

async function pageAll(): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('market,status,module')
      .in('module', hospitalityModuleValues())
      .range(from, from + 999);
    if (error) throw new Error(`leads: ${error.message}`);
    const rows = (data ?? []) as Row[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

// The nine the brief scores and the four it defers. Split on the corpus, not on
// a memorised list, so the boundary is a measurement.
const SCORED = 9;

async function main(): Promise<void> {
  const rows = await pageAll();
  const live = rows.filter((r) => r.status !== 'dismissed');

  const perMarket = new Map<string, number>();
  for (const r of live) {
    if (!r.market) continue;
    perMarket.set(r.market, (perMarket.get(r.market) ?? 0) + 1);
  }

  const ranked = [...perMarket.entries()]
    .filter(([m]) => isCoveredMarket(m))
    .sort((a, b) => b[1] - a[1]);

  console.log(`\nSCORECARD ROWS, from ${rows.length} hospitality records read whole (paged, no cap).`);
  console.log(`${live.length} are not dismissed. ${ranked.length} covered markets carry at least one.\n`);

  console.log(`  ${'#'.padStart(3)}  ${'market'.padEnd(38)} ${'records'.padStart(7)}   note`);
  ranked.forEach(([m, n], i) => {
    const dead = deadFeedForMarket(m);
    const band = i < SCORED ? 'SCORED' : 'DEFERRED';
    const note = dead ? `dead feed, frozen since ${dead.frozenSince}` : '';
    console.log(`  ${String(i + 1).padStart(3)}  ${m.padEnd(38)} ${String(n).padStart(7)}   ${band}${note ? '  ' + note : ''}`);
  });

  const deferred = ranked.slice(SCORED);
  const deferredRecords = deferred.reduce((a, b) => a + b[1], 0);
  console.log(
    `\n  THE DEFERRAL, STATED. ${deferred.length} covered markets hold ${deferredRecords} records ` +
      `between them, ${((deferredRecords / live.length) * 100).toFixed(1)}% of the live corpus.`
  );
  console.log('  Standing rule 3: a scorecard that simply stopped at nine rows would be');
  console.log('  withholding four markets without saying so.');

  const uncovered = [...perMarket.entries()].filter(([m]) => !isCoveredMarket(m)).sort((a, b) => b[1] - a[1]);
  if (uncovered.length) {
    console.log(`\n  NOT ON THE COVERED-MARKETS TABLE, so not scored and not deferred either:`);
    for (const [m, n] of uncovered.slice(0, 12)) console.log(`    ${m.padEnd(38)} ${String(n).padStart(7)}`);
    if (uncovered.length > 12) console.log(`    ...and ${uncovered.length - 12} more`);
  }

  const noMarket = live.filter((r) => !r.market).length;
  console.log(`\n  Records carrying no market at all: ${noMarket}. They belong to no row and are not scoreable.`);
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
