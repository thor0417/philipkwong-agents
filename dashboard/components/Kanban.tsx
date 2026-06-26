'use client';

import type { Lead } from '@/lib/types';
import { leadOrg, normalizeStatus, scoreTier, sourceLabel } from '@/lib/leads';
import SourceLink from './SourceLink';
import styles from './Kanban.module.css';

// Kanban columns map directly to the lead lifecycle status. Statuses without a
// column (none currently) simply would not appear.
const KANBAN_COLUMNS: { status: string; label: string }[] = [
  { status: 'new', label: 'New Lead' },
  { status: 'reviewing', label: 'Contacted' },
  { status: 'outreach_sent', label: 'Outreach Sent' },
  { status: 'won', label: 'Won' },
  { status: 'lost', label: 'Lost' },
];

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export default function Kanban({
  leads,
  onSelect,
}: {
  leads: Lead[];
  onSelect: (lead: Lead) => void;
}) {
  return (
    <section className={styles.board}>
      {KANBAN_COLUMNS.map((col) => {
        const items = leads.filter(
          (l) => normalizeStatus(l.status) === col.status
        );
        return (
          <div className={styles.column} key={col.status}>
            <div className={styles.colHead}>
              <span>{col.label}</span>
              <span className={styles.count}>{items.length}</span>
            </div>
            <div className={styles.cards}>
              {items.length === 0 && <div className={styles.emptyCol}>—</div>}
              {items.map((lead) => (
                <LeadCard key={lead.id} lead={lead} onSelect={onSelect} />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function LeadCard({
  lead,
  onSelect,
}: {
  lead: Lead;
  onSelect: (lead: Lead) => void;
}) {
  const score = lead.score ?? 0;
  const company = leadOrg(lead);

  return (
    <button className={styles.card} onClick={() => onSelect(lead)}>
      <div className={styles.cardTop}>
        <span className={styles.cardTitle}>
          {truncate(lead.title ?? '—', 60)}
        </span>
        <span className={`${styles.score} ${styles[scoreTier(score)]}`}>
          {score}
        </span>
      </div>
      {company !== '—' && <div className={styles.company}>{company}</div>}
      <div className={styles.tags}>
        <span className={styles.tag}>{sourceLabel(lead.source)}</span>
        <SourceLink url={lead.url} />
      </div>
      {(lead.module || lead.region) && (
        <div className={styles.cardFoot}>
          {lead.module && <span className={styles.meta}>{lead.module}</span>}
          {lead.region && <span className={styles.meta}>{lead.region}</span>}
        </div>
      )}
    </button>
  );
}
