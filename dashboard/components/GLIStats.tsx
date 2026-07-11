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

// Source-tier counts in primary/trade/news order, keeping only tiers present.
const TIER_ORDER: { key: string; label: string }[] = [
  { key: 'primary', label: 'Primary' },
  { key: 'trade', label: 'Trade' },
  { key: 'news', label: 'News' },
];
function tierCounts(leads: GLILead[]): [string, number][] {
  const counts: Record<string, number> = {};
  for (const l of leads) {
    if (l.source_tier) counts[l.source_tier] = (counts[l.source_tier] ?? 0) + 1;
  }
  return TIER_ORDER.filter((t) => counts[t.key] > 0).map((t) => [t.label, counts[t.key]]);
}

export default function GLIStats({ leads }: { leads: GLILead[] }) {
  const signals = signalCounts(leads);
  const venues = venueCounts(leads);
  const tiers = tierCounts(leads);

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
      {tiers.length > 0 && (
        <div className={styles.countsRow}>
          {tiers.map(([tier, count]) => (
            <span className={styles.countItem} key={tier}>
              <span className={styles.countLabel}>{tier}</span>
              <span className={styles.countValue}>{count}</span>
            </span>
          ))}
        </div>
      )}
    </>
  );
}
