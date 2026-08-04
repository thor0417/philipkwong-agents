// COMPANIES: the relationship graph, read out of data that already exists.
//
// Nothing here captures anything new. companies and company_projects were
// populated by the scraper; every question below is a join over them. That is
// the point of the company screens: the corridor plays and the repeat
// counterparties are already in the database, they have simply never been
// asked for.
//
// MERGED COMPANIES ARE HIDDEN, NOT DELETED. Normalisation is exact-after-
// cleaning by design (fuzzy matching was tested and rejected because it merged
// genuinely different firms), so duplicates accumulate and a human has to
// resolve them. A merge repoints the links and marks the loser with a
// manual_overrides.merged_into pointer. Every read filters those out. Nothing
// is destroyed, so a wrong merge is recoverable, and because it lives in
// manual_overrides it is an override no future scraper run reverts.

import { supabase } from './supabase';

export interface Company {
  id: string;
  name: string;
  normalized_name: string | null;
  company_type: string | null;
  notes: string | null;
  manual_overrides: Record<string, unknown> | null;
  first_seen: string | null;
  last_activity: string | null;
}

export interface CompanyLink {
  company_id: string;
  project_id: string;
  role: string | null;
  first_seen: string | null;
}

/** A party on a project, with the role it held. */
export interface Party extends Company {
  role: string | null;
}

/** A project a company is attached to, with the role held on it. */
export interface CompanyProject {
  id: string;
  name: string;
  market: string | null;
  stage: string | null;
  last_activity: string | null;
  record_count: number | null;
  role: string | null;
}

const COMPANY_COLUMNS =
  'id,name,normalized_name,company_type,notes,manual_overrides,first_seen,last_activity';

/** True when this row has been merged away and should not be shown. */
export function isMerged(c: Pick<Company, 'manual_overrides'>): boolean {
  const m = c.manual_overrides as { merged_into?: unknown } | null;
  return !!m && typeof m.merged_into === 'string';
}

export async function fetchCompany(id: string): Promise<Company | null> {
  const { data, error } = await supabase
    .from('companies')
    .select(COMPANY_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`company load failed: ${error.message}`);
  return (data as Company) ?? null;
}

/** Every party on one project. The Project page's People block. */
export async function fetchProjectParties(projectId: string): Promise<Party[]> {
  const { data, error } = await supabase
    .from('company_projects')
    .select(`role,first_seen,company:companies!inner(${COMPANY_COLUMNS})`)
    .eq('project_id', projectId);
  if (error) throw new Error(`project parties failed: ${error.message}`);

  const rows = (data ?? []) as unknown as { role: string | null; company: Company }[];
  return rows
    .filter((r) => r.company && !isMerged(r.company))
    .map((r) => ({ ...r.company, role: r.role }))
    // Applicant first: it is the party the operator is actually looking for.
    .sort((a, b) => (a.role === 'applicant' ? -1 : b.role === 'applicant' ? 1 : 0));
}

/** Every project one company has filed on. The Company page's spine. */
export async function fetchCompanyProjects(companyId: string): Promise<CompanyProject[]> {
  const { data, error } = await supabase
    .from('company_projects')
    .select(
      'role,project:projects!inner(id,name,market,stage,last_activity,record_count)'
    )
    .eq('company_id', companyId);
  if (error) throw new Error(`company projects failed: ${error.message}`);

  const rows = (data ?? []) as unknown as {
    role: string | null;
    project: Omit<CompanyProject, 'role'>;
  }[];
  return rows
    .filter((r) => !!r.project)
    .map((r) => ({ ...r.project, role: r.role }))
    .sort((a, b) => (b.last_activity ?? '').localeCompare(a.last_activity ?? ''));
}

export interface RelatedProject {
  id: string;
  name: string;
  market: string | null;
  stage: string | null;
  last_activity: string | null;
  /** Why it is related, in the operator's words. */
  reasons: string[];
}

/**
 * RELATED PROJECTS. The sleeper feature: this is where a corridor play becomes
 * visible.
 *
 * Three signals, and each is LABELLED on the result rather than blended into a
 * score, because "same applicant" and "same market" are very different claims
 * and the operator needs to know which one they are looking at.
 *
 *   shared party  - the same company appears on both projects. Strongest.
 *   same market   - the honest stand-in for the brief's "adjacent site". This
 *                   database stores a market, not a coordinate or a parcel, so
 *                   true adjacency cannot be computed. Calling it "same market"
 *                   says exactly what was checked.
 */
export async function fetchRelatedProjects(
  projectId: string,
  market: string | null
): Promise<RelatedProject[]> {
  const reasons = new Map<string, Set<string>>();

  // 1. Projects sharing a party with this one.
  const { data: mine } = await supabase
    .from('company_projects')
    .select('company_id')
    .eq('project_id', projectId);
  const companyIds = [...new Set(((mine ?? []) as CompanyLink[]).map((r) => r.company_id))];

  if (companyIds.length > 0) {
    const { data: siblings, error } = await supabase
      .from('company_projects')
      .select('project_id,company:companies!inner(name,manual_overrides)')
      .in('company_id', companyIds)
      .neq('project_id', projectId);
    if (error) throw new Error(`related projects failed: ${error.message}`);
    for (const r of (siblings ?? []) as unknown as {
      project_id: string;
      company: { name: string; manual_overrides: Record<string, unknown> | null };
    }[]) {
      if (!r.company || isMerged(r.company)) continue;
      if (!reasons.has(r.project_id)) reasons.set(r.project_id, new Set());
      reasons.get(r.project_id)!.add(`shares ${r.company.name}`);
    }
  }

  // 2. Projects in the same market. Capped: a market can hold hundreds, and
  //    "everything near it" is not a relationship.
  if (market) {
    const { data: near } = await supabase
      .from('projects')
      .select('id')
      .eq('market', market)
      .neq('id', projectId)
      .order('last_activity', { ascending: false })
      .limit(12);
    for (const r of (near ?? []) as { id: string }[]) {
      if (!reasons.has(r.id)) reasons.set(r.id, new Set());
      reasons.get(r.id)!.add(`same market`);
    }
  }

  if (reasons.size === 0) return [];

  const { data: projects, error } = await supabase
    .from('projects')
    .select('id,name,market,stage,last_activity')
    .in('id', [...reasons.keys()]);
  if (error) throw new Error(`related project load failed: ${error.message}`);

  return ((projects ?? []) as Omit<RelatedProject, 'reasons'>[])
    .map((p) => ({ ...p, reasons: [...(reasons.get(p.id) ?? [])] }))
    // A shared party outranks a shared market, always.
    .sort((a, b) => {
      const aShared = a.reasons.some((r) => r.startsWith('shares')) ? 1 : 0;
      const bShared = b.reasons.some((r) => r.startsWith('shares')) ? 1 : 0;
      if (aShared !== bShared) return bShared - aShared;
      return (b.last_activity ?? '').localeCompare(a.last_activity ?? '');
    });
}

export interface RelatedCompany extends Company {
  /** Projects on which both companies appear. */
  shared: number;
}

/**
 * RELATED COMPANIES: parties that co-occur across projects.
 *
 * This is the relationship graph falling out of the data rather than being
 * built. A developer who brings the same law firm to every hearing shows up
 * here without anything having been captured to make it so.
 */
export async function fetchRelatedCompanies(companyId: string): Promise<RelatedCompany[]> {
  const { data: mine } = await supabase
    .from('company_projects')
    .select('project_id')
    .eq('company_id', companyId);
  const projectIds = [...new Set(((mine ?? []) as CompanyLink[]).map((r) => r.project_id))];
  if (projectIds.length === 0) return [];

  const { data, error } = await supabase
    .from('company_projects')
    .select(`company_id,company:companies!inner(${COMPANY_COLUMNS})`)
    .in('project_id', projectIds)
    .neq('company_id', companyId);
  if (error) throw new Error(`related companies failed: ${error.message}`);

  const counts = new Map<string, { company: Company; shared: number }>();
  for (const r of (data ?? []) as unknown as { company_id: string; company: Company }[]) {
    if (!r.company || isMerged(r.company)) continue;
    const cur = counts.get(r.company_id);
    if (cur) cur.shared += 1;
    else counts.set(r.company_id, { company: r.company, shared: 1 });
  }

  return [...counts.values()]
    .map((c) => ({ ...c.company, shared: c.shared }))
    .sort((a, b) => b.shared - a.shared);
}

/** Company search, for the merge picker. */
export async function searchCompanies(term: string, limit = 12): Promise<Company[]> {
  const t = term.trim();
  if (t.length < 2) return [];
  const { data, error } = await supabase
    .from('companies')
    .select(COMPANY_COLUMNS)
    .ilike('name', `%${t}%`)
    .limit(limit * 2);
  if (error) throw new Error(`company search failed: ${error.message}`);
  return ((data ?? []) as Company[]).filter((c) => !isMerged(c)).slice(0, limit);
}

/**
 * MERGE. Fold `loserId` into `winnerId`.
 *
 * Order matters and is chosen so a failure halfway leaves something readable
 * rather than something lost:
 *
 *   1. Repoint the loser's project links to the winner. Links that would
 *      duplicate an existing (winner, project, role) row are dropped rather
 *      than repointed, because the unique constraint would reject them and a
 *      duplicate role tells the reader nothing.
 *   2. Mark the loser merged. Only now is it hidden, so if step 1 fails the
 *      loser is still visible and still holds its links.
 *
 * NO DDL. This project cannot run migrations from code, so the merge marker
 * lives in the manual_overrides JSON both tables already have rather than in a
 * new merged_into column. That also makes it exactly what the brief asks for:
 * a manual override that no future run reverts.
 */
export async function mergeCompanies(winnerId: string, loserId: string): Promise<void> {
  if (winnerId === loserId) throw new Error('A company cannot be merged into itself.');

  const [winner, loser] = await Promise.all([fetchCompany(winnerId), fetchCompany(loserId)]);
  if (!winner || !loser) throw new Error('Both companies must exist to merge them.');

  const { data: winnerLinks } = await supabase
    .from('company_projects')
    .select('project_id,role')
    .eq('company_id', winnerId);
  const held = new Set(
    ((winnerLinks ?? []) as CompanyLink[]).map((l) => `${l.project_id}::${l.role ?? ''}`)
  );

  const { data: loserLinks, error: linkErr } = await supabase
    .from('company_projects')
    .select('id,project_id,role')
    .eq('company_id', loserId);
  if (linkErr) throw new Error(`merge failed reading links: ${linkErr.message}`);

  for (const link of (loserLinks ?? []) as (CompanyLink & { id: string })[]) {
    const key = `${link.project_id}::${link.role ?? ''}`;
    if (held.has(key)) {
      const { error } = await supabase.from('company_projects').delete().eq('id', link.id);
      if (error) throw new Error(`merge failed removing duplicate link: ${error.message}`);
    } else {
      const { error } = await supabase
        .from('company_projects')
        .update({ company_id: winnerId })
        .eq('id', link.id);
      if (error) throw new Error(`merge failed repointing link: ${error.message}`);
      held.add(key);
    }
  }

  const mergedNames = [
    ...(((winner.manual_overrides as { merged_names?: string[] } | null)?.merged_names) ?? []),
    loser.name,
  ];
  const { error: winErr } = await supabase
    .from('companies')
    .update({
      manual_overrides: { ...(winner.manual_overrides ?? {}), merged_names: mergedNames },
    })
    .eq('id', winnerId);
  if (winErr) throw new Error(`merge failed recording on winner: ${winErr.message}`);

  const { error: loseErr } = await supabase
    .from('companies')
    .update({
      manual_overrides: {
        ...(loser.manual_overrides ?? {}),
        merged_into: winnerId,
        merged_at: new Date().toISOString(),
      },
    })
    .eq('id', loserId);
  if (loseErr) throw new Error(`merge failed marking loser: ${loseErr.message}`);
}
