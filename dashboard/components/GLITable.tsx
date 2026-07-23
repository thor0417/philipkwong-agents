'use client';

import { Fragment, useMemo, useState, type ReactNode } from 'react';
import type { GLILead } from '@/lib/types';
import { GLI_SIGNAL_ORDER } from '@/lib/types';
import styles from './GLITable.module.css';

// A column definition, supplied per stream by the page. `render` returns the cell
// node; `sortValue` (when present) makes the column sortable; `variant` selects
// the cell type role (title / strong / meta), defaulting to plain TEXT.
export interface GLIColumn {
  key: string;
  label: string;
  render: (lead: GLILead) => ReactNode;
  sortValue?: (lead: GLILead) => string | number;
  variant?: 'title' | 'strong' | 'meta';
}

type SortDir = 'asc' | 'desc';

const SIGNAL_RANK: Record<string, number> = Object.fromEntries(
  GLI_SIGNAL_ORDER.map((s, i) => [s, i])
);
const signalRank = (s: string): number => SIGNAL_RANK[s] ?? GLI_SIGNAL_ORDER.length;

function variantClass(variant: GLIColumn['variant']): string {
  if (variant === 'title') return styles.title;
  if (variant === 'strong') return styles.strong;
  if (variant === 'meta') return styles.meta;
  return '';
}

// One stream table. Opens with the signature section band (name in DISPLAY
// uppercase, count in EMPHASIS accent). groupBySignal renders a signal-type band
// per group (Feasibility RFP becomes its own section under Opportunities).
export default function GLITable({
  leads,
  columns,
  sectionLabel,
  groupBySignal = false,
  defaultSortKey,
  defaultSortDir = 'asc',
  onSelect,
}: {
  leads: GLILead[];
  columns: GLIColumn[];
  sectionLabel: string;
  groupBySignal?: boolean;
  defaultSortKey?: string;
  defaultSortDir?: SortDir;
  onSelect: (lead: GLILead) => void;
}) {
  const [sortKey, setSortKey] = useState<string | null>(defaultSortKey ?? null);
  const [sortDir, setSortDir] = useState<SortDir>(defaultSortDir);

  const colByKey = useMemo(
    () => Object.fromEntries(columns.map((c) => [c.key, c])) as Record<string, GLIColumn>,
    [columns]
  );

  function toggleSort(key: string) {
    if (!colByKey[key]?.sortValue) return;
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const sortRows = useMemo(() => {
    return (rows: GLILead[]): GLILead[] => {
      const col = sortKey ? colByKey[sortKey] : undefined;
      if (!col?.sortValue) return rows;
      const sv = col.sortValue;
      return [...rows].sort((a, b) => {
        const va = sv(a);
        const vb = sv(b);
        const r =
          typeof va === 'number' && typeof vb === 'number'
            ? va - vb
            : String(va).localeCompare(String(vb));
        return sortDir === 'asc' ? r : -r;
      });
    };
  }, [colByKey, sortKey, sortDir]);

  const groups = useMemo(() => {
    if (!groupBySignal) return [{ signal: null as string | null, items: sortRows(leads) }];
    const map = new Map<string, GLILead[]>();
    for (const l of leads) {
      const k = l.signal_type ?? 'Unclassified';
      const bucket = map.get(k);
      if (bucket) bucket.push(l);
      else map.set(k, [l]);
    }
    return [...map.entries()]
      .sort((a, b) => {
        const r = signalRank(a[0]) - signalRank(b[0]);
        return r !== 0 ? r : a[0].localeCompare(b[0]);
      })
      .map(([signal, items]) => ({ signal, items: sortRows(items) }));
  }, [leads, groupBySignal, sortRows]);

  const arrow = (key: string): string =>
    key === sortKey ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  return (
    <section className={styles.section}>
      <div className={styles.band}>
        <span className={styles.bandName}>{sectionLabel}</span>
        <span className={styles.bandCount}>{leads.length}</span>
      </div>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={[variantClass(col.variant), col.sortValue ? styles.sortable : '']
                    .filter(Boolean)
                    .join(' ') || undefined}
                  onClick={col.sortValue ? () => toggleSort(col.key) : undefined}
                >
                  {col.label}
                  {arrow(col.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 && (
              <tr>
                <td className={styles.empty} colSpan={columns.length}>
                  No records in this stream match the current filters.
                </td>
              </tr>
            )}
            {groups.map((g) => (
              <Fragment key={g.signal ?? '_all'}>
                {g.signal && (
                  <tr className={styles.groupRow}>
                    <td className={styles.groupCell} colSpan={columns.length}>
                      <span className={styles.groupName}>{g.signal}</span>
                      <span className={styles.groupCount}>{g.items.length}</span>
                    </td>
                  </tr>
                )}
                {g.items.map((lead) => (
                  <tr
                    key={lead.id}
                    className={styles.row}
                    onClick={() => onSelect(lead)}
                    title="Open GLI record detail"
                  >
                    {columns.map((col) => (
                      <td key={col.key} className={`${styles.cell} ${variantClass(col.variant)}`}>
                        {col.render(lead)}
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
