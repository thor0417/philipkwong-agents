'use client';

// HEALTH. Whether the things we claim to watch are still being read.
//
// Nineteen sources have gone quiet at one time or another and nothing on any
// screen said so. Two covered markets sat on the list for years - one frozen
// since 2018, one since 2021 - while every run fetched them successfully and
// kept what it fetched, because the only alarm asks "did this source produce?"
// and both of them produce. What neither the alarm nor any screen asked was "is
// what it produces still moving?".
//
// THE TWO DATES ARE THE WHOLE SCREEN, and they answer different questions:
//
//   PUBLISHED  the newest date the SOURCE put on anything we hold. Whether the
//              jurisdiction is still moving.
//   CAPTURED   the newest date WE fetched. Whether we are still reading it.
//
// Fresh capture over an ancient publication is the Miami-Dade signature and it
// is the one that reads as healthy on every other instrument. SFWMD is the live
// example: captured 22 days ago, newest permit 925 days old.
//
// WHAT THIS SCREEN CANNOT SAY. source_health is the run log and it holds one
// row, so "records this run" is unknowable for every lane but the one that has
// written to it. That is printed as unknown rather than as zero: a zero here
// reads as "this source produced nothing this run", which is a much louder
// claim and a false one.

import { useMemo } from 'react';
import { useCoverage } from '@/lib/use-coverage';
import { LIVE_PIPELINE_STORAGE_KEY } from '@/lib/pipelines';
import { COVERAGE_LABEL, STALE_DAYS } from '../../../../lib/coverage';
import styles from './page.module.css';

const QUIET_DAYS = 30;

function ymd(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '--';
}

// A NEGATIVE AGE IS A REAL AND USEFUL FACT, AND IT LOOKS LIKE A BUG.
//
// Legistar holds an agenda for a meeting two days from now; CanadaBuys holds a
// tender whose deadline is in 2029. Both are documents dated in the future, and
// "-959d" in a freshness column reads as arithmetic that has gone wrong. It is
// the freshest possible state, so it is named rather than signed.
function days(n: number | null): string {
  if (n === null) return '--';
  if (n < 0) return 'ahead';
  return `${n}d`;
}

export default function HealthPage() {
  const coverage = useCoverage(LIVE_PIPELINE_STORAGE_KEY);
  const data = coverage.data;

  const quiet = useMemo(
    () => (data?.sources ?? []).filter((s) => (s.newestDocumentDays ?? 0) > QUIET_DAYS),
    [data]
  );

  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <h1 className={styles.title}>Health</h1>
      </div>

      {coverage.isPending ? (
        <p className={styles.dim}>Reading the corpus...</p>
      ) : coverage.isError ? (
        <p className={styles.error} role="alert">
          Coverage could not be read: {(coverage.error as Error).message}
        </p>
      ) : !data ? (
        <p className={styles.dim}>Nothing to report.</p>
      ) : (
        <>
          {/* WHAT THE RUN LOG CANNOT TELL YOU, said before anything derived from
              it. An absent capability stated once at the top is a caveat; the
              same absence discovered halfway down a table is a trap. */}
          {!data.hasRunHistory && (
            <p className={styles.caveat} data-testid="health-no-run-history">
              <strong>source_health holds one row, so there is no run history.</strong> Freshness
              below is read from the records themselves - the newest date each source published,
              and the newest date we captured. &ldquo;This run&rdquo; is therefore unknown for every
              lane but the one that has written, and it is printed as unknown rather than as zero.
              This is the gap that let two markets sit on the covered list for years while frozen.
            </p>
          )}

          {/* ---- COVERED MARKETS ------------------------------------------- */}
          <section className={styles.block}>
            <h2 className={styles.h2}>
              Covered markets <span className="mono">{data.markets.length}</span>
            </h2>
            <p className={styles.lede}>
              A market is here because an adapter is pointed at it, not because the
              corpus holds records naming it. Sorted worst first. A market past{' '}
              <span className="mono">{STALE_DAYS}</span> days on its newest published
              document is stale; one that captures and clusters but names almost
              nobody is thin, because a report scoped to it comes out empty.
            </p>

            <div className={styles.table}>
              <div className={`${styles.headRow} ${styles.marketRow}`} role="row">
                <span>Market</span>
                <span>State</span>
                <span className={styles.num}>Projects</span>
                <span className={styles.num}>Named</span>
                <span className={styles.num}>Records</span>
                <span className={styles.num}>Published</span>
                <span className={styles.num}>Captured</span>
                <span>Why</span>
              </div>
              {data.markets.map((m) => (
                <div
                  key={m.market}
                  className={`${styles.row} ${styles.marketRow}`}
                  role="row"
                  data-market={m.market}
                  data-state={m.coverage.state}
                >
                  <span className={styles.cellName} title={`${m.regionState}, ${m.country} - ${m.layers}`}>
                    {m.market}
                  </span>
                  <span className={styles.state} data-state={m.coverage.state}>
                    {COVERAGE_LABEL[m.coverage.state]}
                  </span>
                  <span className={`${styles.num} mono`}>{m.liveProjects}</span>
                  <span className={`${styles.num} mono`}>{m.projectsNamingAParty}</span>
                  <span className={`${styles.num} mono`}>{m.records}</span>
                  <span className={`${styles.num} mono`} title={ymd(m.newestDocument)}>
                    {days(m.newestDocumentDays)}
                  </span>
                  <span className={`${styles.num} mono`} title={ymd(m.newestCapture)}>
                    {days(m.newestCaptureDays)}
                  </span>
                  <span className={styles.why}>{m.coverage.why}</span>
                </div>
              ))}
            </div>
          </section>

          {/* ---- PRESS-ONLY ------------------------------------------------- */}
          <section className={styles.block}>
            <h2 className={styles.h2}>
              Press-only geographies <span className="mono">{data.press.length}</span>
            </h2>
            <p className={styles.lede}>
              Places a story landed on. No adapter is pointed at any of them and
              nothing here is a market we watch, which is why they are counted
              together rather than listed beside the markets above:{' '}
              <span className="mono">{data.pressProjects}</span> projects and{' '}
              <span className="mono">{data.pressRecords}</span> records. A geography
              tree that showed these as coverage is what this split exists to end.
            </p>
          </section>

          {/* ---- SOURCES ---------------------------------------------------- */}
          <section className={styles.block}>
            <h2 className={styles.h2}>
              Sources <span className="mono">{data.sources.length}</span>
            </h2>
            <p className={styles.lede}>
              <span className="mono">{quiet.length}</span> have published nothing in{' '}
              <span className="mono">{QUIET_DAYS}</span> days. Sorted by that gap. A
              source with a fresh capture and an old publication is being read and is
              not moving - which is the failure nothing in this system could see.
            </p>

            <div className={styles.table}>
              <div className={`${styles.headRow} ${styles.sourceRow}`} role="row">
                <span>Source</span>
                <span className={styles.num}>Records</span>
                <span className={styles.num}>Published</span>
                <span className={styles.num}>Captured</span>
                <span className={styles.num}>This run</span>
                <span>Feeds</span>
              </div>
              {data.sources.map((s) => (
                <div
                  key={s.source}
                  className={`${styles.row} ${styles.sourceRow}`}
                  role="row"
                  data-source={s.source}
                  data-quiet={(s.newestDocumentDays ?? 0) > QUIET_DAYS ? 'yes' : 'no'}
                >
                  <span className={styles.cellName}>
                    {s.source}
                    {s.degraded && (
                      <span
                        className={styles.degradedTag}
                        title={`${s.degraded.reason} Recorded ${s.degraded.recorded}. Alerts again when ${s.degraded.alertsAgainWhen}`}
                      >
                        degraded
                      </span>
                    )}
                  </span>
                  <span className={`${styles.num} mono`}>{s.records}</span>
                  <span className={`${styles.num} mono`} title={ymd(s.newestDocument)}>
                    {days(s.newestDocumentDays)}
                  </span>
                  <span className={`${styles.num} mono`} title={ymd(s.newestCapture)}>
                    {days(s.newestCaptureDays)}
                  </span>
                  {/* Unknown, not zero. See the caveat above. */}
                  <span className={`${styles.num} mono`} title={s.lastRunAt ?? 'no run recorded'}>
                    {s.recordsThisRun === null ? 'unknown' : s.recordsThisRun}
                  </span>
                  <span className={styles.why}>{s.markets.join(', ')}</span>
                </div>
              ))}
            </div>
          </section>

          <p className={styles.foot}>
            Nothing on this screen probes a source. Every figure is the age of what
            we already hold, so an old publication date is a question rather than a
            verdict - the source may have stopped, or it may be publishing somewhere
            we do not read. <span className="mono">npm run verify:staleness</span> asks
            the sources themselves, and it currently reaches only the eight Legistar
            jurisdictions.
          </p>
        </>
      )}
    </div>
  );
}
