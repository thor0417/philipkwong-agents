// THE PERIOD. One definition of "when", shared by Today, the Register and the
// reports composer.
//
// WHAT WAS MISSING. Rolling windows existed - 7 days, 30 days, since last visit
// - and a rolling window can only ever answer "recently". It cannot answer the
// question a client asks, which is about a period that has already closed:
// "what happened in July". A monthly retainer is billed against a month, and a
// report that covers "the last 30 days" from whenever it happened to be
// generated covers a different month every time it runs.
//
// So a period here is one of two shapes:
//
//   OPEN    a rolling window ending now. Moves as time passes.
//   CLOSED  a named month, a week, a custom range. Fixed forever, which is what
//           makes a document reproducible and a delivery record meaningful.
//
// HALF-OPEN BOUNDS, ALWAYS. [since, until) - since inclusive, until exclusive.
// This is not pedantry, it is the only way the arithmetic adds up: with
// inclusive ends, an event at 12:00 on the last day either lands in both
// adjacent periods or in neither, depending on whether the bound is compared as
// a date or a timestamp. July's weeks then do not sum to July, and the brief's
// consistency check fails for a reason that has nothing to do with the data.
// Every bound below is a full ISO timestamp for the same reason: comparing a
// timestamptz column against the bare string '2026-08-01' silently means
// midnight, and drops the last day.
//
// UTC THROUGHOUT. The database stores timestamptz; the demo machine is on
// Pacific time. Computing "the start of July" in local time asks Postgres for
// everything from 1 July 07:00 UTC, which quietly loses the first seven hours of
// the month, and gains them at the other end. There is no browser-local date
// arithmetic anywhere in this file.

export type PeriodAxis = 'arrived' | 'moved';

export const PERIOD_AXES: { key: PeriodAxis; label: string; help: string }[] = [
  {
    key: 'arrived',
    label: 'Arrived',
    help: 'When we captured it. leads.first_seen and projects.first_seen.',
  },
  {
    key: 'moved',
    label: 'Moved',
    help: 'When something happened to it. project_events.occurred_at.',
  },
];

export interface ResolvedPeriod {
  // The URL token this resolved from, so a period round-trips through a link.
  key: string;
  label: string;
  // Half-open [since, until). Either may be absent: a rolling window has no
  // upper bound, and 'all' has neither.
  since?: string;
  until?: string;
  // A closed period cannot move. Documents generated against one are
  // reproducible; documents generated against an open one are not, and the
  // composer says so on the cover.
  closed: boolean;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

// Midnight UTC on the given calendar day.
function utcDay(y: number, m: number, d: number): number {
  return Date.UTC(y, m, d, 0, 0, 0, 0);
}

function startOfUtcDay(at: Date): number {
  return utcDay(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
}

// ISO weeks start on Monday. Stated rather than assumed: a week that starts on
// Sunday puts Monday's filings in the previous week, and every count shifts.
function startOfIsoWeek(at: Date): number {
  const day = at.getUTCDay(); // 0 = Sunday
  const back = day === 0 ? 6 : day - 1;
  return startOfUtcDay(at) - back * 86_400_000;
}

function addDays(ms: number, n: number): number {
  return ms + n * 86_400_000;
}

function monthLabel(y: number, m: number): string {
  return `${MONTHS[m]} ${y}`;
}

// ---- The tokens ---------------------------------------------------------------
//
// A period is ONE url parameter, so a filtered screen stays a link. The grammar
// is deliberately readable in an address bar:
//
//   all | 24h | 7d | 30d | visit      rolling, open
//   this-week | this-month | last-month
//   m:2026-07                          a named month
//   c:2026-07-01..2026-07-07           a custom range, both ends inclusive DAYS

export const ROLLING_PERIODS: { key: string; label: string }[] = [
  { key: 'visit', label: 'Since last visit' },
  { key: '24h', label: '24 hours' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
];

export const CALENDAR_PERIODS: { key: string; label: string }[] = [
  { key: 'this-week', label: 'This week' },
  { key: 'this-month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
];

export const DEFAULT_PERIOD = '30d';

/** The last N named months, newest first, as selectable tokens. */
export function recentMonths(now: Date, count = 12): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth();
  for (let i = 0; i < count; i++) {
    out.push({ key: `m:${y}-${String(m + 1).padStart(2, '0')}`, label: monthLabel(y, m) });
    m -= 1;
    if (m < 0) {
      m = 11;
      y -= 1;
    }
  }
  return out;
}

const MONTH_TOKEN = /^m:(\d{4})-(\d{2})$/;
const CUSTOM_TOKEN = /^c:(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/;

export function customToken(fromDay: string, toDay: string): string {
  return `c:${fromDay}..${toDay}`;
}

/**
 * Resolve a token to bounds.
 *
 * `visitSince` is supplied by the caller because "since last visit" is a
 * property of the browser, not of the calendar, and this module refuses to read
 * localStorage: a pure function is what lets the boundary arithmetic be tested
 * and what keeps the same period resolving identically on a server render.
 *
 * An unrecognised token resolves to the default rather than throwing. A bad URL
 * should show a screen, not a stack trace.
 */
export function resolvePeriod(
  token: string | null | undefined,
  now: Date,
  visitSince?: string
): ResolvedPeriod {
  const key = (token ?? DEFAULT_PERIOD).trim();
  const nowMs = now.getTime();

  if (key === 'all') return { key: 'all', label: 'All time', closed: false };

  if (key === 'visit') {
    return {
      key,
      label: 'Since last visit',
      since: visitSince,
      closed: false,
    };
  }

  const rolling: Record<string, number> = { '24h': 1, '7d': 7, '30d': 30 };
  if (key in rolling) {
    return {
      key,
      label: ROLLING_PERIODS.find((p) => p.key === key)?.label ?? key,
      since: iso(nowMs - rolling[key] * 86_400_000),
      closed: false,
    };
  }

  if (key === 'this-week') {
    const start = startOfIsoWeek(now);
    return {
      key,
      label: `Week of ${iso(start).slice(0, 10)}`,
      since: iso(start),
      // No upper bound: this week has not finished, and pretending it has would
      // put a closed label on an open period.
      closed: false,
    };
  }

  if (key === 'this-month') {
    const start = utcDay(now.getUTCFullYear(), now.getUTCMonth(), 1);
    return {
      key,
      label: `${monthLabel(now.getUTCFullYear(), now.getUTCMonth())} to date`,
      since: iso(start),
      closed: false,
    };
  }

  if (key === 'last-month') {
    const y = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
    const m = now.getUTCMonth() === 0 ? 11 : now.getUTCMonth() - 1;
    return {
      key,
      label: monthLabel(y, m),
      since: iso(utcDay(y, m, 1)),
      until: iso(utcDay(m === 11 ? y + 1 : y, m === 11 ? 0 : m + 1, 1)),
      closed: true,
    };
  }

  const mm = MONTH_TOKEN.exec(key);
  if (mm) {
    const y = Number(mm[1]);
    const m = Number(mm[2]) - 1;
    if (m >= 0 && m <= 11) {
      const start = utcDay(y, m, 1);
      const end = utcDay(m === 11 ? y + 1 : y, m === 11 ? 0 : m + 1, 1);
      return {
        key,
        label: monthLabel(y, m),
        since: iso(start),
        until: iso(end),
        // A month in the future or still running is not closed, and a document
        // must not claim to cover a period that has not happened.
        closed: end <= nowMs,
      };
    }
  }

  const cm = CUSTOM_TOKEN.exec(key);
  if (cm) {
    const [, a, b] = cm;
    // Both ends are given as DAYS and both are inclusive, because that is what a
    // person means by "1 July to 7 July". The exclusive bound is the day after.
    const lo = Date.parse(`${a}T00:00:00.000Z`);
    const hiDay = Date.parse(`${b}T00:00:00.000Z`);
    if (!Number.isNaN(lo) && !Number.isNaN(hiDay) && hiDay >= lo) {
      const hi = addDays(hiDay, 1);
      return {
        key,
        label: a === b ? a : `${a} to ${b}`,
        since: iso(lo),
        until: iso(hi),
        closed: hi <= nowMs,
      };
    }
  }

  return resolvePeriod(DEFAULT_PERIOD, now, visitSince);
}

/**
 * The weeks of a period, as tokens. Used to prove that the parts sum to the
 * whole, and to drive week bucketing.
 *
 * Weeks are CLIPPED to the period rather than extended past it: the first and
 * last are partial, and a clipped week is why the sum is exactly the month
 * rather than the month plus a few days either side.
 */
export function weeksIn(p: ResolvedPeriod): { key: string; label: string; since: string; until: string }[] {
  if (!p.since || !p.until) return [];
  const lo = Date.parse(p.since);
  const hi = Date.parse(p.until);
  const out: { key: string; label: string; since: string; until: string }[] = [];
  let cursor = startOfIsoWeek(new Date(lo));
  while (cursor < hi) {
    const weekEnd = addDays(cursor, 7);
    const since = Math.max(cursor, lo);
    const until = Math.min(weekEnd, hi);
    if (until > since) {
      out.push({
        key: customToken(iso(since).slice(0, 10), iso(addDays(until, -1)).slice(0, 10)),
        label: `Week of ${iso(since).slice(0, 10)}`,
        since: iso(since),
        until: iso(until),
      });
    }
    cursor = weekEnd;
  }
  return out;
}

// ---- Bucketing ----------------------------------------------------------------
//
// A period reads as a sequence, not a flat list. The bucket is derived from the
// SAME date the period filters on, or the grouping would describe one axis while
// the filter used another.

export type BucketMode = 'none' | 'week' | 'month';

export const BUCKETS: { key: BucketMode; label: string }[] = [
  { key: 'none', label: 'Flat' },
  { key: 'week', label: 'By week' },
  { key: 'month', label: 'By month' },
];

export function bucketOf(dateIso: string | null | undefined, mode: BucketMode): string {
  if (mode === 'none' || !dateIso) return '';
  const at = new Date(dateIso);
  if (Number.isNaN(at.getTime())) return 'Undated';
  if (mode === 'month') return monthLabel(at.getUTCFullYear(), at.getUTCMonth());
  return `Week of ${iso(startOfIsoWeek(at)).slice(0, 10)}`;
}
