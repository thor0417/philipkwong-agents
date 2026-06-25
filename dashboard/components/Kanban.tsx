'use client';

import type { Lead } from '@/lib/types';
import { STAGES } from '@/lib/types';
import {
  formatDate,
  leadOrg,
  leadStage,
  scoreTier,
  sourceLabel,
} from '@/lib/leads';
import styles from './Kanban.module.css';

export default function Kanban({
  leads,
  onSelect,
}: {
  leads: Lead[];
  onSelect: (lead: Lead) => void;
}) {
  return (
    <section className={styles.board}>
      {STAGES.map((stage) => {
        const items = leads.filter((l) => leadStage(l.status) === stage.value);
        return (
          <div className={styles.column} key={stage.value}>
            <div className={styles.colHead}>
              <span>{stage.label}</span>
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
        <span className={styles.cardTitle}>{lead.title ?? '—'}</span>
        <span className={`${styles.score} ${styles[scoreTier(score)]}`}>
          {score}
        </span>
      </div>
      {company !== '—' && <div className={styles.company}>{company}</div>}
      <div className={styles.tags}>
        <span className={styles.tag}>{sourceLabel(lead.source)}</span>
      </div>
      <div className={styles.cardFoot}>
        <span className={styles.meta}>{formatDate(lead.date_found)}</span>
      </div>
    </button>
  );
}
