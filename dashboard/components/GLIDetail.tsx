'use client';

import type { GLILead } from '@/lib/types';
import { formatDate } from '@/lib/leads';
import SourceLink from './SourceLink';
import styles from './GLIDetail.module.css';

// Source-tier value color, matching the table: primary accent, trade ink,
// news muted.
function tierColor(tier: string): string {
  if (tier === 'primary') return 'var(--accent)';
  if (tier === 'trade') return 'var(--ink)';
  return 'var(--muted)';
}

// Slide-in detail panel for a GLI lead. Renders nothing when no lead is
// selected. Same overlay + right-hand panel pattern as DealRecord.
export default function GLIDetail({
  lead,
  onClose,
}: {
  lead: GLILead | null;
  onClose: () => void;
}) {
  if (!lead) return null;

  const rows: { label: string; value: string }[] = [];
  const push = (label: string, value: string | number | null) => {
    if (value !== null && value !== undefined && value !== '') {
      rows.push({ label, value: String(value) });
    }
  };
  push('Company', lead.company);
  push('Contact Name', lead.contact_name);
  push('Contact Email', lead.contact_email);
  push('Contact Phone', lead.contact_phone);
  push('Date Found', lead.date_found ? formatDate(lead.date_found) : null);
  push('Score', lead.score);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <aside
        className={styles.panel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="GLI lead record"
      >
        <header className={styles.header}>
          <div className={styles.headText}>
            {lead.title && <div className={styles.title}>{lead.title}</div>}
            {lead.location && (
              <div className={styles.location}>{lead.location}</div>
            )}
            {(lead.venue_type || lead.signal_type) && (
              <div className={styles.tags}>
                {lead.venue_type && (
                  <span className={styles.venueTag}>{lead.venue_type}</span>
                )}
                {lead.signal_type && (
                  <span className={styles.signalTag}>{lead.signal_type}</span>
                )}
              </div>
            )}
            {lead.url && (
              <div className={styles.sourceRow}>
                <SourceLink url={lead.url} />
              </div>
            )}
          </div>
          <button
            className={styles.close}
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        {/* Full raw_content, never truncated. The panel scrolls if it is long. */}
        {lead.raw_content && (
          <section className={styles.section}>
            <div className={styles.sectionHead}>Article Snippet</div>
            <p className={styles.snippet}>{lead.raw_content}</p>
          </section>
        )}

        {(rows.length > 0 || lead.source_tier) && (
          <section className={styles.section}>
            <div className={styles.grid}>
              {rows.map((r) => (
                <div key={r.label} className={styles.field}>
                  <span className={styles.fieldLabel}>{r.label}</span>
                  <span className={styles.tag}>{r.value}</span>
                </div>
              ))}
              {lead.source_tier && (
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Source Tier</span>
                  <span
                    className={styles.tag}
                    style={{ color: tierColor(lead.source_tier) }}
                  >
                    {lead.source_tier}
                  </span>
                </div>
              )}
            </div>
          </section>
        )}

        {/* The url as a working, clickable anchor (not plain text). */}
        {lead.url && (
          <section className={styles.section}>
            <div className={styles.sectionHead}>Link</div>
            <a
              href={lead.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontFamily: 'var(--font-dm-mono), monospace',
                fontSize: 11,
                color: 'var(--accent)',
                wordBreak: 'break-all',
                textDecoration: 'none',
              }}
            >
              {lead.url}
            </a>
          </section>
        )}
      </aside>
    </div>
  );
}
