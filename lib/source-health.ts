// WHAT THE LAST RUN ACTUALLY CAPTURED, PER MARKET.
//
// Brief S item 2. Until now a document read a DECLARATION and never a
// MEASUREMENT: report-build calls deadFeedForMarket out of lib/dead-feeds, a
// hand-maintained list of markets whose publisher has stopped, and nothing on
// the document path had ever read source_health. So the Today screen could say
// "nyc-ceqr 14d silent, 122 records" while a document generated the same minute
// said nothing at all. The dashboard saw the machine; the client did not.
//
// IMPORT-FREE, so both packages read one copy. Same rule and the same reason as
// lib/dead-feeds and lib/market-standard: a mirrored copy goes stale, and the
// stale half is the one that decides what a client is told.
//
// THREE STATES, AND THEY ARE THREE DIFFERENT SENTENCES. Collapsing them is the
// whole defect this file exists to prevent:
//
//   captured        a run kept records for this market, and it was the newest
//                   run. Nothing to say.
//   silent          this market HAS capture history and kept nothing on the
//                   newest run. Something changed this week. Say it, with the
//                   date of the last run that did keep something.
//   never recorded  no run has ever recorded a capture for this market. That is
//                   NOT a failure and must never be printed as one: it is what
//                   every market looks like before migration 044 is applied,
//                   and it is also what a market legitimately looks like after
//                   a scoped run that did not touch it.
//
// AND NONE OF THE THREE IS "we have never read this market deeply". That is a
// property of the READERS, not of the run, and it is lib/market-standard's
// sentence. A market can be captured perfectly every week and still be below
// standard, which is exactly what Phoenix and Las Vegas are.

/** One source_health row, as the document path reads it. */
export interface HealthRow {
  /** NULL on every row written before migration 044. NULL is not zero. */
  market: string | null;
  /** ISO timestamp. */
  run_at: string;
  kept: number;
}

export type CaptureState = 'captured' | 'silent' | 'never-recorded';

export interface MarketCapture {
  market: string;
  state: CaptureState;
  /** ISO date of the newest run that kept anything here. Null when never. */
  lastCapture: string | null;
  /** How many records that run kept. */
  keptThen: number;
}

/** The newest run_at across every row, market-attributed or not. */
export function newestRun(rows: readonly HealthRow[]): string | null {
  let newest: string | null = null;
  for (const r of rows) {
    if (!r.run_at) continue;
    if (newest === null || r.run_at > newest) newest = r.run_at;
  }
  return newest;
}

/**
 * Judge each market against the run history.
 *
 * THE COMPARISON IS AGAINST THE NEWEST RUN OVERALL, not against a clock. A
 * market is silent when the machine ran and this market produced nothing, which
 * is a fact about the run. Comparing to "today" would report every market as
 * failing whenever nobody had run the scraper for a week, which is a fact about
 * Philip's calendar and not about any feed.
 *
 * Rows whose market is NULL cannot speak for a market and are used ONLY to
 * establish when the newest run happened.
 */
export function captureByMarket(
  rows: readonly HealthRow[],
  markets: readonly string[]
): MarketCapture[] {
  const newest = newestRun(rows);
  const out: MarketCapture[] = [];

  for (const market of [...new Set(markets.filter(Boolean))].sort()) {
    const mine = rows.filter((r) => r.market === market && r.kept > 0);
    if (mine.length === 0) {
      out.push({ market, state: 'never-recorded', lastCapture: null, keptThen: 0 });
      continue;
    }
    let best = mine[0];
    for (const r of mine) if (r.run_at > best.run_at) best = r;
    // Same run as the newest one the machine did: this market is current.
    const current = newest !== null && best.run_at === newest;
    out.push({
      market,
      state: current ? 'captured' : 'silent',
      lastCapture: best.run_at,
      keptThen: best.kept,
    });
  }
  return out;
}

const day = (iso: string | null): string => (iso ? iso.slice(0, 10) : 'an unrecorded date');

/**
 * THE SENTENCE A CLIENT DOCUMENT PRINTS, and it says which of the three states
 * it is describing rather than leaving a reader to guess.
 *
 * It states, it does not refuse. A refusal turns a source outage into a product
 * outage and the client gets nothing instead of something honest.
 */
export function captureGapNote(caps: readonly MarketCapture[], newestRunAt: string | null): string {
  const silent = caps.filter((c) => c.state === 'silent');
  if (silent.length === 0) return '';
  const named = silent
    .map((c) => `${c.market} (last captured ${day(c.lastCapture)}, ${c.keptThen} record${c.keptThen === 1 ? '' : 's'})`)
    .join('; ');
  const one = silent.length === 1;
  return (
    `Our last capture run, on ${day(newestRunAt)}, recorded nothing for ` +
    `${one ? 'this market' : 'these markets'}: ${named}. ` +
    `${one ? 'That market is' : 'Those markets are'} in this document on what we already held, ` +
    `and anything filed there since the date shown is not in it. This is a failure of our ` +
    `capture on that run, not a statement that nothing was filed.`
  );
}

/**
 * The other half, and it is deliberately a separate sentence: a market nobody
 * has ever recorded a capture for. Printed only when the run history exists at
 * all, because before migration 044 every market looks like this and a document
 * must not report a missing column as a missing feed.
 */
export function neverRecordedNote(caps: readonly MarketCapture[], historyExists: boolean): string {
  if (!historyExists) return '';
  const never = caps.filter((c) => c.state === 'never-recorded').map((c) => c.market);
  if (never.length === 0) return '';
  const one = never.length === 1;
  const list = one
    ? never[0]
    : never.slice(0, -1).join(', ') + ' and ' + never[never.length - 1];
  return (
    `No capture run on record has kept a record for ${list}. ` +
    `${one ? 'That market appears' : 'Those markets appear'} here on what we held before we ` +
    `began recording per-market capture, so we cannot say when ${one ? 'it was' : 'they were'} last read.`
  );
}
