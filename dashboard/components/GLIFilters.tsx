'use client';

import { GLI_VENUE_TYPES } from '@/lib/types';
import { DEVELOPMENT_CATEGORIES } from '@/lib/gli-category';
import styles from './GLIFilters.module.css';

// Cross-stream GLI filters. The development-category filter is primary and
// prominent (chips), applying across all three streams. Venue and location are
// secondary. No DM Mono.
export default function GLIFilters({
  categoryFilter,
  venueFilter,
  locationQuery,
  onCategory,
  onVenue,
  onLocation,
}: {
  categoryFilter: string; // 'all' or a development category
  venueFilter: string; // 'all' or a venue_type
  locationQuery: string; // text search
  onCategory: (c: string) => void;
  onVenue: (v: string) => void;
  onLocation: (q: string) => void;
}) {
  const categories = ['all', ...DEVELOPMENT_CATEGORIES];

  return (
    <div className={styles.wrap}>
      <div className={styles.categoryRow}>
        <span className={styles.groupLabel}>Development Category</span>
        <div className={styles.chips}>
          {categories.map((c) => (
            <button
              key={c}
              className={`${styles.chip} ${categoryFilter === c ? styles.chipActive : ''}`}
              onClick={() => onCategory(c)}
            >
              {c === 'all' ? 'All' : c}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.secondaryRow}>
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
    </div>
  );
}
