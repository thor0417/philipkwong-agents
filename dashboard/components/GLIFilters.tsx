'use client';

import { GLI_VENUE_TYPES } from '@/lib/types';
import styles from './GLIFilters.module.css';

export default function GLIFilters({
  venueFilter,
  locationQuery,
  tierFilter,
  onVenue,
  onLocation,
  onTier,
}: {
  venueFilter: string; // 'all' or a venue_type value
  locationQuery: string; // text search string
  // Optional so the control stages cleanly; the page wires the real value.
  tierFilter?: string; // 'all' | 'primary' | 'trade' | 'news'
  onVenue: (v: string) => void;
  onLocation: (q: string) => void;
  onTier?: (t: string) => void;
}) {
  return (
    <div className={styles.bar}>
      <label className={styles.control}>
        <span>Venue Type</span>
        <select value={venueFilter} onChange={(e) => onVenue(e.target.value)}>
          <option value="all">All</option>
          {GLI_VENUE_TYPES.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.control}>
        <span>Source Tier</span>
        <select
          value={tierFilter ?? 'all'}
          onChange={(e) => onTier?.(e.target.value)}
        >
          <option value="all">All</option>
          <option value="primary">Primary</option>
          <option value="trade">Trade</option>
          <option value="news">News</option>
        </select>
      </label>
      <input
        className={styles.search}
        value={locationQuery}
        placeholder="Filter by location..."
        onChange={(e) => onLocation(e.target.value)}
      />
    </div>
  );
}
