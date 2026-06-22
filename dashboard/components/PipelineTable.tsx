'use client';

import { useState } from 'react';
import type { Lead } from '@/lib/types';
import styles from './PipelineTable.module.css';

const COLUMNS = [
  'Score',
  'Source',
  'Title',
  'Jurisdiction',
  'Budget',
  'Status',
  'Date Found',
];

function formatDate(iso: string): string {
  // Deterministic YYYY-MM-DD to avoid hydration mismatches.
  return iso ? iso.slice(0, 10) : '—';
}

export default function PipelineTable({ leads }: { leads: Lead[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <section className={styles.wrap}>
      <div className={styles.heading}>Pipeline — {leads.length} leads</div>
      <table className={styles.table}>
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {leads.length === 0 && (
            <tr>
              <td className={styles.empty} colSpan={COLUMNS.length}>
                No leads yet. Run the upwork-scraper to populate.
              </td>
            </tr>
          )}
          {leads.map((lead) => {
            const score = lead.score ?? 0;
            const isOpen = expanded === lead.id;
            return (
              <FragmentRow
                key={lead.id}
                lead={lead}
                score={score}
                isOpen={isOpen}
                onToggle={() => setExpanded(isOpen ? null : lead.id)}
              />
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function FragmentRow({
  lead,
  score,
  isOpen,
  onToggle,
}: {
  lead: Lead;
  score: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className={styles.row} onClick={onToggle}>
        <td>
          <span
            className={`${styles.score} ${score >= 80 ? styles.scoreHot : ''}`}
          >
            {score}
          </span>
        </td>
        <td className={styles.meta}>{lead.source}</td>
        <td className={styles.title}>{lead.title ?? '—'}</td>
        <td className={styles.meta}>{lead.jurisdiction ?? '—'}</td>
        <td className={styles.meta}>{lead.budget ?? '—'}</td>
        <td className={styles.meta}>{lead.status ?? '—'}</td>
        <td className={styles.meta}>{formatDate(lead.date_found)}</td>
      </tr>
      {isOpen && (
        <tr className={styles.expand}>
          <td colSpan={7}>
            <strong>Reason:</strong> {lead.score_reason ?? '—'}
            <br />
            <br />
            <strong>Raw:</strong> {lead.raw_content ?? '—'}
            <br />
            <br />
            <a href={lead.url} target="_blank" rel="noreferrer">
              {lead.url}
            </a>
          </td>
        </tr>
      )}
    </>
  );
}
