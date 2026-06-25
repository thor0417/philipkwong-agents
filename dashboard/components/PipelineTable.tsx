'use client';

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
  'Status',
  'Posting',
];

export default function PipelineTable({
  leads,
  onStatusChange,
  onSelect,
}: {
  leads: Lead[];
  onStatusChange: (id: string, status: string) => void;
  onSelect: (lead: Lead) => void;
}) {
  return (
    <section className={styles.wrap}>
      <div className={styles.heading}>
        <span className="bracket">[</span> Pipeline — {leads.length} leads{' '}
        <span className="bracket">]</span>
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
            {leads.length === 0 && (
              <tr>
                <td className={styles.empty} colSpan={COLUMNS.length}>
                  No leads yet. Run the scraper to populate.
                </td>
              </tr>
            )}
            {leads.map((lead) => (
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
        <a
          className={styles.view}
          href={lead.url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          View Posting
        </a>
      </td>
    </tr>
  );
}
