// IS ANY CONFIGURED JURISDICTION READING A DEAD FEED?
//
//   npm run verify:staleness
//
// THE GAP THIS CLOSES. The zero-write alarm answers "did this source produce
// anything?" and a frozen feed produces: it hands back the same snapshot,
// correctly, every run. Telling "still moving" from "stopped in 2018" needs run
// HISTORY, and source_health holds one row, so nothing in this system would
// have said a word.
//
// Measured 2026-08-14, that cost us two markets on the covered list:
//
//   Miami-Dade County  newest matter 2018-06-15   8 years 2 months behind
//   San Antonio, TX    newest matter 2021-09-24   4 years 10 months behind
//
// Both were captured, clustered, named and reportable. Every statement in a
// report about them would have been true and about 2018.
//
// SO STALENESS IS ASKED OF THE SOURCE, not of our database. One request per
// jurisdiction for the newest matter, one for the count over the last twelve
// months. Reads nothing of ours, writes nothing anywhere.
//
// IT CHECKS THE DECLARATION IN BOTH DIRECTIONS, which is the half that keeps
// this honest. lib/dead-feeds names the markets we have stopped reading, and the
// report path withholds them from client documents on the strength of it. So:
//
//   frozen and declared      the known condition. Reported, not failed.
//   frozen and NOT declared  a market on the covered list that nobody knows is
//                            dead. Fails: this is the original bug.
//   declared and PUBLISHING  the feed came back and we are still withholding a
//                            market from a paying client. Fails, and the fix is
//                            to DELETE the entry rather than edit it.
//
// The third case is the one an exclusion rule cannot be trusted without. A
// suppression with no expiry is how a market stays hidden for a year after its
// source recovered, and nothing else in the system would ever ask.
//
// It exits non-zero when a configured jurisdiction is more than STALE_MONTHS
// behind and undeclared, or when a declared one has recovered, so it can gate a
// run rather than only inform one.

import { pathToFileURL } from 'node:url';
import { DEFAULT_JURISDICTIONS } from './sources/legistar-jurisdictions';
import { DEAD_FEEDS, deadFeedForClient } from '../../lib/dead-feeds';
import { isRetiredMarket } from '../../lib/coverage';

const UA = 'Mozilla/5.0 (compatible; philipkwong-agents/1.0 +scraper)';
const BASE = 'https://webapi.legistar.com/v1';

// A jurisdiction with nothing newer than this is not being read, whatever it
// returns. Twelve months rather than three: municipal calendars have genuine
// quiet seasons, and the failure this catches is measured in years.
export const STALE_MONTHS = 12;

// Reported but not failed. A market can be genuinely quiet for a quarter.
const QUIET_MONTHS = 3;

interface Reading {
  client: string;
  label: string;
  status: number;
  newestMatter: string | null;
  newestEvent: string | null;
  lastTwelveMonths: number | null;
  verdict: 'live' | 'quiet' | 'STALE' | 'NO MATTERS' | 'UNREADABLE';
}

async function json(url: string, timeoutMs = 90_000): Promise<{ status: number; rows: unknown[] | null }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) return { status: res.status, rows: null };
    const body = await res.text();
    try {
      const parsed = JSON.parse(body);
      return { status: res.status, rows: Array.isArray(parsed) ? parsed : [] };
    } catch {
      return { status: res.status, rows: null };
    }
  } catch {
    return { status: 0, rows: null };
  } finally {
    clearTimeout(timer);
  }
}

function monthsAgo(n: number, now: Date): string {
  const d = new Date(now);
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

export async function readJurisdiction(
  client: string,
  label: string,
  now = new Date()
): Promise<Reading> {
  const staleCutoff = monthsAgo(STALE_MONTHS, now);
  const quietCutoff = monthsAgo(QUIET_MONTHS, now);

  const newest = await json(`${BASE}/${client}/Matters?$orderby=MatterIntroDate%20desc&$top=1`);
  const events = await json(`${BASE}/${client}/Events?$orderby=EventDate%20desc&$top=1`);
  const recent = await json(
    `${BASE}/${client}/Matters?$filter=MatterIntroDate%20gt%20datetime%27${staleCutoff}%27&$top=1000`
  );

  const newestMatter =
    newest.rows && newest.rows.length
      ? String((newest.rows[0] as { MatterIntroDate?: string }).MatterIntroDate ?? '').slice(0, 10) || null
      : null;
  const newestEvent =
    events.rows && events.rows.length
      ? String((events.rows[0] as { EventDate?: string }).EventDate ?? '').slice(0, 10) || null
      : null;

  let verdict: Reading['verdict'];
  if (!newest.rows) verdict = 'UNREADABLE';
  else if (!newestMatter) verdict = 'NO MATTERS';
  else if (newestMatter < staleCutoff) verdict = 'STALE';
  else if (newestMatter < quietCutoff) verdict = 'quiet';
  else verdict = 'live';

  return {
    client,
    label,
    status: newest.status,
    newestMatter,
    newestEvent,
    lastTwelveMonths: recent.rows ? recent.rows.length : null,
    verdict,
  };
}

async function main(): Promise<void> {
  const now = new Date();
  console.log('===== ARE WE READING A DEAD FEED? =====');
  console.log(
    `today ${now.toISOString().slice(0, 10)}   stale past ${monthsAgo(STALE_MONTHS, now)} ` +
      `(${STALE_MONTHS} months)\n`
  );
  console.log('client                  http  newest matter  last12m  newest event  verdict    declared');
  console.log('-'.repeat(94));

  const readings: Reading[] = [];
  for (const j of DEFAULT_JURISDICTIONS) {
    const r = await readJurisdiction(j.client, j.jurisdictionLabel, now);
    readings.push(r);
    const declared = deadFeedForClient(r.client);
    console.log(
      `${r.client.padEnd(23)} ${String(r.status).padStart(4)}  ${(r.newestMatter ?? '-').padEnd(13)} ` +
        `${String(r.lastTwelveMonths ?? '-').padStart(7)}  ${(r.newestEvent ?? '-').padEnd(12)}  ` +
        `${r.verdict.padEnd(9)}  ${declared ? `yes (${declared.frozenSince})` : '-'}`
    );
  }

  const dead = readings.filter((r) => r.verdict === 'STALE' || r.verdict === 'NO MATTERS');
  const unreadable = readings.filter((r) => r.verdict === 'UNREADABLE');
  let failures = 0;

  // ---- 1. FROZEN AND UNDECLARED. The original bug. -----------------------
  console.log('');
  const undeclared = dead.filter((r) => !deadFeedForClient(r.client));
  const known = dead.filter((r) => deadFeedForClient(r.client));
  for (const r of undeclared) {
    failures++;
    const behind = r.newestMatter
      ? Math.round((now.getTime() - Date.parse(r.newestMatter)) / (30.44 * 24 * 3600 * 1000))
      : null;
    console.log(
      `UNDECLARED DEAD FEED: ${r.label} - newest matter ${r.newestMatter ?? 'none'}` +
        (behind ? `, ${Math.floor(behind / 12)}y ${behind % 12}m behind` : '') +
        '\n  This market is on the covered list and nothing is reading it. Declare it in ' +
        'lib/dead-feeds so client documents hold it out and say so.'
    );
  }
  for (const r of known) {
    const f = deadFeedForClient(r.client)!;
    console.log(
      `declared dead, unchanged: ${r.label} - newest matter ${r.newestMatter ?? 'none'}, ` +
        `declared frozen since ${f.frozenSince}, measured ${f.measured}.`
    );
  }

  // ---- 2. DECLARED AND PUBLISHING AGAIN. The expiry. ---------------------
  //
  // Checked over the whole declaration rather than over the readings, so an
  // entry naming a client that is no longer configured is caught too: a
  // declaration nothing probes is a market withheld on the strength of a fact
  // nobody is checking.
  for (const f of DEAD_FEEDS) {
    const r = readings.find((x) => x.client === f.client);
    if (!r) {
      // A RETIRED MARKET IS THE THIRD STATE, and without it this check was
      // wrong in a way that pushed towards the worse fix.
      //
      // The rule below is right for a market we still CLAIM: withholding one on
      // an unprobed fact is a document shaped by something nobody measures. But
      // a market that has left the covered table is not being withheld from a
      // client, it is not being sold to them, and there is no jurisdiction left
      // to probe BECAUSE we stopped reading it. Demanding a probe here would
      // force one of two bad answers: put the dead client back in
      // DEFAULT_JURISDICTIONS so a request is made on every run for documents we
      // have decided not to sell, or delete the dead-feeds entry and lose the
      // withholding language that keeps its old records out of a document.
      //
      // So a declaration is only unprobed if its market is still claimed. The
      // entry stays, the language stays, and RETIRED_MARKETS carries the reason
      // with the date of the newest document the feed ever gave us.
      if (isRetiredMarket(f.market)) {
        console.log(
          `retired, not probed: ${f.market} (${f.client}) left the covered-markets table. Its ` +
            `dead-feed entry is kept for the withholding language; see RETIRED_MARKETS.`
        );
        continue;
      }
      failures++;
      console.log(
        `DECLARATION WITH NO PROBE: ${f.market} names client "${f.client}", which is not in ` +
          `DEFAULT_JURISDICTIONS. Nothing measures this entry, and it is withholding a market from ` +
          `client documents. Point it at a configured client or remove it.`
      );
      continue;
    }
    if (r.verdict === 'live' || r.verdict === 'quiet') {
      failures++;
      console.log(
        `DECLARED DEAD BUT PUBLISHING: ${f.market} (${f.client}) - newest matter ${r.newestMatter}, ` +
          `${r.lastTwelveMonths} in the last twelve months.\n` +
          `  Its declaration says frozen since ${f.frozenSince}, and it removes when: ` +
          `${f.revivesWhen.replace(/\s+/g, ' ')}\n` +
          `  That condition is met. DELETE the entry in lib/dead-feeds - a market withheld from a ` +
          `paying client after its source recovered is the same silent absence, wearing the other sign.`
      );
    }
  }

  // ---- 3. UNREADABLE. Fails, as it did before this check grew a declaration.
  //
  // It may be a transient network fault rather than a dead jurisdiction, and it
  // still fails: the claim this check exists to defend is "we know this market
  // is live", and a request that did not answer does not support it. A run that
  // could not measure a market must not report the same word as a run that
  // measured it and found it moving.
  for (const r of unreadable) {
    failures++;
    console.log(
      `UNREADABLE: ${r.label} - the API did not answer (HTTP ${r.status}). This is not proof the ` +
        `feed is dead; it is the absence of proof that it is alive. Re-run before acting on it.`
    );
  }

  console.log('');
  if (failures === 0) {
    console.log(
      `PASS: ${readings.length - dead.length} of ${readings.length} configured jurisdictions have ` +
        `filed within ${STALE_MONTHS} months, and every frozen one is declared in lib/dead-feeds.`
    );
    return;
  }
  console.log(
    `FAIL: ${failures} feed${failures === 1 ? '' : 's'} ${failures === 1 ? 'is' : 'are'} not in the ` +
      `state the code claims. A jurisdiction on the covered-markets table with a dead feed is a ` +
      `document describing the past; a declared market whose feed came back is coverage we are ` +
      `withholding for no reason. See docs/COVERAGE-MAP.md.`
  );
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
