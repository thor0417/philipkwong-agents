'use client';

// THE WORLD CLOCK STRIP.
//
// Five markets, because a call placed into the wrong local morning is a real
// cost and the answer should not require arithmetic. Times are mono, which is
// the whole reason the strip stays readable at this size: five proportional
// clocks jitter on every minute tick, five tabular ones do not move at all.
//
// NOTE ON THE FIVE. Vancouver, Las Vegas and Anaheim are all Pacific, so three
// of the five always read the same. That is not a bug and they are shown
// separately on purpose: the strip answers "what time is it in this market",
// and making the operator remember which markets share a zone is exactly the
// arithmetic it exists to remove.

import { useEffect, useState } from 'react';
import styles from './WorldClock.module.css';

const CITIES: { code: string; label: string; tz: string }[] = [
  { code: 'BKK', label: 'Bangkok', tz: 'Asia/Bangkok' },
  { code: 'YVR', label: 'Vancouver', tz: 'America/Vancouver' },
  { code: 'LAS', label: 'Las Vegas', tz: 'America/Los_Angeles' },
  { code: 'ANA', label: 'Anaheim', tz: 'America/Los_Angeles' },
  { code: 'MCO', label: 'Orlando', tz: 'America/New_York' },
];

function timeIn(tz: string, at: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}

/** Whether the market is inside a plausible working day, for the muted state. */
function isAwake(tz: string, at: Date): boolean {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(at)
  );
  return hour >= 8 && hour < 19;
}

export default function WorldClock() {
  // Null until mounted. Rendering a server time would hydrate against a
  // different client time and React would (correctly) complain; more to the
  // point, the server's clock is not the reader's.
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    // Aligned to the next minute boundary rather than a 60s drift from mount,
    // so the strip ticks when the minute actually changes.
    let interval: ReturnType<typeof setInterval>;
    const timeout = setTimeout(() => {
      setNow(new Date());
      interval = setInterval(() => setNow(new Date()), 60_000);
    }, 60_000 - (Date.now() % 60_000));
    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, []);

  return (
    <div className={styles.strip} aria-label="Market times">
      {CITIES.map((c) => {
        const awake = now ? isAwake(c.tz, now) : false;
        return (
          <div
            key={c.code}
            className={`${styles.clock} ${awake ? styles.awake : ''}`}
            title={`${c.label} local time`}
          >
            <span className={styles.code}>{c.code}</span>
            <span className={styles.time}>{now ? timeIn(c.tz, now) : '--:--'}</span>
          </div>
        );
      })}
    </div>
  );
}
