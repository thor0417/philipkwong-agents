'use client';

import type { Lead, Outreach } from '@/lib/types';
import styles from './StatsBar.module.css';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Display names for raw module slugs.
const MODULE_LABELS: Record<string, string> = {
  fuel: 'Fuel',
  healthcare_pharma: 'Healthcare/Pharma',
  technology_ai: 'Technology/AI',
  financial_services: 'Financial Services',
  food_beverage_hospitality: 'Food & Beverage',
  general_consulting: 'Consulting',
  construction_infrastructure: 'Construction',
  cannabis: 'Cannabis',
  web_digital: 'Web/Digital',
  fuel_supply: 'Fuel Supply',
};

function countBy(leads: Lead[], key: 'module' | 'region'): [string, number][] {
  const counts: Record<string, number> = {};
  for (const l of leads) {
    const v = l[key];
    if (v) counts[v] = (counts[v] ?? 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

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

  const moduleCounts = countBy(leads, 'module');
  const regionCounts = countBy(leads, 'region');

  return (
    <>
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
      {moduleCounts.length > 0 && (
        <div className={styles.countsRow}>
          {moduleCounts.map(([mod, count]) => (
            <span className={styles.countItem} key={mod}>
              <span className={styles.countLabel}>{MODULE_LABELS[mod] ?? mod}</span>
              <span className={styles.countValue}>{count}</span>
            </span>
          ))}
        </div>
      )}
      {regionCounts.length > 0 && (
        <div className={styles.countsRow}>
          {regionCounts.map(([region, count]) => (
            <span className={styles.countItem} key={region}>
              <span className={styles.countLabel}>{region}</span>
              <span className={styles.countValue}>{count}</span>
            </span>
          ))}
        </div>
      )}
    </>
  );
}
