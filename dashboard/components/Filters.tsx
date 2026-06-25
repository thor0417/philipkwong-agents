'use client';

import { STATUS_OPTIONS, sourceLabel } from '@/lib/leads';
import styles from './Filters.module.css';

export interface LeadFilters {
  q: string;
  source: string;
  status: string;
  minScore: string;
}

export const EMPTY_FILTERS: LeadFilters = {
  q: '',
  source: 'all',
  status: 'all',
  minScore: '',
};

export default function Filters({
  filters,
  sources,
  onChange,
}: {
  filters: LeadFilters;
  sources: string[];
  onChange: (filters: LeadFilters) => void;
}) {
  function set<K extends keyof LeadFilters>(key: K, value: LeadFilters[K]) {
    onChange({ ...filters, [key]: value });
  }

  return (
    <div className={styles.bar}>
      <input
        className={styles.search}
        value={filters.q}
        placeholder="Search title or company…"
        onChange={(e) => set('q', e.target.value)}
      />
      <label className={styles.control}>
        <span>Source</span>
        <select
          value={filters.source}
          onChange={(e) => set('source', e.target.value)}
        >
          <option value="all">All</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {sourceLabel(s)}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.control}>
        <span>Status</span>
        <select
          value={filters.status}
          onChange={(e) => set('status', e.target.value)}
        >
          <option value="all">All</option>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.control}>
        <span>Min Score</span>
        <input
          className={styles.score}
          value={filters.minScore}
          inputMode="numeric"
          placeholder="0"
          onChange={(e) => set('minScore', e.target.value)}
        />
      </label>
    </div>
  );
}
