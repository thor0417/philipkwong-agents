'use client';

import type { DealWithRelations } from '@/lib/types';
import { STAGES } from '@/lib/types';
import {
  dealCompany,
  dealScore,
  dealSource,
  daysSince,
  formatCurrency,
  formatDate,
  isOverdue,
  scoreTier,
  sourceLabel,
} from '@/lib/crm';
import styles from './Kanban.module.css';

export default function Kanban({
  deals,
  onSelect,
}: {
  deals: DealWithRelations[];
  onSelect: (deal: DealWithRelations) => void;
}) {
  return (
    <section className={styles.board}>
      {STAGES.map((stage) => {
        const items = deals.filter((d) => d.stage === stage.value);
        return (
          <div className={styles.column} key={stage.value}>
            <div className={styles.colHead}>
              <span>{stage.label}</span>
              <span className={styles.count}>{items.length}</span>
            </div>
            <div className={styles.cards}>
              {items.length === 0 && (
                <div className={styles.emptyCol}>—</div>
              )}
              {items.map((deal) => (
                <DealCard key={deal.id} deal={deal} onSelect={onSelect} />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function DealCard({
  deal,
  onSelect,
}: {
  deal: DealWithRelations;
  onSelect: (deal: DealWithRelations) => void;
}) {
  const score = dealScore(deal);
  const source = dealSource(deal);
  const company = dealCompany(deal);
  const days = daysSince(deal.updated_at);
  const overdue = isOverdue(deal.next_action_date);

  return (
    <button className={styles.card} onClick={() => onSelect(deal)}>
      <div className={styles.cardTop}>
        <span className={styles.cardTitle}>{deal.title}</span>
        {score !== null && (
          <span className={`${styles.score} ${styles[scoreTier(score)]}`}>
            {score}
          </span>
        )}
      </div>
      {company !== '—' && <div className={styles.company}>{company}</div>}
      <div className={styles.tags}>
        {source && <span className={styles.tag}>{sourceLabel(source)}</span>}
        {deal.value_estimate !== null && (
          <span className={styles.value}>
            {formatCurrency(deal.value_estimate)}
          </span>
        )}
      </div>
      <div className={styles.cardFoot}>
        {days !== null && (
          <span className={styles.meta}>
            {days}d in stage
          </span>
        )}
        {deal.next_action_date && (
          <span className={overdue ? styles.due : styles.meta}>
            {formatDate(deal.next_action_date)}
          </span>
        )}
      </div>
    </button>
  );
}
