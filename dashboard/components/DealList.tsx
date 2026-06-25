'use client';

import { useMemo, useState } from 'react';
import type { DealWithRelations } from '@/lib/types';
import { STAGES } from '@/lib/types';
import {
  dealCompany,
  dealScore,
  dealSource,
  formatCurrency,
  formatDate,
  scoreTier,
  stageLabel,
  sourceLabel,
} from '@/lib/crm';
import styles from './DealList.module.css';

type SortKey = 'score' | 'value' | 'date';

// High-level status derived from the stage (Stage column is the detail).
function dealStatus(stage: string): string {
  if (stage === 'won') return 'Won';
  if (stage === 'lost') return 'Lost';
  return 'Active';
}

function dealDate(deal: DealWithRelations): string | null {
  return deal.leads?.date_found ?? deal.created_at;
}

export default function DealList({
  deals,
  onSelect,
}: {
  deals: DealWithRelations[];
  onSelect: (deal: DealWithRelations) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');

  // Distinct sources present in the data, for the source filter dropdown.
  const sources = useMemo(() => {
    const set = new Set<string>();
    deals.forEach((d) => {
      const s = dealSource(d);
      if (s) set.add(s);
    });
    return Array.from(set).sort();
  }, [deals]);

  const rows = useMemo(() => {
    const filtered = deals.filter((d) => {
      if (stageFilter !== 'all' && d.stage !== stageFilter) return false;
      if (sourceFilter !== 'all' && dealSource(d) !== sourceFilter) return false;
      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      if (sortKey === 'score') return (dealScore(b) ?? 0) - (dealScore(a) ?? 0);
      if (sortKey === 'value')
        return (b.value_estimate ?? 0) - (a.value_estimate ?? 0);
      // date: newest first
      const da = new Date(dealDate(a) ?? 0).getTime();
      const db = new Date(dealDate(b) ?? 0).getTime();
      return db - da;
    });

    return sorted;
  }, [deals, sortKey, stageFilter, sourceFilter]);

  return (
    <section className={styles.wrap}>
      <div className={styles.controls}>
        <label className={styles.control}>
          <span>Sort</span>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
          >
            <option value="score">Score</option>
            <option value="value">Value</option>
            <option value="date">Date Found</option>
          </select>
        </label>
        <label className={styles.control}>
          <span>Stage</span>
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
          >
            <option value="all">All</option>
            {STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.control}>
          <span>Source</span>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
          >
            <option value="all">All</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {sourceLabel(s)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Score</th>
              <th>Stage</th>
              <th>Title</th>
              <th>Company</th>
              <th>Source</th>
              <th>Value</th>
              <th>Next Action</th>
              <th>Date Found</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className={styles.empty} colSpan={9}>
                  No deals match. Deals are created from leads and inbound
                  replies.
                </td>
              </tr>
            )}
            {rows.map((deal) => {
              const score = dealScore(deal);
              return (
                <tr
                  key={deal.id}
                  className={styles.row}
                  onClick={() => onSelect(deal)}
                >
                  <td>
                    {score !== null ? (
                      <span
                        className={`${styles.score} ${styles[scoreTier(score)]}`}
                      >
                        {score}
                      </span>
                    ) : (
                      <span className={styles.meta}>—</span>
                    )}
                  </td>
                  <td className={styles.meta}>{stageLabel(deal.stage)}</td>
                  <td className={styles.titleCell}>{deal.title}</td>
                  <td className={styles.meta}>{dealCompany(deal)}</td>
                  <td className={styles.meta}>{sourceLabel(dealSource(deal))}</td>
                  <td className={styles.meta}>
                    {formatCurrency(deal.value_estimate)}
                  </td>
                  <td className={styles.meta}>{deal.next_action ?? '—'}</td>
                  <td className={styles.meta}>{formatDate(dealDate(deal))}</td>
                  <td className={styles.meta}>{dealStatus(deal.stage)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
