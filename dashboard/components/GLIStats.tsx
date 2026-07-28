'use client';

import type { GLILead } from '@/lib/types';
import { GLI_SIGNAL_ORDER } from '@/lib/types';
import styles from './GLIStats.module.css';

// Stats scoped to the ACTIVE stream. `leads` is the current PAGE of rows; the
// signal strip breaks that page down by signal_type. `total` is the exact size
// of the whole filtered set, from an indexed count query, so the headline
// reports the filter rather than the page. The strip is labelled accordingly:
// with pagination the two can differ, and the number must not pretend otherwise.
export default function GLIStats({
  leads,
  streamLabel,
  total,
}: {
  leads: GLILead[];
  streamLabel: string;
  total?: number;
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
        <div className={styles.value}>{total ?? leads.length}</div>
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
