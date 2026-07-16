'use client';

import styles from './GLIFilters.module.css';

// A filter value with its count. Counts are computed by the page over the ACTIVE
// stream (faceted: excluding this chip's own dimension), so a chip's count equals
// the rows shown when it is clicked.
export interface GLIChip {
  value: string; // 'all' or a canonical venue_type / development_category
  label: string;
  count: number;
}

// Cross-stream note: everything here is scoped to the active stream by the page.
// A chip that would show zero rows in the active stream is rendered disabled with
// its 0, never as a clickable count that leads to an empty view. Location stays a
// free-text filter (no discrete values to count).
export default function GLIFilters({
  categoryChips,
  venueChips,
  categoryFilter,
  venueFilter,
  locationQuery,
  onCategory,
  onVenue,
  onLocation,
}: {
  categoryChips: GLIChip[];
  venueChips: GLIChip[];
  categoryFilter: string;
  venueFilter: string;
  locationQuery: string;
  onCategory: (c: string) => void;
  onVenue: (v: string) => void;
  onLocation: (q: string) => void;
}) {
  return (
    <div className={styles.wrap}>
      <ChipRow
        label="Development Category"
        chips={categoryChips}
        selected={categoryFilter}
        onSelect={onCategory}
      />
      <ChipRow label="Venue Type" chips={venueChips} selected={venueFilter} onSelect={onVenue} />
      <div className={styles.secondaryRow}>
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

function ChipRow({
  label,
  chips,
  selected,
  onSelect,
}: {
  label: string;
  chips: GLIChip[];
  selected: string;
  onSelect: (v: string) => void;
}) {
  return (
    <div className={styles.chipGroup}>
      <span className={styles.groupLabel}>{label}</span>
      <div className={styles.chips}>
        {chips.map((c) => {
          const active = c.value === selected;
          // Never let a zero-count value be a clickable count that shows nothing.
          // 'All' is always clickable (it is the reset).
          const disabled = c.value !== 'all' && c.count === 0;
          return (
            <button
              key={c.value}
              type="button"
              disabled={disabled}
              className={`${styles.chip} ${active ? styles.chipActive : ''}`}
              onClick={() => onSelect(c.value)}
            >
              {c.label}
              <span className={styles.chipCount}>{c.count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
