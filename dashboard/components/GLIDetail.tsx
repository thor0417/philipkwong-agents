'use client';

import type { GLILead } from '@/lib/types';
import { categoryForVenue } from '@/lib/taxonomy';
import GLISourceLink from './GLISourceLink';
import styles from './GLIDetail.module.css';

function ymd(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '';
}

// Source-tier color, matching the tables: primary accent, trade ink, news muted.
function tierColor(tier: string): string {
  if (tier === 'primary') return 'var(--accent)';
  if (tier === 'trade') return 'var(--ink)';
  return 'var(--muted)';
}

// Slide-in detail panel for a GLI record. Everything in the PP Neue York type
// system (no DM Mono). Full raw_content, never truncated. Contact block only when
// a contact is present. development_category and venue_type shown as tags. The
// source URL is a real, clickable anchor.
export default function GLIDetail({
  lead,
  onClose,
}: {
  lead: GLILead | null;
  onClose: () => void;
}) {
  if (!lead) return null;

  const category = lead.development_category ?? categoryForVenue(lead.venue_type);
  const hasContact = !!(lead.contact_name || lead.contact_email || lead.contact_phone);
  const players: { label: string; value: string }[] = [];
  const pushPlayer = (label: string, value: string | null | undefined) => {
    if (value) players.push({ label, value });
  };
  pushPlayer('Presented by', lead.presented_by);
  pushPlayer('Applicant', lead.applicant);
  pushPlayer('Representative', lead.representative);
  pushPlayer('Action sought', lead.action_sought);

  const rows: { label: string; value: string }[] = [];
  const push = (label: string, value: string | number | null) => {
    if (value !== null && value !== undefined && value !== '') {
      rows.push({ label, value: String(value) });
    }
  };
  push('Company', lead.company);
  push('Stream', lead.stream);
  push('Deadline', ymd(lead.deadline));
  push('Published', ymd(lead.published_date));
  push('Date Found', ymd(lead.date_found));
  push('Score', lead.score);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <aside
        className={styles.panel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="GLI record"
      >
        <header className={styles.header}>
          <div className={styles.headText}>
            {lead.title && <div className={styles.title}>{lead.title}</div>}
            {lead.location && <div className={styles.location}>{lead.location}</div>}
            <div className={styles.tags}>
              <span className={styles.categoryTag}>{category}</span>
              {lead.venue_type && <span className={styles.venueTag}>{lead.venue_type}</span>}
              {lead.signal_type && <span className={styles.signalTag}>{lead.signal_type}</span>}
              {lead.source_type && <span className={styles.venueTag}>{lead.source_type}</span>}
            </div>
            {lead.url && (
              <div className={styles.sourceRow}>
                <GLISourceLink url={lead.url} />
              </div>
            )}
          </div>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {/* Full raw_content, never truncated. The panel scrolls if it is long. */}
        {lead.raw_content && (
          <section className={styles.section}>
            <div className={styles.sectionHead}>Record Content</div>
            <p className={styles.body}>{lead.raw_content}</p>
          </section>
        )}

        {hasContact && (
          <section className={styles.section}>
            <div className={styles.sectionHead}>Contact</div>
            <div className={styles.grid}>
              {lead.contact_name && (
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Name</span>
                  <span className={styles.fieldValue}>{lead.contact_name}</span>
                </div>
              )}
              {lead.contact_email && (
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Email</span>
                  <a className={styles.fieldLink} href={`mailto:${lead.contact_email}`}>
                    {lead.contact_email}
                  </a>
                </div>
              )}
              {lead.contact_phone && (
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Phone</span>
                  <span className={styles.fieldValue}>{lead.contact_phone}</span>
                </div>
              )}
            </div>
          </section>
        )}

        {players.length > 0 && (
          <section className={styles.section}>
            <div className={styles.sectionHead}>Players</div>
            <div className={styles.grid}>
              {players.map((p) => (
                <div key={p.label} className={styles.field}>
                  <span className={styles.fieldLabel}>{p.label}</span>
                  <span className={styles.fieldValue}>{p.value}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {lead.primary_document_url && (
          <section className={styles.section}>
            <div className={styles.sectionHead}>Primary Document</div>
            <a
              className={styles.fieldLink}
              href={lead.primary_document_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              View Primary Document
            </a>
          </section>
        )}

        {(rows.length > 0 || lead.source_tier) && (
          <section className={styles.section}>
            <div className={styles.sectionHead}>Details</div>
            <div className={styles.grid}>
              {rows.map((r) => (
                <div key={r.label} className={styles.field}>
                  <span className={styles.fieldLabel}>{r.label}</span>
                  <span className={styles.fieldValue}>{r.value}</span>
                </div>
              ))}
              {lead.source_tier && (
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Source Tier</span>
                  <span className={styles.fieldValue} style={{ color: tierColor(lead.source_tier) }}>
                    {lead.source_tier}
                  </span>
                </div>
              )}
            </div>
          </section>
        )}

        {/* The url as a working, clickable anchor. */}
        {lead.url && (
          <section className={styles.section}>
            <div className={styles.sectionHead}>Source Link</div>
            <a className={styles.urlLink} href={lead.url} target="_blank" rel="noopener noreferrer">
              {lead.url}
            </a>
          </section>
        )}
      </aside>
    </div>
  );
}
