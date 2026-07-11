'use client';

import type { GLILead } from '@/lib/types';
import { GLI_SIGNAL_ORDER } from '@/lib/types';
import styles from './GLIStats.module.css';

// Signal-type counts in the canonical GLI order, keeping only types present.
function signalCounts(leads: GLILead[]): [string, number][] {
  const counts: Record<string, number> = {};
  for (const l of leads) {
    if (l.signal_type) counts[l.signal_type] = (counts[l.signal_type] ?? 0) + 1;
  }
  return GLI_SIGNAL_ORDER.filter((s) => counts[s] > 0).map((s) => [s, counts[s]]);
}

// Venue-type counts, highest first, keeping only types present. Same pattern as
// the per-module / per-region rows in StatsBar.
function venueCounts(leads: GLILead[]): [string, number][] {
  const counts: Record<string, number> = {};
  for (const l of leads) {
    if (l.venue_type) counts[l.venue_type] = (counts[l.venue_type] ?? 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

export default function GLIStats({ leads }: { leads: GLILead[] }) {
  const signals = signalCounts(leads);
  const venues = venueCounts(leads);

  return (
    <>
      <section className={styles.bar}>
        <div className={styles.cell}>
          <div className={styles.value}>{leads.length}</div>
          <div className={styles.label}>Total GLI Leads</div>
        </div>
      </section>
      {signals.length > 0 && (
        <div className={styles.countsRow}>
          {signals.map(([signal, count]) => (
            <span className={styles.countItem} key={signal}>
              <span className={styles.countLabel}>{signal}</span>
              <span className={styles.countValue}>{count}</span>
            </span>
          ))}
        </div>
      )}
      {venues.length > 0 && (
        <div className={styles.countsRow}>
          {venues.map(([venue, count]) => (
            <span className={styles.countItem} key={venue}>
              <span className={styles.countLabel}>{venue}</span>
              <span className={styles.countValue}>{count}</span>
            </span>
          ))}
        </div>
      )}
    </>
  );
}
