// SERVER-SIDE QUERY LAYER FOR PROJECTS. Same rule as lib/query.ts: the register
// fetches a PAGE, never a table. Filtering, sorting, counting and searching all
// happen in Postgres, against the indexes in migration 016.
//
// The register is the primary view now, so it has to behave at 1,500 projects
// exactly as the leads table behaves at 20,000 records: bounded reads, exact
// counts with no rows transferred, and facets computed by the database.

import { LIVE_PIPELINE_STORAGE_KEY } from './pipelines';
import { supabase } from './supabase';

export const DEFAULT_PROJECT_PAGE_SIZE = 50;

// Columns the register table and the detail header need. Explicit, so a future
// wide column cannot quietly join every list render.
export const PROJECT_COLUMNS = [
  'id', 'module', 'name', 'project_key', 'country', 'region_state', 'market',
  'stage', 'development_category', 'venue_type', 'status', 'watch', 'notes',
  'manual_overrides', 'first_seen', 'last_activity', 'next_milestone',
  'record_count', 'primary_applicant', 'primary_representative', 'created_at',
].join(',');

export interface Project {
  id: string;
  module: string | null;
  name: string;
  project_key: string;
  country: string | null;
  region_state: string | null;
  market: string | null;
  stage: string | null;
  development_category: string | null;
  venue_type: string | null;
  status: string | null;
  watch: boolean | null;
  notes: string | null;
  manual_overrides: Record<string, unknown> | null;
  first_seen: string | null;
  last_activity: string | null;
  next_milestone: string | null;
  record_count: number | null;
  primary_applicant: string | null;
  primary_representative: string | null;
  created_at: string | null;
}

export interface ProjectQuery {
  module?: string;
  stage?: string;
  status?: string;
  excludeStatus?: string;
  country?: string;
  region_state?: string;
  market?: string;
  development_category?: string;
  watch?: boolean;
  // Activity window, on last_activity.
  activeFrom?: string;
  // THE PERIOD, on the ARRIVED axis: projects.first_seen, half-open
  // [firstSeenFrom, firstSeenTo). See lib/period.ts for why the upper bound is
  // exclusive and why both are full timestamps.
  firstSeenFrom?: string;
  firstSeenTo?: string;
  // THE PERIOD, on the MOVED axis. project_events lives in another table, so
  // this is a list of project ids resolved from it by the caller. An EMPTY
  // ARRAY IS MEANINGFUL and is not the same as undefined: it means the period
  // contained no events at all, and the honest answer is no projects rather
  // than every project.
  ids?: string[];
  search?: string;
  sortField?: string;
  sortDir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

// Free-text search over the fields a person actually searches a project by: what
// it is called, who is developing it, and who is representing them. Same three
// fields the brief specifies.
const PROJECT_SEARCH_FIELDS = ['name', 'primary_applicant', 'primary_representative'];

// PostgREST reads `or` as a comma-separated filter list, so the term is
// double-quoted rather than stripped. Stripping breaks the search it protects:
// "Brown, Brown & Premsrirut" is exactly how the county prints the firm.
function projectSearchFilter(term: string): string {
  const safe = term.trim().replace(/\s+/g, ' ').replace(/["\\]/g, '');
  return PROJECT_SEARCH_FIELDS.map((f) => `${f}.ilike."%${safe}%"`).join(',');
}

const NO_SUCH_ID = '00000000-0000-0000-0000-000000000000';

export function applyProjectFilters<T>(builder: T, q: ProjectQuery): T {
  let b = builder as unknown as {
    eq: (c: string, v: unknown) => unknown;
    not: (c: string, op: string, v: unknown) => unknown;
    gte: (c: string, v: unknown) => unknown;
    lt: (c: string, v: unknown) => unknown;
    in: (c: string, v: readonly unknown[]) => unknown;
    or: (f: string) => unknown;
  };
  const set = (fn: unknown): void => {
    b = fn as typeof b;
  };

  set(b.eq('module', q.module ?? LIVE_PIPELINE_STORAGE_KEY));
  if (q.stage) set(b.eq('stage', q.stage));
  if (q.status) set(b.eq('status', q.status));
  if (q.excludeStatus) set(b.not('status', 'eq', q.excludeStatus));
  if (q.country) set(b.eq('country', q.country));
  if (q.region_state) set(b.eq('region_state', q.region_state));
  if (q.market) set(b.eq('market', q.market));
  if (q.development_category) set(b.eq('development_category', q.development_category));
  if (q.watch !== undefined) set(b.eq('watch', q.watch));
  if (q.activeFrom) set(b.gte('last_activity', q.activeFrom));
  if (q.firstSeenFrom) set(b.gte('first_seen', q.firstSeenFrom));
  if (q.firstSeenTo) set(b.lt('first_seen', q.firstSeenTo));
  // `!== undefined`, not truthiness: an empty list is a real answer and must
  // produce an empty result, where `if (q.ids)` on [] would drop the filter and
  // return the whole register instead.
  // A UUID no row carries, because PostgREST renders an empty list as `in.()`
  // and the server rejects it. Substituting an impossible value keeps "no
  // events in this period" answering zero instead of erroring.
  if (q.ids !== undefined) set(b.in('id', q.ids.length ? q.ids : [NO_SUCH_ID]));
  if (q.search && q.search.trim()) set(b.or(projectSearchFilter(q.search)));

  return b as unknown as T;
}

export interface ProjectPage {
  rows: Project[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  // Rows actually transferred for this page load, and the wall clock of both
  // queries. Printed in the footer so "server-side paging" is a number on the
  // screen rather than a claim in a commit message.
  rowsFetched: number;
  rowsMs: number;
  countMs: number;
}

export async function fetchProjectPage(q: ProjectQuery): Promise<ProjectPage> {
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.max(1, q.pageSize ?? DEFAULT_PROJECT_PAGE_SIZE);
  const from = (page - 1) * pageSize;
  const sortField = q.sortField ?? 'last_activity';
  const ascending = q.sortDir === 'asc';

  const t0 = Date.now();
  const { data, error } = await applyProjectFilters(
    supabase.from('projects').select(PROJECT_COLUMNS),
    q
  )
    .order(sortField, { ascending, nullsFirst: false })
    // Stable tiebreak, so paging cannot repeat or skip a project when the sort
    // key ties (record_count ties constantly).
    .order('id', { ascending: true })
    .range(from, from + pageSize - 1);
  const rowsMs = Date.now() - t0;
  if (error) throw new Error(`project page query failed: ${error.message}`);

  const t1 = Date.now();
  const total = await countProjects(q);
  const countMs = Date.now() - t1;

  const rows = (data ?? []) as unknown as Project[];
  return {
    rows,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    rowsFetched: rows.length,
    rowsMs,
    countMs,
  };
}

export async function countProjects(q: ProjectQuery): Promise<number> {
  const { count, error } = await applyProjectFilters(
    supabase.from('projects').select('id', { count: 'exact', head: true }),
    q
  );
  if (error) throw new Error(`project count query failed: ${error.message}`);
  return count ?? 0;
}

// Faceted counts on one project column.
//
// Same pattern as facetCounts in lib/query.ts: the grouped query belongs in
// Postgres, so it calls the project_facet_counts function from migration 017.
// Until that migration is applied the fallback reads ONLY the one facet column
// for the current filter - never row bodies - and reports viaRpc:false, so the
// interim cost is visible rather than hidden.
export type ProjectFacetField = 'stage' | 'country' | 'region_state' | 'market' | 'development_category' | 'status';

export interface FacetCount {
  value: string;
  count: number;
}

export async function projectFacetCounts(
  base: ProjectQuery,
  field: ProjectFacetField
): Promise<{ counts: FacetCount[]; viaRpc: boolean; ms: number }> {
  const t0 = Date.now();
  // A FACET NEVER FILTERS ITSELF. Stripping it here rather than at the call site
  // is what makes the two paths below provably equivalent: the fallback already
  // dropped it, the RPC did not, so a caller that passed `stage` while asking for
  // the stage facet would get every chip but one reading zero -- and only once
  // migration 017 was applied, which is the worst possible time to find out.
  const scoped: ProjectQuery = { ...base, [field]: undefined };

  // THE RPC DOES NOT KNOW ABOUT THE PERIOD, so when a period is applied it must
  // not be used. Migration 017's function takes the filters that existed when it
  // was written; the period arrived after, and adding an argument to it is DDL,
  // which is Philip's to run and not something to depend on silently.
  //
  // Calling it anyway would produce chips counted over ALL time while the list
  // beside them showed one month - a control that lies, and the specific kind
  // this project keeps finding. The fallback applies every filter including the
  // period, and it reads one column for a set the period has already bounded.
  const periodScoped = scoped.firstSeenFrom !== undefined || scoped.firstSeenTo !== undefined || scoped.ids !== undefined;
  const { data, error } = periodScoped
    ? { data: null, error: { message: 'period-scoped facets bypass the RPC' } }
    : await supabase.rpc('project_facet_counts', {
        p_field: field,
        p_module: scoped.module ?? LIVE_PIPELINE_STORAGE_KEY,
        p_stage: scoped.stage ?? null,
        p_country: scoped.country ?? null,
        p_region_state: scoped.region_state ?? null,
        p_market: scoped.market ?? null,
        p_development_category: scoped.development_category ?? null,
        p_status: scoped.status ?? null,
        p_exclude_status: scoped.excludeStatus ?? null,
        p_watch: scoped.watch ?? null,
        p_active_from: scoped.activeFrom ?? null,
        p_search: scoped.search ?? null,
      });
  if (!error && Array.isArray(data)) {
    return {
      counts: (data as { value: string; count: number }[])
        .filter((r) => r.value !== null)
        .map((r) => ({ value: r.value, count: Number(r.count) })),
      viaRpc: true,
      ms: Date.now() - t0,
    };
  }

  const { data: rows, error: err2 } = await applyProjectFilters(
    supabase.from('projects').select(field),
    scoped
  );
  if (err2) throw new Error(`project facet fallback failed: ${err2.message}`);
  const m = new Map<string, number>();
  for (const r of (rows ?? []) as unknown as Record<string, string | null>[]) {
    const v = r[field];
    if (!v) continue;
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  return {
    counts: [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count),
    viaRpc: false,
    ms: Date.now() - t0,
  };
}

// ---- Detail view ------------------------------------------------------------

export async function fetchProject(id: string): Promise<Project> {
  const { data, error } = await supabase.from('projects').select(PROJECT_COLUMNS).eq('id', id).single();
  if (error) throw new Error(`project fetch failed: ${error.message}`);
  return data as unknown as Project;
}

export interface TimelineRecord {
  id: string;
  title: string | null;
  url: string;
  source: string | null;
  source_type: string | null;
  published_date: string | null;
  deadline: string | null;
  first_seen: string | null;
  date_source: string | null;
  cluster_reason: string | null;
  status: string | null;
  applicant: string | null;
  representative: string | null;
  presented_by: string | null;
  action_sought: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  primary_document_url: string | null;
}

const TIMELINE_COLUMNS = [
  'id', 'title', 'url', 'source', 'source_type', 'published_date', 'deadline',
  'first_seen', 'date_source', 'cluster_reason', 'status', 'applicant',
  'representative', 'presented_by', 'action_sought', 'contact_name',
  'contact_email', 'contact_phone', 'primary_document_url',
].join(',');

// Every attached record in date order. The timeline is the project: it is what
// turns a row in a register into something a person can read.
export async function fetchProjectTimeline(projectId: string): Promise<TimelineRecord[]> {
  const { data, error } = await supabase
    .from('leads')
    .select(TIMELINE_COLUMNS)
    .eq('project_id', projectId)
    .order('published_date', { ascending: true, nullsFirst: false })
    .order('first_seen', { ascending: true });
  if (error) throw new Error(`project timeline failed: ${error.message}`);
  return (data ?? []) as unknown as TimelineRecord[];
}

// ---- Inbox ------------------------------------------------------------------
// Unclustered records. They are never hidden: a record the engine could not
// place stays here, visible and attachable by hand.
//
// Dismissed rows are excluded because the Trash view owns them; this is the pile
// of live records that have no project yet, which is the pile Philip works.

export interface InboxQuery {
  search?: string;
  page?: number;
  pageSize?: number;
}

export async function fetchInboxPage(q: InboxQuery): Promise<{
  rows: TimelineRecord[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  rowsFetched: number;
}> {
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.max(1, q.pageSize ?? DEFAULT_PROJECT_PAGE_SIZE);
  const from = (page - 1) * pageSize;

  const build = <T>(sel: T): T => {
    let b = sel as unknown as {
      eq: (c: string, v: unknown) => unknown;
      is: (c: string, v: unknown) => unknown;
      neq: (c: string, v: unknown) => unknown;
      or: (f: string) => unknown;
    };
    b = b.eq('module', LIVE_PIPELINE_STORAGE_KEY) as typeof b;
    b = b.is('project_id', null) as typeof b;
    b = b.neq('status', 'dismissed') as typeof b;
    if (q.search && q.search.trim()) {
      const safe = q.search.trim().replace(/\s+/g, ' ').replace(/["\\]/g, '');
      b = b.or(
        ['title', 'applicant', 'representative', 'location']
          .map((f) => `${f}.ilike."%${safe}%"`)
          .join(',')
      ) as typeof b;
    }
    return b as unknown as T;
  };

  const { data, error } = await build(supabase.from('leads').select(TIMELINE_COLUMNS))
    .order('first_seen', { ascending: false, nullsFirst: false })
    .order('id', { ascending: true })
    .range(from, from + pageSize - 1);
  if (error) throw new Error(`inbox page failed: ${error.message}`);

  const { count, error: cErr } = await build(
    supabase.from('leads').select('id', { count: 'exact', head: true })
  );
  if (cErr) throw new Error(`inbox count failed: ${cErr.message}`);

  const rows = (data ?? []) as unknown as TimelineRecord[];
  const total = count ?? 0;
  return {
    rows,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    rowsFetched: rows.length,
  };
}

// Project name search, for the Inbox's "attach to an existing project" control.
export async function searchProjects(term: string, limit = 12): Promise<Project[]> {
  if (!term.trim()) return [];
  const safe = term.trim().replace(/\s+/g, ' ').replace(/["\\]/g, '');
  const { data, error } = await supabase
    .from('projects')
    .select(PROJECT_COLUMNS)
    .eq('module', LIVE_PIPELINE_STORAGE_KEY)
    .or(`name.ilike."%${safe}%",primary_applicant.ilike."%${safe}%"`)
    .order('record_count', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`project search failed: ${error.message}`);
  return (data ?? []) as unknown as Project[];
}
