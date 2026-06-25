'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Lead, Outreach } from '@/lib/types';
import { formatDate } from '@/lib/leads';
import styles from './OutreachQueue.module.css';

export default function OutreachQueue({
  leads,
  outreach,
  onRefresh,
}: {
  leads: Lead[];
  outreach: Outreach[];
  onRefresh: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pending = outreach
    .filter((o) => o.status === 'pending')
    .sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

  function leadTitle(leadId: string | null): string {
    if (!leadId) return '—';
    return leads.find((l) => l.id === leadId)?.title ?? '—';
  }

  async function approve(row: Outreach) {
    setError(null);
    // Leads carry no recipient column, so ask for the address at send time.
    const to = window.prompt('Send to which email address?')?.trim();
    if (!to) return;
    setBusy(row.id);
    try {
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outreach_id: row.id,
          to,
          subject: `Re: ${leadTitle(row.lead_id)}`,
          body: row.draft_content ?? '',
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Send failed (${res.status})`);
      }
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed.');
    } finally {
      setBusy(null);
    }
  }

  async function reject(row: Outreach) {
    setBusy(row.id);
    await supabase.from('outreach').delete().eq('id', row.id);
    setBusy(null);
    onRefresh();
  }

  return (
    <section className={styles.wrap}>
      <div className={styles.heading}>
        <span className="bracket">[</span> Outreach Queue — {pending.length}{' '}
        pending <span className="bracket">]</span>
      </div>
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Lead</th>
              <th>Draft Preview</th>
              <th>Created</th>
              <th />
              <th />
            </tr>
          </thead>
          <tbody>
            {pending.length === 0 && (
              <tr>
                <td className={styles.empty} colSpan={5}>
                  No pending drafts.
                </td>
              </tr>
            )}
            {pending.map((row) => (
              <tr key={row.id} className={styles.row}>
                <td className={styles.title}>{leadTitle(row.lead_id)}</td>
                <td className={styles.preview}>
                  {(row.draft_content ?? '').slice(0, 100) || '—'}
                </td>
                <td className={styles.meta}>{formatDate(row.created_at)}</td>
                <td>
                  <button
                    className={styles.approve}
                    onClick={() => approve(row)}
                    disabled={busy === row.id}
                  >
                    {busy === row.id ? 'Working…' : 'Approve'}
                  </button>
                </td>
                <td>
                  <button
                    className={styles.reject}
                    onClick={() => reject(row)}
                    disabled={busy === row.id}
                  >
                    Reject
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
