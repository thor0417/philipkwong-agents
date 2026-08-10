'use client';

// THE PERIOD SELECTOR. Rolling windows, calendar periods, a named month, and a
// custom range - one control, used by Today, the Register and the composer.
//
// WHY THE BOUNDS ARE PRINTED. The label says "July 2026" and the query asks for
// [2026-07-01T00:00:00Z, 2026-08-01T00:00:00Z). Those are the same statement
// only if the resolver is right, and the one place that is worth checking is the
// screen where a document's coverage is chosen. A control that shows only its
// label asks the operator to trust the arithmetic; showing the bounds lets them
// check it in one glance.
//
// AN OPEN PERIOD SAYS SO. "This month" has not finished. A report generated
// against it is not reproducible - regenerate it tomorrow and it covers more -
// and that is a property the operator has to be able to see before generating,
// not a footnote discovered afterwards.

import { useMemo } from 'react';
import {
  CALENDAR_PERIODS,
  ROLLING_PERIODS,
  customToken,
  recentMonths,
  type ResolvedPeriod,
} from '@/lib/period';
import styles from './PeriodSelector.module.css';

function day(iso: string | undefined): string {
  return iso ? iso.slice(0, 10) : '';
}

// The inclusive last DAY of a half-open period, which is what a person means by
// "to". [1 Jul, 8 Jul) ends on the 7th, and showing the 8th in a date field
// would be a control that disagrees with its own label.
function inclusiveEndDay(p: ResolvedPeriod): string {
  if (!p.until) return '';
  return new Date(Date.parse(p.until) - 86_400_000).toISOString().slice(0, 10);
}

// The end to assume when only a start has been picked: today, or the start day
// itself if that start is in the future. A range is never inverted, and it is
// only one day long when the operator genuinely asked for one day.
function defaultEnd(start: string, now: Date): string {
  const today = now.toISOString().slice(0, 10);
  return today >= start ? today : start;
}

// The start to assume when only an end has been picked: the first of that end's
// month. It is a guess, which is why it is written into the visible input.
function defaultStart(end: string): string {
  return `${end.slice(0, 7)}-01`;
}

export default function PeriodSelector({
  period,
  onChange,
  showRolling = true,
  now,
}: {
  period: ResolvedPeriod;
  onChange: (token: string) => void;
  showRolling?: boolean;
  // Passed in rather than read here, so the caller's single captured clock is
  // the only clock: a component that calls new Date() on render disagrees with
  // the query that was issued a moment earlier.
  now: Date;
}) {
  const months = useMemo(() => recentMonths(now, 12), [now]);
  const isMonth = period.key.startsWith('m:');
  const isCustom = period.key.startsWith('c:');

  const from = isCustom ? day(period.since) : '';
  const to = isCustom ? inclusiveEndDay(period) : '';

  return (
    <div className={styles.wrap}>
      {showRolling && (
        <div className={styles.group}>
          {ROLLING_PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              data-period={p.key}
              className={`${styles.chip} ${period.key === p.key ? styles.chipActive : ''}`}
              onClick={() => onChange(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      <div className={styles.group}>
        {CALENDAR_PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            data-period={p.key}
            className={`${styles.chip} ${period.key === p.key ? styles.chipActive : ''}`}
            onClick={() => onChange(p.key)}
          >
            {p.label}
          </button>
        ))}

        <select
          className={`${styles.select} ${isMonth ? styles.selectActive : ''}`}
          aria-label="Named month"
          data-testid="period-month"
          value={isMonth ? period.key : ''}
          onChange={(e) => e.target.value && onChange(e.target.value)}
        >
          <option value="">Month...</option>
          {months.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      {/* HALF A RANGE IS NOT A ONE-DAY RANGE.
          Both handlers used to fall back to the value just typed for the other
          end, so setting a start date with the end still empty produced
          customToken(x, x) - a period exactly one day long. That is how a
          generated report came to be scoped to a single day, with every section
          reading "no filing in this period" and a basis line of 0 records. The
          operator picked a start date and got a document about one Tuesday.

          A missing end means "until now", which is what a person picking only a
          start date means. A missing start means "since the beginning of that
          month", which is the smallest assumption that still produces a period
          worth reporting on. Both fill the other input visibly, so the guess is
          on screen and can be corrected rather than discovered in the PDF. */}
      <div className={styles.range}>
        <input
          type="date"
          className={styles.date}
          aria-label="Range start"
          data-testid="period-from"
          value={from}
          onChange={(e) => e.target.value && onChange(customToken(e.target.value, to || defaultEnd(e.target.value, now)))}
        />
        <span className={styles.sep}>to</span>
        <input
          type="date"
          className={styles.date}
          aria-label="Range end"
          data-testid="period-to"
          value={to}
          onChange={(e) => e.target.value && onChange(customToken(from || defaultStart(e.target.value), e.target.value))}
        />
      </div>

      <span className={styles.bounds} data-testid="period-bounds">
        {period.since ? day(period.since) : 'all time'}
        {period.until ? ` to ${inclusiveEndDay(period)}` : ''}
      </span>
      {!period.closed && (
        <span className={styles.openMark} title="This period has not closed, so a document generated from it is not reproducible.">
          open
        </span>
      )}
    </div>
  );
}
