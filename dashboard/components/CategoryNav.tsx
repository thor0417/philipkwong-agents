'use client';

import {
  CATEGORY_OPTIONS,
  FUEL_NOTICE_OPTIONS,
  FUEL_PRODUCT_OPTIONS,
  CONSULTING_SUB_OPTIONS,
  FEASIBILITY_SECTOR_OPTIONS,
  SIGNAL_TYPE_OPTIONS,
  SIGNAL_SECTOR_OPTIONS,
  SIGNAL_JURISDICTION_OPTIONS,
  type CategoryFilter,
} from '@/lib/category';
import styles from './CategoryNav.module.css';

// Top-level category tree plus the cascading sub-filters. Fuel shows two
// dimensions (notice type + product type) and a distinct Cargo toggle;
// Consulting shows a work-type dimension; Feasibility shows a sector dimension.
// Everything else shows just the top-level strip.
export default function CategoryNav({
  filter,
  onChange,
}: {
  filter: CategoryFilter;
  onChange: (filter: CategoryFilter) => void;
}) {
  const set = (patch: Partial<CategoryFilter>) => onChange({ ...filter, ...patch });

  // Switching top-level category resets the sub-filters (but keeps the archived
  // preference).
  const selectCategory = (key: CategoryFilter['category']) =>
    onChange({
      category: key,
      fuelNotice: 'all',
      fuelProduct: 'all',
      consultingSub: 'all',
      feasibilitySector: 'all',
      feasibilityLatam: false,
      signalType: 'all',
      signalSector: 'all',
      signalJurisdiction: 'all',
      cargo: false,
      includeArchived: filter.includeArchived,
    });

  return (
    <div className={styles.wrap}>
      <div className={styles.strip}>
        {CATEGORY_OPTIONS.map((o) => (
          <button
            key={o.key}
            className={`${styles.btn} ${filter.category === o.key ? styles.active : ''}`}
            onClick={() => selectCategory(o.key)}
          >
            {o.label}
          </button>
        ))}
        <button
          className={`${styles.btn} ${styles.archived} ${filter.includeArchived ? styles.active : ''}`}
          onClick={() => set({ includeArchived: !filter.includeArchived })}
          title="Show expired and awarded/dead leads (hidden by default)"
        >
          {filter.includeArchived ? '✓ ' : ''}Archived
        </button>
      </div>

      {filter.category === 'fuel' && (
        <>
          <div className={styles.substrip}>
            <span className={styles.dim}>Notice</span>
            {FUEL_NOTICE_OPTIONS.map((o) => (
              <button
                key={o.key}
                className={`${styles.sub} ${!filter.cargo && filter.fuelNotice === o.key ? styles.active : ''}`}
                disabled={filter.cargo}
                onClick={() => set({ fuelNotice: o.key })}
              >
                {o.label}
              </button>
            ))}
            <button
              className={`${styles.sub} ${styles.cargo} ${filter.cargo ? styles.active : ''}`}
              onClick={() => set({ cargo: !filter.cargo })}
              title="Cargo-scale demand (experiment bucket)"
            >
              ⬢ Cargo
            </button>
          </div>
          <div className={styles.substrip}>
            <span className={styles.dim}>Product</span>
            {FUEL_PRODUCT_OPTIONS.map((o) => (
              <button
                key={o.key}
                className={`${styles.sub} ${filter.fuelProduct === o.key ? styles.active : ''}`}
                onClick={() => set({ fuelProduct: o.key })}
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}

      {filter.category === 'consulting' && (
        <div className={styles.substrip}>
          <span className={styles.dim}>Work type</span>
          {CONSULTING_SUB_OPTIONS.map((o) => (
            <button
              key={o.key}
              className={`${styles.sub} ${filter.consultingSub === o.key ? styles.active : ''}`}
              onClick={() => set({ consultingSub: o.key })}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}

      {filter.category === 'feasibility' && (
        <div className={styles.substrip}>
          <span className={styles.dim}>Sector</span>
          {FEASIBILITY_SECTOR_OPTIONS.map((o) => (
            <button
              key={o.key}
              className={`${styles.sub} ${filter.feasibilitySector === o.key ? styles.active : ''}`}
              onClick={() => set({ feasibilitySector: o.key })}
            >
              {o.label}
            </button>
          ))}
          <button
            className={`${styles.sub} ${filter.feasibilityLatam ? styles.active : ''}`}
            onClick={() => set({ feasibilityLatam: !filter.feasibilityLatam })}
            title="Restrict to the LATAM/Caribbean origination territory"
          >
            {filter.feasibilityLatam ? '✓ ' : ''}LATAM/Carib
          </button>
        </div>
      )}

      {filter.category === 'signals' && (
        <>
          <div className={styles.substrip}>
            <span className={styles.dim}>Signal</span>
            {SIGNAL_TYPE_OPTIONS.map((o) => (
              <button
                key={o.key}
                className={`${styles.sub} ${filter.signalType === o.key ? styles.active : ''}`}
                onClick={() => set({ signalType: o.key })}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className={styles.substrip}>
            <span className={styles.dim}>Sector</span>
            {SIGNAL_SECTOR_OPTIONS.map((o) => (
              <button
                key={o.key}
                className={`${styles.sub} ${filter.signalSector === o.key ? styles.active : ''}`}
                onClick={() => set({ signalSector: o.key })}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className={styles.substrip}>
            <span className={styles.dim}>Jurisdiction</span>
            {SIGNAL_JURISDICTION_OPTIONS.map((o) => (
              <button
                key={o.key}
                className={`${styles.sub} ${filter.signalJurisdiction === o.key ? styles.active : ''}`}
                onClick={() => set({ signalJurisdiction: o.key })}
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
