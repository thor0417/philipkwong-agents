// READ-ONLY. A MEETING DATE STORED A DAY EARLY, AND HOW FAR THE SHAPE REACHES.
//
//   node --env-file=.env.local --import tsx \
//     agents/scraper/diagnostics/date-shift-census.ts
//
// FOUND BY THE READER 3 PROBE, WHICH WAS LOOKING FOR SOMETHING ELSE. Matching
// the corpus's Anaheim records against the meetings www.anaheim.net publishes,
// every Planning Commission record missed its meeting by exactly one day: the
// city publishes the agenda for Monday 15 December 2025 and the record says
// 2025-12-14. Nine of twelve held meetings, then all seventeen PC records, then
// every one of them at 17:00:00Z.
//
// 17:00:00Z IS MIDNIGHT IN UTC+7, WHICH IS THIS MACHINE. That is the whole
// finding. sources/agenda-portal.ts:375 reads the date out of the Granicus row
// as free text and calls
//
//     new Date('December 15, 2025').toISOString()
//
// `new Date` parses a free-text date, and an ISO datetime carrying no zone, in
// the RUNTIME'S LOCAL TIME. On a machine at UTC+7 that is 2025-12-14T17:00:00Z,
// and the date part - which is what a document prints and what bestDate sorts
// on - is a day early. On the hosted runner, which is UTC, the same line is
// correct. So the stored meeting date is partly a fact about the machine that
// captured it, which is the same class as a dead-feed verdict recorded from a
// developer's connection.
//
// AN ISO DATE-ONLY STRING IS SAFE and that is why this is not everywhere:
// `new Date('2026-07-13')` is parsed as UTC by specification. It is the two
// other shapes that shift - free text ('December 15, 2025') and an ISO datetime
// with no zone ('2026-07-13T00:00:00', which is what Legistar serves).
//
// THIS FILE DOES NOT GUESS WHICH ADAPTERS CARRY IT. It counts, per source, how
// many stored `published_date` values sit at the local-midnight offset, so the
// reach is a number per adapter rather than a reading of the code. Re-run it
// after any fix: the shifted count is what has to fall.

import { pathToFileURL } from 'node:url';
import { selectAllPaged } from '../page-select';

type Row = Record<string, unknown>;
const tidy = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim();

// The offset of the machine that captured the rows, as a UTC clock time. A date
// parsed at local midnight in UTC+7 is stored at 17:00:00Z; a date-only string
// parsed as UTC is stored at 00:00:00Z. Stated rather than hardcoded silently,
// because a corpus captured from two machines carries two signatures and the
// census has to be read with that in mind.
const LOCAL_MIDNIGHT_UTC = '17:00:00';

async function main(): Promise<void> {
  const { rows, complete } = await selectAllPaged<Row>(
    'leads',
    'id,source,market,status,published_date',
    (q) => q,
    'date-shift'
  );
  if (!complete) throw new Error('read was partial; refusing to report a corpus count from a slice.');

  const live = rows.filter((r) => String(r.status) !== 'dismissed' && tidy(r.published_date));
  console.log('='.repeat(100));
  console.log('THE STORED DATE, AND WHOSE MIDNIGHT IT IS');
  console.log('='.repeat(100));
  console.log(`POPULATION: leads, status<>dismissed, published_date not null. Paged to exhaustion, no cap.`);
  console.log(`  rows read            : ${rows.length}`);
  console.log(`  with a stored date   : ${live.length}`);
  console.log(`  local-midnight clock : ${LOCAL_MIDNIGHT_UTC}Z  (00:00 at UTC+7, this machine)`);
  console.log('');

  const by = new Map<string, { n: number; shifted: number; times: Map<string, number> }>();
  for (const r of live) {
    const iso = tidy(r.published_date);
    const clock = iso.slice(11, 19);
    const s = String(r.source);
    const e = by.get(s) ?? { n: 0, shifted: 0, times: new Map<string, number>() };
    e.n++;
    if (clock === LOCAL_MIDNIGHT_UTC) e.shifted++;
    e.times.set(clock || '(no time)', (e.times.get(clock || '(no time)') ?? 0) + 1);
    by.set(s, e);
  }

  let totalShifted = 0;
  console.log(`${'source'.padEnd(22)} ${'dated'.padStart(7)} ${'at local midnight'.padStart(18)}   clock times held`);
  for (const [s, e] of [...by.entries()].sort((a, b) => b[1].shifted - a[1].shifted)) {
    totalShifted += e.shifted;
    const top = [...e.times.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, v]) => `${k} x${v}`)
      .join('   ');
    console.log(`${s.padEnd(22)} ${String(e.n).padStart(7)} ${String(e.shifted).padStart(18)}   ${top}`);
  }
  console.log('');
  console.log(`  TOTAL carrying the local-midnight signature: ${totalShifted} of ${live.length}`);
  console.log('');
  console.log('  A 17:00:00Z value is not a proof on its own - a source could publish at 17:00 UTC.');
  console.log('  It is a proof where the source publishes a DATE and not a time, which is every');
  console.log('  meeting-date and filing-date adapter below. The one case verified against the');
  console.log('  publisher: Anaheim Planning Commission, 15 December 2025 on www.anaheim.net,');
  console.log('  stored here as 2025-12-14T17:00:00Z.');

  // Per market, because standing rule 2: a corpus count hides which market wears
  // the harm, and a meeting date is printed per market in a client document.
  console.log('');
  console.log('PER MARKET');
  const byMarket = new Map<string, { n: number; shifted: number }>();
  for (const r of live) {
    const m = tidy(r.market) || '(no market)';
    const e = byMarket.get(m) ?? { n: 0, shifted: 0 };
    e.n++;
    if (tidy(r.published_date).slice(11, 19) === LOCAL_MIDNIGHT_UTC) e.shifted++;
    byMarket.set(m, e);
  }
  for (const [m, e] of [...byMarket.entries()].sort((a, b) => b[1].shifted - a[1].shifted)) {
    if (!e.shifted) continue;
    console.log(`  ${m.padEnd(26)} ${String(e.shifted).padStart(5)} of ${String(e.n).padStart(5)}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
