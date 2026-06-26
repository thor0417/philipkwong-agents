'use client';

import { useMemo, useState } from 'react';
import type { Lead } from '@/lib/types';
import {
  STATUS_OPTIONS,
  formatDate,
  leadClosing,
  leadOrg,
  normalizeStatus,
  scoreTier,
  sourceLabel,
} from '@/lib/leads';
import SourceLink from './SourceLink';
import styles from './PipelineTable.module.css';

const COLUMNS = [
  'Score',
  'Source',
  'Title',
  'Company / Dept',
  'Jurisdiction',
  'Budget',
  'Closing',
  'Found',
  'Module',
  'Industry',
  'Region',
  'Lead Type',
  'Company',
  'Deadline',
  'Value',
  'Status',
  'Posting',
];

// Null/empty cell placeholder.
function dash(value: string | null | undefined): string {
  return value === null || value === undefined || value === '' ? '--' : value;
}

export default function PipelineTable({
  leads,
  onStatusChange,
  onSelect,
}: {
  leads: Lead[];
  onStatusChange: (id: string, status: string) => void;
  onSelect: (lead: Lead) => void;
}) {
  const [moduleFilter, setModuleFilter] = useState('all');
  const [regionFilter, setRegionFilter] = useState('all');
  const [leadTypeFilter, setLeadTypeFilter] = useState('all');

  // Distinct module / region values present in the data.
  const modules = useMemo(() => {
    const set = new Set<string>();
    leads.forEach((l) => l.module && set.add(l.module));
    return Array.from(set).sort();
  }, [leads]);
  const regions = useMemo(() => {
    const set = new Set<string>();
    leads.forEach((l) => l.region && set.add(l.region));
    return Array.from(set).sort();
  }, [leads]);

  // Client-side filtering of displayed rows.
  const rows = useMemo(
    () =>
      leads.filter((l) => {
        if (moduleFilter !== 'all' && l.module !== moduleFilter) return false;
        if (regionFilter !== 'all' && l.region !== regionFilter) return false;
        if (leadTypeFilter !== 'all' && l.lead_type !== leadTypeFilter) return false;
        return true;
      }),
    [leads, moduleFilter, regionFilter, leadTypeFilter]
  );

  return (
    <section className={styles.wrap}>
      <div className={styles.heading}>
        <span className="bracket">[</span> Pipeline — {rows.length} leads{' '}
        <span className="bracket">]</span>
      </div>
      <div className={styles.controls}>
        <label className={styles.control}>
          <span>Module</span>
          <select value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)}>
            <option value="all">All</option>
            {modules.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.control}>
          <span>Region</span>
          <select value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)}>
            <option value="all">All</option>
            {regions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.control}>
          <span>Lead Type</span>
          <select value={leadTypeFilter} onChange={(e) => setLeadTypeFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="tender">tender</option>
            <option value="registry">registry</option>
          </select>
        </label>
      </div>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              {COLUMNS.map((c, i) => (
                <th key={c || `col-${i}`}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className={styles.empty} colSpan={COLUMNS.length}>
                  No leads yet. Run the scraper to populate.
                </td>
              </tr>
            )}
            {rows.map((lead) => (
              <LeadRow
                key={lead.id}
                lead={lead}
                onStatusChange={onStatusChange}
                onSelect={onSelect}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LeadRow({
  lead,
  onStatusChange,
  onSelect,
}: {
  lead: Lead;
  onStatusChange: (id: string, status: string) => void;
  onSelect: (lead: Lead) => void;
}) {
  const score = lead.score ?? 0;
  const tier = scoreTier(score);

  return (
    <tr
      className={styles.row}
      onClick={() => onSelect(lead)}
      title="Open lead detail"
    >
      <td>
        <span className={`${styles.score} ${styles[tier]}`}>{score}</span>
      </td>
      <td className={styles.meta}>{sourceLabel(lead.source)}</td>
      <td className={styles.titleCell}>{lead.title ?? '—'}</td>
      <td className={styles.meta}>{leadOrg(lead)}</td>
      <td className={styles.meta}>{lead.jurisdiction ?? '—'}</td>
      <td className={styles.meta}>{lead.budget ?? '—'}</td>
      <td className={styles.meta}>{leadClosing(lead)}</td>
      <td className={styles.meta}>{formatDate(lead.date_found)}</td>
      <td className={styles.meta}>{dash(lead.module)}</td>
      <td className={styles.meta}>{dash(lead.industry)}</td>
      <td className={styles.meta}>{dash(lead.region)}</td>
      <td className={styles.meta}>{dash(lead.lead_type)}</td>
      <td className={styles.meta}>{dash(lead.company)}</td>
      <td className={styles.meta}>{lead.deadline ? lead.deadline.slice(0, 10) : '--'}</td>
      <td className={styles.meta}>{dash(lead.value_estimate)}</td>
      <td>
        {/* Stop propagation so changing status does not open the panel. */}
        <select
          className={styles.statusSelect}
          value={normalizeStatus(lead.status)}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onStatusChange(lead.id, e.target.value)}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </td>
      <td>
        <SourceLink url={lead.url} />
      </td>
    </tr>
  );
}
