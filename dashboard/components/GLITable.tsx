'use client';

import { Fragment, useMemo, useState } from 'react';
import type { GLILead } from '@/lib/types';
import { GLI_SIGNAL_ORDER } from '@/lib/types';
import SourceLink from './SourceLink';
import styles from './GLITable.module.css';

// Sortable columns. 'link' is a plain source-link column and is not sortable.
type SortKey = 'signal' | 'venue' | 'title' | 'location' | 'source' | 'date';
type SortDir = 'asc' | 'desc';

const COLUMNS: { key: SortKey | null; label: string }[] = [
  { key: 'signal', label: 'Signal Type' },
  { key: 'venue', label: 'Venue Type' },
  { key: 'title', label: 'Title' },
  { key: 'location', label: 'Location' },
  { key: 'source', label: 'Source' },
  { key: 'date', label: 'Date' },
  { key: null, label: 'Link' },
];

const SIGNAL_RANK: Record<string, number> = Object.fromEntries(
  GLI_SIGNAL_ORDER.map((s, i) => [s, i])
);
function signalRank(signal: string): number {
  return SIGNAL_RANK[signal] ?? GLI_SIGNAL_ORDER.length;
}

// Bare domain from a url (e.g. planitshop.com), or null when absent/unparseable.
function sourceHost(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function dateValue(iso: string | null): number {
  return iso ? new Date(iso).getTime() : -Infinity;
}

// Comparable value for a sort key: a number for date, else a lowercased string.
function sortValue(lead: GLILead, key: SortKey): string | number {
  switch (key) {
    case 'signal':
      return (lead.signal_type ?? '').toLowerCase();
    case 'venue':
      return (lead.venue_type ?? '').toLowerCase();
    case 'title':
      return (lead.title ?? '').toLowerCase();
    case 'location':
      return (lead.location ?? '').toLowerCase();
    case 'source':
      return (sourceHost(lead.url) ?? '').toLowerCase();
    case 'date':
      return dateValue(lead.date_found);
  }
}

function compare(a: GLILead, b: GLILead, key: SortKey, dir: SortDir): number {
  const va = sortValue(a, key);
  const vb = sortValue(b, key);
  let r: number;
  if (typeof va === 'number' && typeof vb === 'number') r = va - vb;
  else r = String(va).localeCompare(String(vb));
  return dir === 'asc' ? r : -r;
}

export default function GLITable({
  leads,
  onSelect,
}: {
  leads: GLILead[];
  onSelect: (lead: GLILead) => void;
}) {
  // Default sort: date_found descending within each signal group.
  const [sortCol, setSortCol] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  function toggleSort(key: SortKey) {
    if (key === sortCol) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(key);
      setSortDir('asc');
    }
  }

  // Group by signal_type (GLI_SIGNAL_ORDER, unknown last), skip empty groups,
  // and sort within each group by the active column. Groups always stay in
  // GLI_SIGNAL_ORDER; only the rows inside a group re-sort.
  const groups = useMemo(() => {
    const map = new Map<string, GLILead[]>();
    for (const l of leads) {
      const key = l.signal_type ?? 'Unclassified';
      const bucket = map.get(key);
      if (bucket) bucket.push(l);
      else map.set(key, [l]);
    }
    return [...map.entries()]
      .sort((a, b) => {
        const r = signalRank(a[0]) - signalRank(b[0]);
        return r !== 0 ? r : a[0].localeCompare(b[0]);
      })
      .map(([signal, items]) => ({
        signal,
        items: [...items].sort((a, b) => compare(a, b, sortCol, sortDir)),
      }));
  }, [leads, sortCol, sortDir]);

  const arrow = (key: SortKey): string =>
    key === sortCol ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  return (
    <section className={styles.wrap}>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              {COLUMNS.map((col) =>
                col.key ? (
                  <th
                    key={col.label}
                    className={styles.sortable}
                    onClick={() => toggleSort(col.key as SortKey)}
                  >
                    {col.label}
                    {arrow(col.key)}
                  </th>
                ) : (
                  <th key={col.label}>{col.label}</th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 && (
              <tr>
                <td className={styles.empty} colSpan={COLUMNS.length}>
                  No GLI leads match the current filters.
                </td>
              </tr>
            )}
            {groups.map((g) => (
              <Fragment key={g.signal}>
                <tr className={styles.groupRow}>
                  <td className={styles.groupCell} colSpan={COLUMNS.length}>
                    <span className={styles.groupLabel}>{g.signal}</span>
                    <span className={styles.groupCount}>{g.items.length}</span>
                  </td>
                </tr>
                {g.items.map((lead) => (
                  <GLIRow key={lead.id} lead={lead} onSelect={onSelect} />
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function GLIRow({
  lead,
  onSelect,
}: {
  lead: GLILead;
  onSelect: (lead: GLILead) => void;
}) {
  const host = sourceHost(lead.url);
  return (
    <tr
      className={styles.row}
      onClick={() => onSelect(lead)}
      title="Open GLI lead detail"
    >
      <td className={styles.signalCell}>{lead.signal_type ?? '--'}</td>
      <td className={styles.meta}>{lead.venue_type ?? '--'}</td>
      <td className={styles.titleCell}>{lead.title ?? '--'}</td>
      <td className={styles.location}>{lead.location ?? '--'}</td>
      <td className={styles.meta}>{host ?? '--'}</td>
      <td className={styles.meta}>
        {lead.date_found ? lead.date_found.slice(0, 10) : '--'}
      </td>
      <td>
        <SourceLink url={lead.url} />
      </td>
    </tr>
  );
}
