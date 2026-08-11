'use client';

// THE PEOPLE, FOR THE SCREENS.
//
// lib/people is pure so the report builder can use it on the server. This is the
// browser half: it reads the project and its records from the caches the two
// surfaces already populate, and layers on the cross-market history that needs a
// query.
//
// WHY IT IS ONE HOOK RATHER THAN TWO BLOCKS OF JSX. Before this there were three
// implementations of "who is on this project": the report built parties from
// records, the project page read the companies table, and the register pane read
// projects.primary_applicant and primary_representative. Three answers to one
// question, and the one a client sees is the one nobody re-reads. The register
// pane in particular could only ever show two parties, because that is how many
// columns it was reading.

import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { useProject, useProjectTimeline } from './use-projects';
import {
  buildParties,
  noPartiesNote,
  normaliseParty,
  withPartyHistory,
  type PartyHistory,
  type ProjectParty,
} from './people';

/**
 * Where else each of this project's parties appears, from company_projects.
 *
 * Two queries, not one per party: the companies on this project, then every
 * OTHER project those companies are attached to. Nothing is claimed unless the
 * companies layer actually holds it.
 */
export async function fetchPartyHistory(projectId: string): Promise<Map<string, PartyHistory>> {
  const { data: mine, error: e1 } = await supabase
    .from('company_projects')
    .select('company_id,company:companies!inner(id,name)')
    .eq('project_id', projectId);
  if (e1) throw new Error(`party history failed: ${e1.message}`);
  const rows = (mine ?? []) as unknown as { company_id: string; company: { id: string; name: string } }[];
  if (rows.length === 0) return new Map();

  const nameById = new Map(rows.map((r) => [r.company_id, r.company?.name ?? '']));
  const { data: others, error: e2 } = await supabase
    .from('company_projects')
    .select('company_id,role,project:projects!inner(id,market)')
    .in('company_id', [...nameById.keys()])
    .neq('project_id', projectId);
  if (e2) throw new Error(`party history failed: ${e2.message}`);

  const out = new Map<string, PartyHistory>();
  for (const r of (others ?? []) as unknown as {
    company_id: string;
    role: string | null;
    project: { id: string; market: string | null };
  }[]) {
    const name = nameById.get(r.company_id);
    if (!name || !r.project) continue;
    const key = normaliseParty(name);
    if (!out.has(key)) out.set(key, { projects: [] });
    out.get(key)!.projects.push({ market: r.project.market, role: r.role });
  }
  return out;
}

export function usePartyHistory(projectId: string | null) {
  return useQuery({
    queryKey: ['project', 'party-history', projectId ?? ''],
    queryFn: () => fetchPartyHistory(projectId as string),
    enabled: !!projectId,
    staleTime: 60_000,
  });
}

export interface ProjectPeople {
  parties: ProjectParty[];
  /** Set when the records name nobody. Rendered instead of an empty heading. */
  note: string | null;
  isPending: boolean;
}

/**
 * The same list the report prints, for a screen.
 *
 * Built from the project and its records, which both callers already have in
 * cache, so this adds one query and only for the history.
 */
export function useProjectPeople(projectId: string | null): ProjectPeople {
  const project = useProject(projectId ?? '');
  const timeline = useProjectTimeline(projectId ?? '');
  const history = usePartyHistory(projectId);

  const isPending = project.isPending || timeline.isPending;
  if (isPending || !project.data) return { parties: [], note: null, isPending: true };

  const records = timeline.data ?? [];
  const base = buildParties(project.data, records);
  const parties = history.data ? withPartyHistory(base, history.data) : base;
  return {
    parties,
    note: parties.length === 0 ? noPartiesNote(records) : null,
    isPending: false,
  };
}
