'use client';

import styles from './GLISourceLink.module.css';

// GLI-scoped external source link (EMPHASIS cut). Renders nothing when url is
// null; stopPropagation so a click inside a clickable table row does not also
// select the row. Separate from the shared SourceLink so the pipeline views stay
// untouched.
export default function GLISourceLink({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <a
      className={styles.link}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
    >
      [ SOURCE ]
    </a>
  );
}
