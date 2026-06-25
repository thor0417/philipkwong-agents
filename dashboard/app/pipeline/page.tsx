'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import type {
  Activity,
  Agent,
  DealWithRelations,
  Lead,
  Outreach,
} from '@/lib/types';
import Nav, { type View } from '@/components/Nav';
import StatsBar from '@/components/StatsBar';
import AgentPanel from '@/components/AgentPanel';
import Kanban from '@/components/Kanban';
import DealList from '@/components/DealList';
import DealRecord from '@/components/DealRecord';

const DEAL_SELECT =
  '*, contacts(*), leads(score, source, title, url, date_found)';

export default function PipelinePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  const [leads, setLeads] = useState<Lead[]>([]);
  const [deals, setDeals] = useState<DealWithRelations[]>([]);
  const [outreach, setOutreach] = useState<Outreach[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);

  const [view, setView] = useState<View>('kanban');
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [leadRes, dealRes, outreachRes, activityRes, agentRes] =
      await Promise.all([
        supabase.from('leads').select('*').order('score', { ascending: false }),
        supabase.from('deals').select(DEAL_SELECT),
        supabase.from('outreach').select('*'),
        supabase.from('activities').select('*'),
        supabase.from('agents').select('*').order('name'),
      ]);

    setLeads((leadRes.data as Lead[]) ?? []);
    setDeals((dealRes.data as unknown as DealWithRelations[]) ?? []);
    setOutreach((outreachRes.data as Outreach[]) ?? []);
    setActivities((activityRes.data as Activity[]) ?? []);
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

  async function signOut() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  const selected = deals.find((d) => d.id === selectedId) ?? null;

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
          <StatsBar leads={leads} deals={deals} outreach={outreach} />
          {agentsOpen && <AgentPanel agents={agents} onRefresh={load} />}

          {view === 'kanban' ? (
            <Kanban deals={deals} onSelect={(d) => setSelectedId(d.id)} />
          ) : (
            <DealList deals={deals} onSelect={(d) => setSelectedId(d.id)} />
          )}

          <DealRecord
            deal={selected}
            outreach={outreach}
            activities={activities}
            onClose={() => setSelectedId(null)}
            onRefresh={load}
          />
        </>
      )}
    </main>
  );
}
