'use client';

import { Fragment, useMemo, useState, type ReactNode } from 'react';
import type { GLILead } from '@/lib/types';
import type { LeadStatus } from '@/lib/mutations';
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
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onRowStatus,
  serverSort,
  onServerSort,
}: {
  leads: GLILead[];
  columns: GLIColumn[];
  sectionLabel: string;
  groupBySignal?: boolean;
  defaultSortKey?: string;
  defaultSortDir?: SortDir;
  onSelect: (lead: GLILead) => void;
  // Selection is owned by the page (it survives paging and drives bulk actions).
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onToggleSelectAll?: (ids: string[], select: boolean) => void;
  // Compact per-row triage. Undefined in read-only contexts (exports, reports).
  onRowStatus?: (lead: GLILead, status: LeadStatus) => void;
  // When the page sorts server-side, it passes the current sort and a handler.
  // The header then reorders the WHOLE result set rather than the visible page,
  // and local sorting is bypassed entirely. Without these props the component
  // keeps its original local-sort behaviour.
  serverSort?: { key: string; dir: SortDir };
  onServerSort?: (key: string) => void;
}) {
  const selectable = !!onToggleSelect;
  const pageIds = leads.map((l) => l.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds?.has(id));
  const [localSortKey, setLocalSortKey] = useState<string | null>(defaultSortKey ?? null);
  const [localSortDir, setLocalSortDir] = useState<SortDir>(defaultSortDir);
  // Server sort wins when the page provides it.
  const sortKey = serverSort ? serverSort.key : localSortKey;
  const sortDir = serverSort ? serverSort.dir : localSortDir;

  const colByKey = useMemo(
    () => Object.fromEntries(columns.map((c) => [c.key, c])) as Record<string, GLIColumn>,
    [columns]
  );

  function toggleSort(key: string) {
    if (!colByKey[key]?.sortValue) return;
    if (onServerSort) {
      onServerSort(key);
      return;
    }
    if (key === localSortKey) setLocalSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setLocalSortKey(key);
      setLocalSortDir('asc');
    }
  }

  const sortRows = useMemo(() => {
    return (rows: GLILead[]): GLILead[] => {
      // Already ordered by the database; re-sorting the page would only reorder
      // the 50 rows on screen and misrepresent them as the whole set.
      if (serverSort) return rows;
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
  }, [colByKey, sortKey, sortDir, serverSort]);

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
              {selectable && (
                <th className={styles.checkCell}>
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    checked={allOnPageSelected}
                    onChange={() => onToggleSelectAll?.(pageIds, !allOnPageSelected)}
                  />
                </th>
              )}
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
              {onRowStatus && <th className={styles.actionsCell}>Triage</th>}
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 && (
              <tr>
                <td className={styles.empty} colSpan={columns.length + (selectable ? 1 : 0) + (onRowStatus ? 1 : 0)}>
                  No records in this stream match the current filters.
                </td>
              </tr>
            )}
            {groups.map((g) => (
              <Fragment key={g.signal ?? '_all'}>
                {g.signal && (
                  <tr className={styles.groupRow}>
                    <td className={styles.groupCell} colSpan={columns.length + (selectable ? 1 : 0) + (onRowStatus ? 1 : 0)}>
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
                    title="Open record detail"
                  >
                    {selectable && (
                      <td className={styles.checkCell} onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label="Select record"
                          checked={selectedIds?.has(lead.id) ?? false}
                          onChange={() => onToggleSelect?.(lead.id)}
                        />
                      </td>
                    )}
                    {columns.map((col) => (
                      <td key={col.key} className={`${styles.cell} ${variantClass(col.variant)}`}>
                        {col.render(lead)}
                      </td>
                    ))}
                    {onRowStatus && (
                      <td className={styles.actionsCell} onClick={(e) => e.stopPropagation()}>
                        <span className={styles.rowActions}>
                          <button
                            className={styles.rowAction}
                            title="Watchlist"
                            onClick={() => onRowStatus(lead, 'watchlist')}
                          >
                            Watch
                          </button>
                          <button
                            className={styles.rowAction}
                            title="Client Ready"
                            onClick={() => onRowStatus(lead, 'client_ready')}
                          >
                            Client
                          </button>
                          <button
                            className={styles.rowAction}
                            title={lead.status === 'dismissed' ? 'Restore to New' : 'Dismiss to Trash'}
                            onClick={() =>
                              onRowStatus(lead, lead.status === 'dismissed' ? 'new' : 'dismissed')
                            }
                          >
                            {lead.status === 'dismissed' ? 'Restore' : 'Dismiss'}
                          </button>
                        </span>
                      </td>
                    )}
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
