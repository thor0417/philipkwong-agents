'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { leadOrg, normalizeStatus } from '@/lib/leads';
import type { Agent, Lead, Outreach } from '@/lib/types';
import Nav, { type View } from '@/components/Nav';
import StatsBar from '@/components/StatsBar';
import AgentPanel from '@/components/AgentPanel';
import Kanban from '@/components/Kanban';
import PipelineTable from '@/components/PipelineTable';
import Filters, { EMPTY_FILTERS, type LeadFilters } from '@/components/Filters';
import OutreachQueue from '@/components/OutreachQueue';
import DealRecord from '@/components/DealRecord';

export default function PipelinePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  const [leads, setLeads] = useState<Lead[]>([]);
  const [outreach, setOutreach] = useState<Outreach[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);

  const [view, setView] = useState<View>('kanban');
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filters, setFilters] = useState<LeadFilters>(EMPTY_FILTERS);

  // Distinct sources present, for the source filter dropdown.
  const sources = useMemo(() => {
    const set = new Set<string>();
    leads.forEach((l) => l.source && set.add(l.source));
    return Array.from(set).sort();
  }, [leads]);

  // Combined client-side filtering for the list view table.
  const filteredLeads = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    const min = filters.minScore.trim() === '' ? 0 : Number(filters.minScore);
    return leads.filter((l) => {
      if (q) {
        const haystack = `${l.title ?? ''} ${leadOrg(l)}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (filters.source !== 'all' && l.source !== filters.source) return false;
      if (
        filters.status !== 'all' &&
        normalizeStatus(l.status) !== filters.status
      )
        return false;
      if (!Number.isNaN(min) && (l.score ?? 0) < min) return false;
      return true;
    });
  }, [leads, filters]);

  const load = useCallback(async () => {
    const [leadRes, outreachRes, agentRes] = await Promise.all([
      supabase.from('leads').select('*').order('score', { ascending: false }),
      supabase.from('outreach').select('*'),
      supabase.from('agents').select('*').order('name'),
    ]);

    setLeads((leadRes.data as Lead[]) ?? []);
    setOutreach((outreachRes.data as Outreach[]) ?? []);
    setAgents((agentRes.data as Agent[]) ?? []);
  }, []);

  useEffect(() => {
    let active = true;
    async function init() {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) {
        router.replace('/login');
        return;
      }
      await load();
      if (active) setLoading(false);
    }
    init();
    return () => {
      active = false;
    };
  }, [router, load]);

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

  const selected = leads.find((l) => l.id === selectedId) ?? null;

  return (
    <main style={{ maxWidth: 1360, margin: '0 auto', padding: '40px 24px' }}>
      <Nav
        view={view}
        onViewChange={setView}
        agentsOpen={agentsOpen}
        onToggleAgents={() => setAgentsOpen((o) => !o)}
        onSignOut={signOut}
      />

      {loading ? (
        <p className="mono" style={{ color: 'var(--muted)' }}>
          Loading…
        </p>
      ) : (
        <>
          <StatsBar leads={leads} />
          {agentsOpen && <AgentPanel agents={agents} onRefresh={load} />}

          {view === 'kanban' ? (
            <Kanban leads={leads} onSelect={(l) => setSelectedId(l.id)} />
          ) : (
            <>
              <Filters
                filters={filters}
                sources={sources}
                onChange={setFilters}
              />
              <PipelineTable
                leads={filteredLeads}
                onStatusChange={handleStatusChange}
                onSelect={(l) => setSelectedId(l.id)}
              />
              <OutreachQueue
                leads={leads}
                outreach={outreach}
                onRefresh={load}
              />
            </>
          )}

          <DealRecord
            lead={selected}
            outreach={outreach}
            onClose={() => setSelectedId(null)}
            onRefresh={load}
          />
        </>
      )}
    </main>
  );
}
