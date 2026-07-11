'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './Nav.module.css';

export type View = 'kanban' | 'list';

export default function Nav({
  view,
  onViewChange,
  agentsOpen,
  onToggleAgents,
  onSignOut,
}: {
  view: View;
  onViewChange: (view: View) => void;
  agentsOpen: boolean;
  onToggleAgents: () => void;
  onSignOut: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav className={styles.nav}>
      <div className="mono" style={{ fontSize: 12, letterSpacing: '0.04em' }}>
        <span className="bracket">[</span> PHILIP KWONG / PIPELINE{' '}
        <span className="bracket">]</span>
      </div>

      <div className={styles.toggle}>
        <button
          className={view === 'kanban' ? styles.active : ''}
          onClick={() => onViewChange('kanban')}
        >
          Kanban
        </button>
        <button
          className={view === 'list' ? styles.active : ''}
          onClick={() => onViewChange('list')}
        >
          List
        </button>
      </div>

      <div className={styles.right}>
        <Link
          href="/gli"
          className={`${styles.link} ${pathname === '/gli' ? styles.active : ''}`}
        >
          GLI
        </Link>
        <button
          className={agentsOpen ? styles.active : ''}
          onClick={onToggleAgents}
        >
          Agents
        </button>
        <button onClick={onSignOut}>Sign Out</button>
      </div>
    </nav>
  );
}
