'use client';

// THE SCOPE PREVIEW STRIP. Four numbers and a sentence.
//
// Lives in components/ rather than beside the clients page because a Next App
// Router page may export only its default - the build refuses any other export,
// which is how this was found - and because both the intake form and the client
// detail's inline editor render it. Two copies of a count is two counts that can
// disagree.

import { useMemo } from 'react';
import type { ClientScope } from '@/lib/clients';
import { useScopePreview } from '@/lib/use-clients';
import { resolvePeriod } from '@/lib/period';
import styles from '@/app/(app)/clients/page.module.css';

export default function ScopePreviewStrip({ scope }: { scope: ClientScope }) {
  // The preview's "new" window is the last 30 days. Deliberately fixed rather
  // than tied to the screen's period control: this answers "is this scope
  // alive", which is a property of the scope, not of whatever period happens to
  // be selected elsewhere.
  const now = useMemo(() => new Date(), []);
  const period = useMemo(() => resolvePeriod('30d', now), [now]);
  const preview = useScopePreview(scope, period);
  const d = preview.data;

  return (
    <div className={styles.previewStrip} data-testid="scope-preview">
      <div className={`${styles.stat} ${d && d.projects === 0 ? styles.zero : ''}`}>
        <span className={styles.statN} data-testid="preview-projects">
          {preview.isPending ? '--' : d?.projects}
        </span>
        <span className={styles.statLabel}>Projects</span>
      </div>
      <div className={`${styles.stat} ${d && d.records === 0 ? styles.zero : ''}`}>
        <span className={styles.statN} data-testid="preview-records">
          {preview.isPending ? '--' : d?.records}
        </span>
        <span className={styles.statLabel}>Records</span>
      </div>
      <div className={styles.stat}>
        <span className={styles.statN} data-testid="preview-new">
          {preview.isPending ? '--' : d?.newProjects}
        </span>
        <span className={styles.statLabel}>New in 30 days</span>
      </div>
      <div className={styles.stat}>
        <span className={styles.statN}>{preview.isPending ? '--' : d?.newRecords}</span>
        <span className={styles.statLabel}>New records</span>
      </div>

      <span className={styles.hint}>
        {preview.isError
          ? `Preview failed: ${(preview.error as Error).message}`
          : d && d.projects === 0
            ? 'This scope matches nothing. A report generated from it would be empty.'
            : d
              ? `${d.ms} ms.${
                  d.postFiltered.length
                    ? ` Counted over fetched rows for ${d.postFiltered.join(', ')}: an axis naming several values, or one the project query cannot express at all, is resolved here rather than by the database.`
                    : ''
                }${d.capped ? ' ROW CAP REACHED, this count may be short.' : ''}`
              : ''}
      </span>
    </div>
  );
}
