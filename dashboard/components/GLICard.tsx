'use client';

import type { GLILead } from '@/lib/types';
import { formatDate } from '@/lib/leads';
import SourceLink from './SourceLink';
import styles from './GLICard.module.css';

// Hostname of the lead's url, as a compact source label. Null when the url is
// missing or unparseable.
function sourceHost(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export default function GLICard({
  lead,
  onSelect,
}: {
  lead: GLILead;
  onSelect: (lead: GLILead) => void;
}) {
  const host = sourceHost(lead.url);
  const date = lead.date_found ? formatDate(lead.date_found) : null;
  const hasContact =
    !!lead.contact_name || !!lead.contact_email || !!lead.contact_phone;

  return (
    <button className={styles.card} onClick={() => onSelect(lead)}>
      {lead.title && <div className={styles.title}>{lead.title}</div>}
      {lead.location && <div className={styles.location}>{lead.location}</div>}

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

      {(host || date) && (
        <div className={styles.metaLine}>
          {host && <span>{host}</span>}
          {host && date && <span className={styles.dot}>·</span>}
          {date && <span>{date}</span>}
        </div>
      )}

      {lead.url && (
        <div className={styles.sourceRow}>
          <SourceLink url={lead.url} />
        </div>
      )}

      {hasContact && (
        <div className={styles.contact}>
          {lead.contact_name && (
            <span className={styles.contactLine}>{lead.contact_name}</span>
          )}
          {lead.contact_email && (
            <span className={styles.contactLine}>{lead.contact_email}</span>
          )}
          {lead.contact_phone && (
            <span className={styles.contactLine}>{lead.contact_phone}</span>
          )}
        </div>
      )}
    </button>
  );
}
