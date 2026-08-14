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
// It exits non-zero when a configured jurisdiction is more than STALE_MONTHS
// behind, so it can gate a run rather than only inform one.

import { pathToFileURL } from 'node:url';
import { DEFAULT_JURISDICTIONS } from './sources/legistar-jurisdictions';

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
  console.log('client                  http  newest matter  last12m  newest event  verdict');
  console.log('-'.repeat(84));

  const readings: Reading[] = [];
  for (const j of DEFAULT_JURISDICTIONS) {
    const r = await readJurisdiction(j.client, j.jurisdictionLabel, now);
    readings.push(r);
    console.log(
      `${r.client.padEnd(23)} ${String(r.status).padStart(4)}  ${(r.newestMatter ?? '-').padEnd(13)} ` +
        `${String(r.lastTwelveMonths ?? '-').padStart(7)}  ${(r.newestEvent ?? '-').padEnd(12)}  ${r.verdict}`
    );
  }

  const dead = readings.filter((r) => r.verdict === 'STALE' || r.verdict === 'NO MATTERS');
  const unreadable = readings.filter((r) => r.verdict === 'UNREADABLE');

  console.log('');
  if (dead.length === 0 && unreadable.length === 0) {
    console.log(`All ${readings.length} configured jurisdictions have filed within ${STALE_MONTHS} months.`);
    return;
  }
  for (const r of dead) {
    const behind = r.newestMatter
      ? Math.round((now.getTime() - Date.parse(r.newestMatter)) / (30.44 * 24 * 3600 * 1000))
      : null;
    console.log(
      `DEAD FEED: ${r.label} - newest matter ${r.newestMatter ?? 'none'}` +
        (behind ? `, ${Math.floor(behind / 12)}y ${behind % 12}m behind` : '')
    );
  }
  for (const r of unreadable) {
    console.log(`UNREADABLE: ${r.label} - the API did not answer (HTTP ${r.status}).`);
  }
  console.log(
    '\nA jurisdiction on the covered-markets table with a dead feed is a document ' +
      'describing the past. See docs/COVERAGE-MAP.md.'
  );
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
