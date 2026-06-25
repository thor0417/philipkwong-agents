'use client';

import { useState } from 'react';
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
}: {
  leads: Lead[];
  onStatusChange: (id: string, status: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

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
                isOpen={expanded === lead.id}
                onToggle={() =>
                  setExpanded(expanded === lead.id ? null : lead.id)
                }
                onStatusChange={onStatusChange}
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
  isOpen,
  onToggle,
  onStatusChange,
}: {
  lead: Lead;
  isOpen: boolean;
  onToggle: () => void;
  onStatusChange: (id: string, status: string) => void;
}) {
  const score = lead.score ?? 0;
  const tier = scoreTier(score);

  return (
    <>
      <tr className={styles.row}>
        <td>
          <span className={`${styles.score} ${styles[tier]}`}>{score}</span>
        </td>
        <td className={styles.meta}>{sourceLabel(lead.source)}</td>
        <td className={styles.titleCell} onClick={onToggle} title="Show scoring reason">
          {lead.title ?? '—'}
        </td>
        <td className={styles.meta}>{leadOrg(lead)}</td>
        <td className={styles.meta}>{lead.jurisdiction ?? '—'}</td>
        <td className={styles.meta}>{lead.budget ?? '—'}</td>
        <td className={styles.meta}>{leadClosing(lead)}</td>
        <td className={styles.meta}>{formatDate(lead.date_found)}</td>
        <td>
          <select
            className={styles.statusSelect}
            value={normalizeStatus(lead.status)}
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
          >
            View Posting
          </a>
        </td>
      </tr>
      {isOpen && (
        <tr className={styles.expand}>
          <td colSpan={COLUMNS.length}>
            <span className={styles.expandLabel}>Scoring reason</span>
            <p className={styles.expandBody}>{lead.score_reason ?? '—'}</p>
          </td>
        </tr>
      )}
    </>
  );
}
