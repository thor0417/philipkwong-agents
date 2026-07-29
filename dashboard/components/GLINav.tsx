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
        <Link href="/projects" className={styles.link}>
          Projects
        </Link>
        {/* /pipeline is the legacy fuel and consulting view. Its lanes were
            retired on 2026-07-29 (Brief A, Part 3), so it now shows 487 frozen
            rows that will never grow. The route still works and the rows are
            untouched; it is simply no longer presented as somewhere to go. */}
        <button className={styles.signout} onClick={onSignOut}>
          Sign Out
        </button>
      </div>
    </nav>
  );
}
