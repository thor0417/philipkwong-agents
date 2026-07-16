'use client';

import type { GLILead } from '@/lib/types';
import styles from './GLIStats.module.css';

// Stats strip across the three streams. Numbers in EMPHASIS (NormalMedium) 32px,
// labels in TEXT (NormalRegular) 11px uppercase. Counts are over the currently
// filtered set (all streams), so the strip is a stable overview while tabs switch.
export default function GLIStats({ leads }: { leads: GLILead[] }) {
  const countStream = (s: string): number => leads.filter((l) => l.stream === s).length;
  const tiles: { label: string; value: number }[] = [
    { label: 'Total GLI', value: leads.length },
    { label: 'Opportunities', value: countStream('opportunity') },
    { label: 'Intelligence', value: countStream('intelligence') },
    { label: 'Government', value: countStream('government') },
  ];

  return (
    <section className={styles.bar}>
      {tiles.map((t) => (
        <div className={styles.cell} key={t.label}>
          <div className={styles.value}>{t.value}</div>
          <div className={styles.label}>{t.label}</div>
        </div>
      ))}
    </section>
  );
}
