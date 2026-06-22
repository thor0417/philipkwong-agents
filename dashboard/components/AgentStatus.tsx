'use client';

import type { Agent } from '@/lib/types';
import styles from './AgentStatus.module.css';

function badgeClass(status: string | null): string {
  switch (status) {
    case 'running':
      return styles.running;
    case 'error':
      return styles.error;
    default:
      return styles.idle;
  }
}

function formatRun(iso: string | null): string {
  return iso ? iso.slice(0, 16).replace('T', ' ') : 'never';
}

export default function AgentStatus({ agents }: { agents: Agent[] }) {
  return (
    <section className={styles.wrap}>
      <div className={styles.heading}>Agents — {agents.length}</div>
      <div className={styles.grid}>
        {agents.map((agent) => (
          <div className={styles.row} key={agent.id}>
            <span className={styles.name}>{agent.name}</span>
            <span className={`${styles.badge} ${badgeClass(agent.status)}`}>
              <span className="bracket">[</span> {agent.status ?? 'idle'}{' '}
              <span className="bracket">]</span>
            </span>
            <span className={styles.meta}>last: {formatRun(agent.last_run)}</span>
            <span className={styles.meta}>leads: {agent.leads_found ?? 0}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
