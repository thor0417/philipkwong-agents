// SERVER-SIDE QUERY LAYER. Every dashboard read goes through here.
//
// The rule this module exists to enforce: the dashboard fetches a PAGE, never a
// table. Filtering, sorting, counting, and searching all happen in Postgres
// against the indexes added in the Phase 1 migration. Nothing below ever loads
// rows in order to count them.
//
// Before this module, the GLI page issued one unbounded select and did all
// filtering and counting in a useMemo over the result. That works at 1,000 rows
// and cannot work at 20,000: Supabase caps an unbounded select at 1,000 rows, so
// the page was already silently truncating, and every count was computed over
// the truncated set.

import { supabase } from './supabase';

export const DEFAULT_PAGE_SIZE = 50;

// The stream whose own date column is not published_date. An opportunity is
// keyed on its submission deadline; everything else on its document date.
const STREAM_DATE_COLUMN: Record<string, string> = {
  opportunity: 'deadline',
  government: 'published_date',
  intelligence: 'published_date',
};

export function streamDateColumn(stream?: string | null): string {
  return (stream && STREAM_DATE_COLUMN[stream]) || 'published_date';
}

// Columns the table and detail panel need. Kept explicit: `select('*')` on a
// table with raw_content pulls document text into every list render.
export const LIST_COLUMNS = [
  'id', 'title', 'url', 'source', 'company', 'location', 'country', 'region_state',
  'market', 'stream', 'module', 'status', 'lifecycle', 'status_changed_at', 'notes',
  'manual_overrides', 'venue_type', 'signal_type', 'development_category',
  'source_type', 'source_tier', 'deadline', 'published_date', 'date_source',
  'first_seen', 'object_type', 'milestone_date', 'score', 'score_reason',
  'presented_by', 'applicant', 'representative', 'action_sought',
  'primary_document_url', 'has_primary_document', 'contact_name', 'contact_email',
  'contact_phone', 'region', 'lead_type', 'value_estimate',
].join(',');

export interface LeadQuery {
  module?: string;
  stream?: string | null;
  // A single value or a set. Trash is status = 'dismissed'; every other view
  // excludes it, which is done with a NOT IN rather than by filtering in JS.
  status?: string | string[];
  excludeStatus?: string | string[];
  lifecycle?: string | string[];
  country?: string;
  region_state?: string;
  market?: string;
  development_category?: string;
  venue_type?: string;
  // Delta window on capture time.
  firstSeenFrom?: string;
  firstSeenTo?: string;
  // Window on the stream's own date (deadline for opportunity, else document date).
  streamDateFrom?: string;
  streamDateTo?: string;
  search?: string;
  sortField?: string;
  sortDir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

// Free-text search runs in Postgres across the fields a person actually searches
// by: the record's title, the people on it, the action, and its location. One
// `or` with ilike per field, so "Kulik River" or "Amundsen" is a single query
// rather than a scroll.
const SEARCH_FIELDS = [
  'title',
  'applicant',
  'representative',
  'presented_by',
  'action_sought',
  'location',
  'market',
  'company',
];

// PostgREST `or` takes a comma-separated filter list, so a comma or a
// parenthesis inside the term would otherwise be read as syntax. The value is
// double-quoted instead of stripped, because stripping breaks the search it was
// meant to protect: "Brown, Brown & Premsrirut" is exactly how the county prints
// the firm, and replacing its commas with spaces made it match nothing.
function searchFilter(term: string): string {
  const safe = term.trim().replace(/\s+/g, ' ').replace(/["\\]/g, '');
  return SEARCH_FIELDS.map((f) => `${f}.ilike."%${safe}%"`).join(',');
}

// Apply every filter in a LeadQuery to a PostgREST builder. Shared by the row
// fetch and the count queries, so a count can never disagree with its page.
// Exported so the same filter code can be exercised against a service-role
// client in tests; the dashboard itself always passes the browser client.
export function applyFilters<T>(builder: T, q: LeadQuery): T {
  let b = builder as unknown as {
    eq: (c: string, v: unknown) => unknown;
    in: (c: string, v: unknown[]) => unknown;
    not: (c: string, op: string, v: unknown) => unknown;
    gte: (c: string, v: unknown) => unknown;
    lte: (c: string, v: unknown) => unknown;
    or: (f: string) => unknown;
    is: (c: string, v: unknown) => unknown;
  };
  const set = (fn: unknown): void => {
    b = fn as typeof b;
  };

  if (q.module) set(b.eq('module', q.module));
  if (q.stream === null) set(b.is('stream', null));
  else if (q.stream) set(b.eq('stream', q.stream));

  if (Array.isArray(q.status)) set(b.in('status', q.status));
  else if (q.status) set(b.eq('status', q.status));

  if (q.excludeStatus) {
    const list = Array.isArray(q.excludeStatus) ? q.excludeStatus : [q.excludeStatus];
    set(b.not('status', 'in', `(${list.join(',')})`));
  }

  if (Array.isArray(q.lifecycle)) set(b.in('lifecycle', q.lifecycle));
  else if (q.lifecycle) set(b.eq('lifecycle', q.lifecycle));

  if (q.country) set(b.eq('country', q.country));
  if (q.region_state) set(b.eq('region_state', q.region_state));
  if (q.market) set(b.eq('market', q.market));
  if (q.development_category) set(b.eq('development_category', q.development_category));
  if (q.venue_type) set(b.eq('venue_type', q.venue_type));

  if (q.firstSeenFrom) set(b.gte('first_seen', q.firstSeenFrom));
  if (q.firstSeenTo) set(b.lte('first_seen', q.firstSeenTo));

  const dateCol = streamDateColumn(q.stream);
  if (q.streamDateFrom) set(b.gte(dateCol, q.streamDateFrom));
  if (q.streamDateTo) set(b.lte(dateCol, q.streamDateTo));

  if (q.search && q.search.trim()) set(b.or(searchFilter(q.search)));

  return b as unknown as T;
}

export interface LeadPage<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  // Wall-clock of the two queries, reported in the UI footer and in the brief's
  // scale evidence.
  rowsMs: number;
  countMs: number;
}

// One page of rows plus the exact total. Two queries: the page (bounded by
// range) and the count (head:true, so it transfers no rows at all).
export async function fetchLeadPage<T>(q: LeadQuery): Promise<LeadPage<T>> {
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.max(1, q.pageSize ?? DEFAULT_PAGE_SIZE);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const sortField = q.sortField ?? 'first_seen';
  const ascending = q.sortDir === 'asc';

  const t0 = Date.now();
  const rowsQuery = applyFilters(supabase.from('leads').select(LIST_COLUMNS), q)
    .order(sortField, { ascending, nullsFirst: false })
    // Stable tiebreak so paging cannot repeat or skip a row when the sort key ties.
    .order('id', { ascending: true })
    .range(from, to);
  const { data, error } = await rowsQuery;
  const rowsMs = Date.now() - t0;
  if (error) throw new Error(`lead page query failed: ${error.message}`);

  const t1 = Date.now();
  const total = await countLeads(q);
  const countMs = Date.now() - t1;

  return {
    rows: (data ?? []) as unknown as T[],
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    rowsMs,
    countMs,
  };
}

// An exact count with no rows transferred.
export async function countLeads(q: LeadQuery): Promise<number> {
  const { count, error } = await applyFilters(
    supabase.from('leads').select('id', { count: 'exact', head: true }),
    q
  );
  if (error) throw new Error(`lead count query failed: ${error.message}`);
  return count ?? 0;
}

// Counts for a bounded set of values on one field, each its own indexed count
// query, run in parallel. Used for stream tabs, status views, category and venue
// chips, and the geography levels once their values are known.
export async function countByValues(
  base: LeadQuery,
  field: keyof LeadQuery,
  values: string[]
): Promise<Map<string, number>> {
  const results = await Promise.all(
    values.map(async (v) => [v, await countLeads({ ...base, [field]: v })] as const)
  );
  return new Map(results);
}

// The distinct values present on one facet, with their counts. Serves the
// geography levels AND the category / venue chips: one grouped query per facet
// instead of one count query per possible value.
//
// Postgres aggregate functions are disabled on this project (PostgREST answers
// "Use of aggregate functions is not allowed"), so the GROUP BY lives in the
// facet_counts function in migration 015. When it exists this is a single
// indexed query. Until it is applied, the fallback reads ONLY the one facet
// column for the current filter, never row bodies, and reports viaRpc:false so
// the interim cost is visible rather than hidden.
export type FacetField = 'country' | 'region_state' | 'market' | 'development_category' | 'venue_type' | 'status';

export interface FacetCount {
  value: string;
  count: number;
}

export async function facetCounts(
  base: LeadQuery,
  field: FacetField
): Promise<{ counts: FacetCount[]; viaRpc: boolean; ms: number }> {
  const t0 = Date.now();
  const { data, error } = await supabase.rpc('facet_counts', {
    p_field: field,
    p_module: base.module ?? null,
    p_stream: base.stream ?? null,
    p_country: base.country ?? null,
    p_region_state: base.region_state ?? null,
    p_market: base.market ?? null,
    p_development_category: base.development_category ?? null,
    p_venue_type: base.venue_type ?? null,
    p_status: typeof base.status === 'string' ? base.status : null,
    p_exclude_status: typeof base.excludeStatus === 'string' ? base.excludeStatus : null,
    p_lifecycle: typeof base.lifecycle === 'string' ? base.lifecycle : null,
    p_first_seen_from: base.firstSeenFrom ?? null,
    p_search: base.search ?? null,
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

  // Interim path: one narrow column, no row bodies.
  const { data: rows, error: err2 } = await applyFilters(supabase.from('leads').select(field), base);
  if (err2) throw new Error(`facet counts fallback failed: ${err2.message}`);
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

// Rows with no country at all, for the labelled bucket that keeps unresolved
// records visible instead of dropping them out of navigation.
export async function countUnresolvedGeography(base: LeadQuery): Promise<number> {
  const { count, error } = await applyFilters(
    supabase.from('leads').select('id', { count: 'exact', head: true }),
    { ...base, country: undefined }
  ).is('country', null);
  if (error) throw new Error(`unresolved geography count failed: ${error.message}`);
  return count ?? 0;
}

// ISO date for N days ago, for the delta views.
export function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}
