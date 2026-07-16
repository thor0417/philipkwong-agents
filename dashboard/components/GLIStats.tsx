'use client';

import type { GLILead } from '@/lib/types';
import { GLI_SIGNAL_ORDER } from '@/lib/types';
import styles from './GLIStats.module.css';

// Stats scoped to the ACTIVE stream. `leads` is the exact set the table renders
// (active stream + all active filters), so every number here matches the visible
// rows. Headline = rows in view; the strip breaks them down by signal_type (a
// dimension the filters do not touch), and the counts sum to the headline.
export default function GLIStats({
  leads,
  streamLabel,
}: {
  leads: GLILead[];
  streamLabel: string;
}) {
  const counts: Record<string, number> = {};
  for (const l of leads) {
    if (l.signal_type) counts[l.signal_type] = (counts[l.signal_type] ?? 0) + 1;
  }
  const signals = GLI_SIGNAL_ORDER.filter((s) => counts[s] > 0).map(
    (s) => [s, counts[s]] as [string, number]
  );

  return (
    <section className={styles.wrap}>
      <div className={styles.total}>
        <div className={styles.value}>{leads.length}</div>
        <div className={styles.label}>{streamLabel} in view</div>
      </div>
      {signals.length > 0 && (
        <div className={styles.strip}>
          {signals.map(([signal, count]) => (
            <span className={styles.item} key={signal}>
              <span className={styles.itemValue}>{count}</span>
              <span className={styles.itemLabel}>{signal}</span>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
