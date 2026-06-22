'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import type { Lead, Agent } from '@/lib/types';
import PipelineTable from '@/components/PipelineTable';
import AgentStatus from '@/components/AgentStatus';

export default function PipelinePage() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function load() {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) {
        router.replace('/login');
        return;
      }

      const [leadsRes, agentsRes] = await Promise.all([
        supabase.from('leads').select('*').order('score', { ascending: false }),
        supabase.from('agents').select('*').order('name', { ascending: true }),
      ]);

      if (!active) return;
      setLeads((leadsRes.data as Lead[]) ?? []);
      setAgents((agentsRes.data as Agent[]) ?? []);
      setLoading(false);
    }

    load();
    return () => {
      active = false;
    };
  }, [router]);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 24px' }}>
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
          <AgentStatus agents={agents} />
          <PipelineTable leads={leads} />
        </>
      )}
    </main>
  );
}
