'use client';

import Link from 'next/link';
import styles from './GLINav.module.css';

// Standalone nav for the GLI page. Wordmark in DISPLAY (CondensedMedium); the
// links/buttons in EMPHASIS. Separate from Nav.tsx so the pipeline nav is not
// touched. Wordmark left; Pipeline link + Sign Out right.
export default function GLINav({ onSignOut }: { onSignOut: () => void }) {
  return (
    <nav className={styles.nav}>
      <div className={styles.wordmark}>PHILIP KWONG / GLI</div>
      <div className={styles.right}>
        <Link href="/pipeline" className={styles.link}>
          Pipeline
        </Link>
        <button className={styles.signout} onClick={onSignOut}>
          Sign Out
        </button>
      </div>
    </nav>
  );
}
