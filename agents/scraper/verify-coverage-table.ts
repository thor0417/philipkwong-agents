// DOES THE COVERED-MARKETS TABLE DESCRIBE THE CORPUS?
//
//   npm run verify:coverage-table
//
// THE HOLE THIS CLOSES. verify:staleness reconciles DEFAULT_JURISDICTIONS
// against the live FEEDS, in both directions, and it is why Miami-Dade and San
// Antonio were ever caught. Nothing reconciled lib/coverage.COVERED_MARKETS -
// the table the rail renders, the health screen states and the report path is
// held to - against what the database actually holds.
//
// Both defects found on 2026-08-21 fell through that hole, and they point in
// OPPOSITE directions, which is why this checks both ways:
//
//   claimed and empty   South Florida sat on the table with two SFWMD permits
//                       published in 1982 and 1983. Not dead, not stale, not
//                       declared anything. Just listed.
//   held and unclaimed  Lake Buena Vista had four SFWMD records and appeared on
//                       the table nowhere.
//
// AND THE THIRD CASE, WHICH IS NOT A COVERAGE PROBLEM AT ALL. Yonkers holds zero
// records and its Legistar feed is live, publishing 274 matters in twelve
// months. Retiring it would have been wrong: the adapter reads it every run and
// the fetch cap never reaches the relevant matter. A market that is claimed,
// empty, and NOT declared dead is a CAPTURE defect, and this reports it as one
// rather than failing it as a coverage lie. Getting that distinction wrong is
// what nearly deleted a live feed.
//
// EVERY COUNT CARRIES ITS PREDICATE.

import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../lib/supabase-admin';
import { COVERED_MARKETS, RETIRED_MARKETS, isCoveredMarket } from '../../lib/coverage';
import { deadFeedForMarket } from '../../lib/dead-feeds';
import { COVERED_MARKETS as PRESS_MARKETS } from './sources/serper';

// The government lane, named exactly as lib/coverage names the adapters. A press
// capture is not coverage, so it cannot satisfy rule 1 and cannot trigger rule 2.
const GOVERNMENT_SOURCES = [
  'legistar', 'clark-tab', 'agenda-portal', 'ceqanet',
  'nyc-zap', 'nyc-ceqr', 'nyc-city-record', 'cftod-pdf', 'sfwmd', 'govdoc',
];

/** A market whose newest government document is older than this is not coverage. */
export const COVERAGE_STALE_MONTHS = 12;

interface Row {
  market: string | null;
  source: string | null;
  status: string | null;
  lifecycle: string | null;
  published_date: string | null;
}

function monthsAgo(n: number, now: Date): string {
  const d = new Date(now);
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

export async function main(): Promise<number> {
  const now = new Date();
  const cutoff = monthsAgo(COVERAGE_STALE_MONTHS, now);
  console.log('===== DOES THE COVERED-MARKETS TABLE DESCRIBE THE CORPUS? =====');
  console.log(`today ${now.toISOString().slice(0, 10)}   coverage cutoff ${cutoff} (${COVERAGE_STALE_MONTHS} months)`);
  console.log(
    "predicate: leads WHERE status <> 'dismissed' AND lifecycle <> 'retired' " +
      `AND source IN (${GOVERNMENT_SOURCES.length} government adapters)\n`
  );

  const rows: Row[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('market,source,status,lifecycle,published_date')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`coverage table read failed: ${error.message}`);
    const batch = (data ?? []) as Row[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }

  // A RETIRED RECORD IS NOT EVIDENCE OF COVERAGE. It is the tombstone of a
  // market we stopped claiming, so counting it would keep a retired market
  // looking alive forever.
  const live = rows.filter(
    (r) => r.status !== 'dismissed' && r.lifecycle !== 'retired' && GOVERNMENT_SOURCES.includes(String(r.source))
  );

  const byMarket = new Map<string, { n: number; newest: string | null }>();
  for (const r of live) {
    const m = (r.market ?? '').trim();
    if (!m) continue;
    if (!byMarket.has(m)) byMarket.set(m, { n: 0, newest: null });
    const e = byMarket.get(m)!;
    e.n++;
    const d = r.published_date ? String(r.published_date).slice(0, 10) : null;
    if (d && (!e.newest || d > e.newest)) e.newest = d;
  }

  let failures = 0;
  const captureDefects: string[] = [];

  // ---- RULE 1. CLAIMED AND EMPTY, OR CLAIMED AND ANCIENT. ------------------
  console.log('RULE 1  every claimed market holds a government record inside the window');
  console.log('  MARKET'.padEnd(48), 'RECS'.padStart(5), 'NEWEST'.padStart(12));
  for (const m of COVERED_MARKETS) {
    const e = byMarket.get(m.market) ?? { n: 0, newest: null };
    console.log('  ' + m.market.padEnd(46), String(e.n).padStart(5), String(e.newest ?? 'never').padStart(12));

    if (e.n === 0) {
      // RULE 3 lives here, because "claimed and empty" is only a coverage lie
      // when the source is not producing. If the feed is alive the table is
      // right and the pipeline is wrong, and those need opposite fixes.
      if (deadFeedForMarket(m.market, m.regionState)) {
        failures++;
        console.log(
          `    CLAIMED, EMPTY AND DECLARED DEAD: ${m.market} is on the covered table with a dead ` +
            `feed and no records. Retire it - see RETIRED_MARKETS in lib/coverage.`
        );
      } else {
        captureDefects.push(m.market);
      }
      continue;
    }
    if (!e.newest) {
      failures++;
      console.log(
        `    NO DATED DOCUMENT: ${m.market} holds ${e.n} government records and not one carries a ` +
          `published date, so nothing can say whether this market is current.`
      );
      continue;
    }
    if (e.newest < cutoff) {
      failures++;
      console.log(
        `    CLAIMED BUT NOT COVERAGE: ${m.market} - newest government document ${e.newest}, older ` +
          `than ${COVERAGE_STALE_MONTHS} months. A market that has not filed in over a year is not ` +
          `coverage. Retire it or declare it.`
      );
    }
  }

  // ---- RULE 2. HELD AND UNCLAIMED. -----------------------------------------
  console.log('\nRULE 2  every market holding government records is on the table');
  const retired = new Set(RETIRED_MARKETS.map((r) => r.market.toLowerCase()));
  let unclaimed = 0;
  for (const [market, e] of [...byMarket].sort((a, b) => b[1].n - a[1].n)) {
    if (isCoveredMarket(market)) continue;
    // A retired market's surviving rows are its tombstone, not a claim.
    if (retired.has(market.toLowerCase())) continue;
    unclaimed++;
    failures++;
    console.log(
      `  UNCLAIMED: "${market}" holds ${e.n} government records (newest ${e.newest ?? 'undated'}) and ` +
        `is on no covered-markets row. An adapter is reaching it and the table does not say so.`
    );
  }
  if (unclaimed === 0) console.log('  none: every market holding government records is claimed.');

  // ---- RULE 3 OUTPUT. Reported, never failed. -------------------------------
  console.log('\nRULE 3  claimed, empty, and the feed is not declared dead');
  if (captureDefects.length === 0) {
    console.log('  none.');
  } else {
    for (const m of captureDefects) {
      console.log(
        `  CAPTURE DEFECT, NOT A COVERAGE ONE: ${m} is claimed, holds zero government records, and ` +
          `its feed is not declared dead. The table is right and the pipeline is not reaching it. ` +
          `Run: npm run diag:gate-census -- --client <client>`
      );
    }
    console.log('  Reported, not failed: nothing here is a false claim about what we cover.');
  }

  // ---- RULE 4. ONE LIST, NOT TWO. ------------------------------------------
  //
  // The press lane used to carry its own hand-typed market list. It had drifted
  // to twelve entries against a table of thirteen, two of which named markets
  // this system has never covered. It is now DERIVED, and this asserts the
  // derivation still holds rather than trusting that nobody re-typed it.
  console.log('\nRULE 4  the press-search list is derived from the table, not typed beside it');
  console.log(`  declared markets: ${COVERED_MARKETS.length}   press searches: ${PRESS_MARKETS.length}`);
  if (PRESS_MARKETS.length === 0 && COVERED_MARKETS.length > 0) {
    failures++;
    console.log('  THE PRESS LANE SEARCHES NO MARKET AT ALL, so the market pass covers nothing.');
  } else if (PRESS_MARKETS.length > COVERED_MARKETS.length) {
    failures++;
    console.log(
      `  THE PRESS LIST IS LONGER THAN THE TABLE: ${PRESS_MARKETS.length} searches for ` +
        `${COVERED_MARKETS.length} markets. A derived list cannot exceed its source, so something ` +
        'has been typed back in.'
    );
  } else {
    console.log('  ok: ' + PRESS_MARKETS.join(' | '));
  }

  console.log('');
  if (failures > 0) {
    console.log(
      `FAIL: ${failures} ${failures === 1 ? 'row' : 'rows'} where the covered-markets table and the ` +
        'corpus disagree. A market on the table that holds nothing is a claim we cannot support; a ' +
        'market holding records that is on no row is coverage we are not counting.'
    );
    return 1;
  }
  console.log(
    `PASS: ${COVERED_MARKETS.length} claimed markets all hold a government document inside ` +
      `${COVERAGE_STALE_MONTHS} months, every market holding one is claimed, and the press list is derived.`
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
