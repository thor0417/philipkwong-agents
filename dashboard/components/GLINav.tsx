'use client';

import Link from 'next/link';
import styles from './GLINav.module.css';

// Standalone nav for the GLI page. Mirrors Nav styling but is a separate
// component so Nav.tsx is not modified. Wordmark left; Pipeline link + Sign Out
// right.
export default function GLINav({ onSignOut }: { onSignOut: () => void }) {
  return (
    <nav className={styles.nav}>
      <div className="mono" style={{ fontSize: 12, letterSpacing: '0.04em' }}>
        <span className="bracket">[</span> PHILIP KWONG / GLI{' '}
        <span className="bracket">]</span>
      </div>

      <div className={styles.right}>
        <Link href="/pipeline" className={styles.link}>
          Pipeline
        </Link>
        <button onClick={onSignOut}>Sign Out</button>
      </div>
    </nav>
  );
}
