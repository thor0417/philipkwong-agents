'use client';

import type { Lead, Outreach } from '@/lib/types';
import styles from './StatsBar.module.css';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export default function StatsBar({
  leads,
  outreach,
}: {
  leads: Lead[];
  outreach: Outreach[];
}) {
  const total = leads.length;
  const outreachPending = outreach.filter((o) => o.status === 'pending').length;

  const cutoff = Date.now() - WEEK_MS;
  const thisWeek = leads.filter(
    (l) => l.date_found && new Date(l.date_found).getTime() >= cutoff
  ).length;

  // Count both the boolean flag and the lifecycle status, so the dropdown and
  // any agent-set flag both feed this number.
  const outreachSent = leads.filter(
    (l) => l.outreach_sent || l.status === 'outreach_sent'
  ).length;

  const stats = [
    { label: 'Total Leads', value: total, accent: false },
    { label: 'Outreach Pending', value: outreachPending, accent: true },
    { label: 'Leads This Week', value: thisWeek, accent: false },
    { label: 'Outreach Sent', value: outreachSent, accent: false },
  ];

  return (
    <section className={styles.bar}>
      {stats.map((s) => (
        <div className={styles.cell} key={s.label}>
          <div className={`${styles.value} ${s.accent ? styles.accent : ''}`}>
            {s.value}
          </div>
          <div className={styles.label}>{s.label}</div>
        </div>
      ))}
    </section>
  );
}
