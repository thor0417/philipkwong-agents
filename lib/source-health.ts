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

/**
 * 'captured'        the newest run read this market and kept records
 * 'silent'          the newest run READ this market and kept nothing
 * 'not-in-run'      the newest run did not cover this market at all
 * 'never-recorded'  no run on record has ever kept anything here
 */
export type CaptureState = 'captured' | 'silent' | 'not-in-run' | 'never-recorded';

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

// ---- A RUN IS NOT AN INSTANT ------------------------------------------------
//
// persistSourceRuns inserts one batch at the end of a lane, so every row from
// one lane shares a run_at to the microsecond - and a capture is often more than
// one lane. Measured on the stored table 2026-09-07: the 2026-09-02 capture
// wrote the legistar rows at 10:04:34 and the anaheim rows at 11:06:49, 62
// minutes apart, and the 2026-08-22 capture wrote at 13:59, 14:00 and 14:10.
//
// Exact equality against the single newest timestamp therefore assigned the
// whole capture to its LAST lane, and every market the earlier lanes had read
// fell outside it. See the defect note on captureByMarket for what that printed.
//
// TWELVE HOURS, and the number is taken from those measurements rather than
// picked: the longest observed gap inside one capture is 62 minutes and the
// shortest gap between captures in the whole table is days. Anything between two
// hours and a day gives the same answer on every row this table holds.
const RUN_WINDOW_MS = 12 * 60 * 60 * 1000;

function sameRun(a: string, b: string): boolean {
  const t = Date.parse(a);
  const u = Date.parse(b);
  if (!Number.isFinite(t) || !Number.isFinite(u)) return a === b;
  return Math.abs(t - u) <= RUN_WINDOW_MS;
}

/**
 * Judge each market against the run history.
 *
 * THE COMPARISON IS AGAINST THE NEWEST RUN, not against a clock. A market is
 * silent when the machine ran, READ THIS MARKET, and kept nothing. Comparing to
 * "today" would report every market as failing whenever nobody had run the
 * scraper for a week, which is a fact about Philip's calendar and not about any
 * feed.
 *
 * ---- THE DEFECT THIS SHAPE PRODUCED, FOUND 2026-09-07 ---------------------
 *
 * The first version had three states and no idea what the newest run COVERED.
 * It marked a market silent whenever its newest capture row was not the newest
 * row in the table, so a scoped run - `scrape:government --source=anaheim-agendas`,
 * a real and correct thing to run - made every market it did not touch look like
 * a capture failure. The sentence printed in a CLIENT DOCUMENT read:
 *
 *   "Our last capture run, on 2026-09-02, recorded nothing for these markets:
 *    Clark County (last captured 2026-09-02, 282 records); ..."
 *
 * Recorded nothing, on the run where it kept 282. It named seven markets and was
 * wrong about all seven. That is standing rule 3's own machinery producing a
 * dishonest negative: the sentence that exists so a gap is never silent was
 * inventing gaps.
 *
 * ---- THE FOURTH STATE, AND WHY THE COLUMNS ALREADY SUPPORT IT -------------
 *
 * government.ts already writes a `market:<name>` row with kept 0 for every
 * market a run DECLARED and which produced nothing - its own comment says "a
 * market that produced nothing is not a market that was not run". So the newest
 * run's rows name its scope, and a market with no row in that run was not read
 * by it. That is `not-in-run`: neither a success nor a failure, and it must not
 * be reported as either.
 *
 * Rows whose market is NULL cannot speak for a market and are used ONLY to
 * establish when the newest run happened.
 */
export function captureByMarket(
  rows: readonly HealthRow[],
  markets: readonly string[]
): MarketCapture[] {
  const newest = newestRun(rows);
  const inNewestRun = newest === null ? [] : rows.filter((r) => r.run_at && sameRun(r.run_at, newest));
  const readByNewest = new Set(inNewestRun.map((r) => r.market).filter((m): m is string => !!m));
  const out: MarketCapture[] = [];

  for (const market of [...new Set(markets.filter(Boolean))].sort()) {
    const kept = rows.filter((r) => r.market === market && r.kept > 0);
    let best: HealthRow | null = kept.length ? kept[0] : null;
    for (const r of kept) if (best && r.run_at > best.run_at) best = r;

    if (!readByNewest.has(market)) {
      // The newest run did not cover this market. What can still be said is when
      // it was last read, or that it never was.
      out.push(
        best
          ? { market, state: 'not-in-run', lastCapture: best.run_at, keptThen: best.kept }
          : { market, state: 'never-recorded', lastCapture: null, keptThen: 0 }
      );
      continue;
    }

    // The newest run DID cover it. Did it keep anything?
    if (inNewestRun.some((r) => r.market === market && r.kept > 0) && best) {
      out.push({ market, state: 'captured', lastCapture: best.run_at, keptThen: best.kept });
      continue;
    }
    out.push(
      best
        ? { market, state: 'silent', lastCapture: best.run_at, keptThen: best.kept }
        : { market, state: 'never-recorded', lastCapture: null, keptThen: 0 }
    );
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
 * A MARKET THE NEWEST RUN DID NOT READ. Its own sentence, because it is neither
 * a success nor a failure and reporting it as either is a false statement about
 * our coverage in one direction or the other.
 *
 * A scoped run is a normal thing to do - one adapter, one market, after a fix -
 * and it must not make every other market look broken. It must not make them
 * look current either: the reader is entitled to the date.
 */
export function notInRunNote(caps: readonly MarketCapture[], newestRunAt: string | null): string {
  const out = caps.filter((c) => c.state === 'not-in-run');
  if (out.length === 0) return '';
  const named = out
    .map((c) => `${c.market} (last read ${day(c.lastCapture)}, ${c.keptThen} record${c.keptThen === 1 ? '' : 's'})`)
    .join('; ');
  const one = out.length === 1;
  return (
    `Our last capture run, on ${day(newestRunAt)}, was scoped and did not read ` +
    `${one ? 'this market' : 'these markets'}: ${named}. ` +
    `${one ? 'It is' : 'They are'} in this document on what we held at the date shown. ` +
    `That is not a failure of the feed and not a statement that nothing was filed.`
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
