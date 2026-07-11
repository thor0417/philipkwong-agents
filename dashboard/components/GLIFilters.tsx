'use client';

import { GLI_VENUE_TYPES } from '@/lib/types';
import styles from './GLIFilters.module.css';

export default function GLIFilters({
  venueFilter,
  locationQuery,
  onVenue,
  onLocation,
}: {
  venueFilter: string; // 'all' or a venue_type value
  locationQuery: string; // text search string
  onVenue: (v: string) => void;
  onLocation: (q: string) => void;
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
      <input
        className={styles.search}
        value={locationQuery}
        placeholder="Filter by location..."
        onChange={(e) => onLocation(e.target.value)}
      />
    </div>
  );
}
