'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import type { Lead } from '@/lib/types';
import PipelineTable from '@/components/PipelineTable';
import StatsBar from '@/components/StatsBar';

export default function PipelinePage() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function load() {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) {
        router.replace('/login');
        return;
      }

      const { data } = await supabase
        .from('leads')
        .select('*')
        .order('score', { ascending: false });

      if (!active) return;
      setLeads((data as Lead[]) ?? []);
      setLoading(false);
    }

    load();
    return () => {
      active = false;
    };
  }, [router]);

  async function handleStatusChange(id: string, status: string) {
    const previous = leads;
    // Optimistic update; revert if the write fails.
    setLeads((cur) => cur.map((l) => (l.id === id ? { ...l, status } : l)));
    const { error } = await supabase
      .from('leads')
      .update({ status })
      .eq('id', id);
    if (error) {
      console.error('Status update failed:', error.message);
      setLeads(previous);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  return (
    <main style={{ maxWidth: 1360, margin: '0 auto', padding: '40px 24px' }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 32,
        }}
      >
        <div className="mono" style={{ fontSize: 12, letterSpacing: '0.04em' }}>
          <span className="bracket">[</span> PHILIP KWONG / PIPELINE{' '}
          <span className="bracket">]</span>
        </div>
        <button onClick={signOut}>Sign out</button>
      </header>

      {loading ? (
        <p className="mono" style={{ color: 'var(--muted)' }}>
          Loading…
        </p>
      ) : (
        <>
          <StatsBar leads={leads} />
          <PipelineTable leads={leads} onStatusChange={handleStatusChange} />
        </>
      )}
    </main>
  );
}
