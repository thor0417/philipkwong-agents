'use client';

import type { Lead } from '@/lib/types';
import styles from './ModuleFilter.module.css';

// Display labels mapped to lead predicates. Some map to the module field,
// others (Hiring Signals / Government Tenders) map to lead_type.
export type ModuleKey = 'all' | 'consulting' | 'hiring' | 'tenders' | 'fuel' | 'local';

export const MODULE_OPTIONS: { key: ModuleKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'consulting', label: 'Consulting' },
  { key: 'hiring', label: 'Hiring Signals' },
  { key: 'tenders', label: 'Government Tenders' },
  { key: 'fuel', label: 'Fuel' },
  { key: 'local', label: 'Local Business' },
];

export function matchesModule(lead: Lead, key: ModuleKey): boolean {
  switch (key) {
    case 'all':
      return true;
    case 'consulting':
      return lead.module === 'general_consulting';
    case 'hiring':
      return lead.lead_type === 'registry';
    case 'tenders':
      return lead.lead_type === 'tender';
    case 'fuel':
      return lead.module === 'fuel';
    case 'local':
      return lead.module === 'food_beverage_hospitality';
    default:
      return true;
  }
}

export default function ModuleFilter({
  active,
  onChange,
}: {
  active: ModuleKey;
  onChange: (key: ModuleKey) => void;
}) {
  return (
    <div className={styles.strip}>
      {MODULE_OPTIONS.map((o) => (
        <button
          key={o.key}
          className={`${styles.btn} ${active === o.key ? styles.active : ''}`}
          onClick={() => onChange(o.key)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
