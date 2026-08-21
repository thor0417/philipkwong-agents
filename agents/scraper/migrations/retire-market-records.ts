// RETIRE THE RECORDS OF A MARKET THAT LEFT THE COVERED TABLE.
//
//   npm run retire:markets            report only, writes nothing
//   npm run retire:markets -- --apply write lifecycle = 'retired'
//
// NOTHING IS DELETED AND NOTHING IS DISMISSED. `lifecycle = 'retired'` is the
// same tombstone opportunity/RETIRED_SOURCES uses for the tender and
// development-bank feeds: the row stays, the corpus snapshot stops counting it
// as live, and cluster.ts does not cluster it. `status` is Philip's column and
// is never written by a scrape path, so a retirement must not touch it - a
// dismissed row says "this should not have been captured", and these were
// captured correctly from a source that has since stopped being coverage.
//
// WHY BY MARKET AND NOT BY SOURCE. Legistar is not retired: it still serves
// Clark County, Nashville, Phoenix, Oakland, Yonkers and Westchester. SFWMD is
// not retired: it still serves Lake Buena Vista. What was retired is the CLAIM
// that we cover three particular places, so the tombstone is keyed on the market
// the record names.
//
// GOVERNMENT RECORDS ONLY, AND THAT IS DELIBERATE. A press capture that happens
// to name San Antonio is not a coverage claim, it is the intelligence lane doing
// what it does everywhere. Whether a press-only project in a place we read no
// filings from belongs in the register at all is a SCOPE question that was
// explicitly reserved on 2026-08-21, and retiring those rows here would answer
// it silently. Measured on the day: 20 government records across the three
// markets, and 3 press records left alone.
//
// WHAT IT COSTS, MEASURED BEFORE RUNNING. Weston Urban is stage 'approved' with
// 8 records, and all 8 are San Antonio Legistar. It is 100% dependent on a
// retired feed, which is the same shape as the 27 projects the source retirement
// took: not one was left holding a fraction of its records. It has been
// unprintable since the dead-feed rule landed, so nothing a client could have
// been shown changes.

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { RETIRED_MARKETS } from '../../../lib/coverage';

// The government lane, named exactly as lib/coverage names the adapters.
const GOVERNMENT_SOURCES = [
  'legistar', 'clark-tab', 'agenda-portal', 'ceqanet',
  'nyc-zap', 'nyc-ceqr', 'nyc-city-record', 'cftod-pdf', 'sfwmd', 'govdoc',
];

const APPLY = process.argv.includes('--apply');

function reasonFor(market: string): string {
  const m = RETIRED_MARKETS.find((r) => r.market === market);
  return (
    `Market retired ${m?.retired ?? '2026-08-21'}: ${market} left the covered-markets table. ` +
    `Newest document the feed ever gave us: ${m?.lastDocument ?? 'unknown'}. ` +
    `Captured record kept, not deleted. See RETIRED_MARKETS in lib/coverage.`
  );
}

async function main(): Promise<void> {
  console.log(APPLY ? '=== RETIRING MARKET RECORDS ===' : '=== REPORT ONLY (pass --apply to write) ===');

  let totalSeen = 0;
  let totalWritten = 0;

  for (const rm of RETIRED_MARKETS) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id,source,status,lifecycle,published_date,project_id')
      .eq('market', rm.market)
      .limit(5000);
    if (error) throw new Error(`read failed for ${rm.market}: ${error.message}`);

    const all = data ?? [];
    const gov = all.filter((l) => GOVERNMENT_SOURCES.includes(String(l.source)));
    const press = all.filter((l) => !GOVERNMENT_SOURCES.includes(String(l.source)));
    // AN ALREADY-DISMISSED ROW IS LEFT ENTIRELY ALONE, and this is not tidiness.
    // score_reason on a dismissed row is the TOMBSTONE: it says why that record
    // was thrown out. Stamping a market-retirement reason over it would destroy
    // the only record of the earlier decision and replace it with a later one
    // that is true of the market and false of the row. It is already tombstoned;
    // a second tombstone is not an improvement.
    const dismissed = gov.filter((l) => l.status === 'dismissed');
    const todo = gov.filter((l) => l.status !== 'dismissed' && l.lifecycle !== 'retired');

    console.log(`\n${rm.market}  (last document ${rm.lastDocument})`);
    console.log(`  leads naming this market : ${all.length}`);
    console.log(`  government lane          : ${gov.length}   already retired: ${gov.filter((l) => l.lifecycle === 'retired').length}`);
    console.log(`  already dismissed, LEFT  : ${dismissed.length}`);
    console.log(`  press, LEFT ALONE        : ${press.length}`);
    console.log(`  to retire now            : ${todo.length}`);
    totalSeen += todo.length;

    if (!APPLY || todo.length === 0) continue;

    // In chunks, because a PostgREST `in` list is a URL and a long one is a 414.
    const CHUNK = 100;
    for (let i = 0; i < todo.length; i += CHUNK) {
      const ids = todo.slice(i, i + CHUNK).map((l) => l.id);
      const { error: werr } = await supabaseAdmin
        .from('leads')
        .update({ lifecycle: 'retired', score_reason: reasonFor(rm.market) })
        .in('id', ids);
      if (werr) throw new Error(`write failed for ${rm.market}: ${werr.message}`);
      totalWritten += ids.length;
    }
    console.log(`  written                  : ${todo.length}`);
  }

  console.log(`\n${APPLY ? 'RETIRED' : 'WOULD RETIRE'}: ${APPLY ? totalWritten : totalSeen} government records`);

  // READ IT BACK OFF THE DATABASE. A migration that reports its own success from
  // the value it just sent is a migration that cannot fail visibly.
  if (APPLY) {
    for (const rm of RETIRED_MARKETS) {
      const { count, error } = await supabaseAdmin
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('market', rm.market)
        .eq('lifecycle', 'retired');
      if (error) throw new Error(`read-back failed for ${rm.market}: ${error.message}`);
      console.log(`  read back ${rm.market}: ${count} rows now lifecycle = 'retired'`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
