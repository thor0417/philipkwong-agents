'use client';

import styles from './SourceLink.module.css';

// External link to a lead's source URL. Renders nothing when url is null.
// stopPropagation so clicks inside a clickable row/card do not also select it.
export default function SourceLink({ url }: { url: string | null }) {
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
