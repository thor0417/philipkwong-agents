'use client';

import type { DealWithRelations, Lead, Outreach } from '@/lib/types';
import { ACTIVE_STAGES, formatCurrency } from '@/lib/crm';
import styles from './StatsBar.module.css';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export default function StatsBar({
  leads,
  deals,
  outreach,
}: {
  leads: Lead[];
  deals: DealWithRelations[];
  outreach: Outreach[];
}) {
  const totalLeads = leads.length;

  // Pipeline value = sum of value_estimate across deals still in play.
  const pipelineValue = deals
    .filter((d) => ACTIVE_STAGES.includes(d.stage))
    .reduce((sum, d) => sum + (d.value_estimate ?? 0), 0);

  const cutoff = Date.now() - WEEK_MS;
  const leadsThisWeek = leads.filter(
    (l) => l.date_found && new Date(l.date_found).getTime() >= cutoff
  ).length;

  const outreachSent = outreach.filter((o) => o.status === 'sent').length;

  const stats = [
    { label: 'Total Leads', value: String(totalLeads), accent: false },
    { label: 'Pipeline Value', value: formatCurrency(pipelineValue), accent: true },
    { label: 'Leads This Week', value: String(leadsThisWeek), accent: false },
    { label: 'Outreach Sent', value: String(outreachSent), accent: false },
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
