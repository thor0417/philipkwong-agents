'use client';

import { useState } from 'react';
import type { Agent } from '@/lib/types';
import { formatDate } from '@/lib/crm';
import styles from './AgentPanel.module.css';

// Agents that map to a runnable npm script on the server. The rest are seeded
// but deferred (see CLAUDE.md), so their Run Now is disabled.
const RUNNABLE: Record<string, string> = {
  'lead-scraper': 'scrape:leads',
  'intake-agent': 'intake',
};

function badgeClass(status: string | null): string {
  if (status === 'running') return styles.running;
  if (status === 'error') return styles.error;
  return styles.idle;
}

export default function AgentPanel({
  agents,
  onRefresh,
}: {
  agents: Agent[];
  onRefresh: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function run(name: string) {
    setBusy(name);
    setMessage(null);
    try {
      const res = await fetch('/api/run-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      setMessage(`${name} started.`);
      onRefresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Run failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.head}>
        <span>Agent</span>
        <span>Status</span>
        <span>Last Run</span>
        <span>Leads Found</span>
        <span />
      </div>
      {agents.map((a) => {
        const runnable = a.name in RUNNABLE;
        return (
          <div className={styles.row} key={a.id}>
            <span className={styles.name}>{a.name}</span>
            <span>
              <span className={`${styles.badge} ${badgeClass(a.status)}`}>
                {(a.status ?? 'idle').toUpperCase()}
              </span>
            </span>
            <span className={styles.meta}>{formatDate(a.last_run)}</span>
            <span className={styles.meta}>{a.leads_found ?? 0}</span>
            <span className={styles.action}>
              <button
                onClick={() => run(a.name)}
                disabled={!runnable || busy === a.name}
                title={runnable ? '' : 'Deferred — no runnable script'}
              >
                {busy === a.name ? 'Running…' : 'Run Now'}
              </button>
            </span>
          </div>
        );
      })}
      {message && <div className={styles.message}>{message}</div>}
    </section>
  );
}
