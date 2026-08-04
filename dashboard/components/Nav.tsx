'use client';

// Screen controls for the legacy pipeline view. NOT navigation any more.
//
// This used to carry a wordmark, cross-screen links and Sign Out. The shell now
// owns all three, so keeping them here would have meant two wordmarks and two
// sign-out buttons on the same page. What is left is what genuinely belongs to
// this screen: its view toggle and its agents panel.

import styles from './Nav.module.css';

export type View = 'kanban' | 'list';

export default function Nav({
  view,
  onViewChange,
  agentsOpen,
  onToggleAgents,
}: {
  view: View;
  onViewChange: (view: View) => void;
  agentsOpen: boolean;
  onToggleAgents: () => void;
}) {
  return (
    <nav className={styles.nav}>
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
        <button className={agentsOpen ? styles.active : ''} onClick={onToggleAgents}>
          Agents
        </button>
      </div>
    </nav>
  );
}
