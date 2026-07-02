'use client';

import type { Lead } from '@/lib/types';
import { signalJurisdiction, signalTypeLabel } from '@/lib/category';
import SourceLink from './SourceLink';
import styles from './SignalsView.module.css';

// Dedicated table for the Signals category (Part B, LATAM/Caribbean). Columns:
// title, regulator, jurisdiction, signal_type, signal_date, and a clickable
// source link. Rows arrive pre-sorted by signal_date descending
// (applyCategoryFilter); a defensive sort keeps that order if reused elsewhere.
const COLUMNS = ['Title', 'Regulator', 'Jurisdiction', 'Signal Type', 'Signal Date', 'Source'];

export default function SignalsView({
  leads,
  onSelect,
}: {
  leads: Lead[];
  onSelect: (lead: Lead) => void;
}) {
  const rows = [...leads].sort((a, b) => {
    const ta = a.signal_date ? new Date(a.signal_date).getTime() : -Infinity;
    const tb = b.signal_date ? new Date(b.signal_date).getTime() : -Infinity;
    return tb - ta;
  });

  return (
    <section className={styles.wrap}>
      <div className={styles.heading}>
        <span className="bracket">[</span> Signals — {rows.length}{' '}
        <span className="bracket">]</span>
      </div>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className={styles.empty} colSpan={COLUMNS.length}>
                  No signals match the current filters.
                </td>
              </tr>
            )}
            {rows.map((lead) => (
              <tr
                key={lead.id}
                className={styles.row}
                onClick={() => onSelect(lead)}
                title="Open signal detail"
              >
                <td className={styles.titleCell}>{lead.title ?? '—'}</td>
                <td className={styles.meta}>{lead.regulator ?? '—'}</td>
                <td className={styles.meta}>{signalJurisdiction(lead)}</td>
                <td className={styles.meta}>{signalTypeLabel(lead.signal_type)}</td>
                <td className={styles.meta}>{lead.signal_date ? lead.signal_date.slice(0, 10) : '—'}</td>
                <td>
                  <SourceLink url={lead.url} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
