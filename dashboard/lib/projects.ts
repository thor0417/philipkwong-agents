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
  // What the project IS, in one line, and how that line was produced. Read on
  // every register row and every detail header, which is exactly why it is a
  // stored column rather than something recomputed per render.
  'summary', 'summary_source', 'summary_url',
  // WHICH RULE PRODUCED THE NAME. Read by the register, which marks it, and by
  // the report, which uses it to decide whether the project may be named to a
  // client at all. See isProvisionalName in agents/scraper/project-naming.
  'name_source',
  // The ranking and its breakdown. Read on every register row, so stored
  // rather than recomputed per render - same reason as summary.
  'significance', 'significance_detail', 'significance_computed_at',
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
  summary: string | null;
  // 'derived' (quoted from the filing) | 'generated' (model, factual) |
  // 'manual' (Philip wrote it). A surface that cannot tell a quotation from a
  // model's reading of a document cannot decide which one it is safe to quote.
  summary_source: string | null;
  // The filing a DERIVED summary was quoted from. Reports may only print a
  // summary they can cite, so this is what decides whether the sentence is
  // allowed into a client document at all.
  summary_url: string | null;
  // 'target' | 'source' | 'programme' | 'applicant' | 'site' | 'title'. Only
  // 'title' is provisional: it is a cleaned agenda line rather than a name
  // anything published. Null on a row that predates migration 032.
  name_source: string | null;
  significance: number | null;
  // Each signal's contribution, so the score is explainable at the point of
  // use rather than in a document nobody opens.
  significance_detail: Record<string, { points: number; of: number; why: string }> | null;
  significance_computed_at: string | null;
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
  venue_type?: string;
  watch?: boolean;
  // Activity window, on last_activity.
  activeFrom?: string;
  // A WINDOW ON projects.first_seen, AND NOT THE ARRIVED AXIS.
  //
  // The register's Arrived axis used these and it was wrong. first_seen is
  // written once, on insert, as the OLDEST capture date among the project's
  // records, so the filter asked "was this project's oldest record captured in
  // this period" - which is a question about when a project entered the corpus,
  // not about whether anything happened to it. A project first seen in July
  // that gained eleven August filings answered no and vanished from August.
  //
  // Arrived now resolves through the records into `ids`, the same shape Moved
  // uses for events. These remain because a window on the project's own
  // first_seen is a legitimate thing to want - "projects that entered the
  // register this month" - and periodScoped still counts them. They are just
  // not what "arrived" means.
  firstSeenFrom?: string;
  firstSeenTo?: string;
  // THE PERIOD, on the MOVED axis. project_events lives in another table, so
  // this is a list of project ids resolved from it by the caller. An EMPTY
  // ARRAY IS MEANINGFUL and is not the same as undefined: it means the period
  // contained no events at all, and the honest answer is no projects rather
  // than every project.
  ids?: string[];
  // A TOLERANT EQUALITY, for values that came from somewhere other than the
  // register's own controls.
  //
  // The fields above are exact: the Register builds them from facet values it
  // just read, so `eq` is right and is indexed. A CLIENT SCOPE is different -
  // it is stored text, edited months later, and its market may differ from the
  // register's by case or by a stray space. Matched with `eq` that scope
  // returns nothing, and an empty report is indistinguishable from a client
  // whose markets went quiet.
  //
  // ilike with no wildcards is a whole-string, case-insensitive match, which is
  // the same comparison applyPostFilters makes on the multi-value path. Both
  // paths now agree, which is the point: a scope naming one market and a scope
  // naming two must not be matched by different rules.
  loose?: { field: LooseField; value: string }[];
  // COLUMNS REQUIRED TO BE EMPTY. The route to the projects an "All" chip does
  // not reach.
  //
  // Sixty-four live projects carry no venue type and no development category,
  // and none of them holds a record naming one either - so "All venues" counted
  // 203 while "All stages" counted 267 and the venue row offered no way to the
  // other 64. An "All" that is not all is a silent gap: the operator cannot see
  // that a quarter of the register is missing from that axis, let alone open it.
  //
  // Expressible only since this filter existed. An earlier "No stage yet" saved
  // view was removed rather than fixed for exactly this reason.
  nullFields?: LooseField[];
  search?: string;
  sortField?: string;
  sortDir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

// Only text columns a scope can name. Narrow by design: `loose` interpolates a
// column name into a filter, so the set of legal names is closed here.
export type LooseField =
  | 'country'
  | 'region_state'
  | 'market'
  | 'development_category'
  | 'venue_type'
  | 'stage';

// `%` and `_` are wildcards to ilike. No market is spelled with one today, but
// a value that arrives with one must match itself rather than a pattern.
export function likeLiteral(v: string): string {
  return v.trim().replace(/\s+/g, ' ').replace(/([\\%_])/g, '\\$1');
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
    is: (c: string, v: unknown) => unknown;
    gte: (c: string, v: unknown) => unknown;
    lt: (c: string, v: unknown) => unknown;
    in: (c: string, v: readonly unknown[]) => unknown;
    ilike: (c: string, v: string) => unknown;
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
  // Venue type on the register. Records has had this filter since it was built;
  // the register, which is the working surface, could not answer "New York,
  // then Casino/Gaming" at all.
  if (q.venue_type) set(b.eq('venue_type', q.venue_type));
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
  for (const f of q.nullFields ?? []) set(b.is(f, null));
  for (const m of q.loose ?? []) {
    if (m.value.trim()) set(b.ilike(m.field, likeLiteral(m.value)));
  }
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
  // SIGNIFICANCE IS THE DEFAULT SORT.
  //
  // last_activity was the default and it is why the register could not be
  // browsed: a dormant 2024 street-address filing outranked a multi-billion
  // casino bid. It stays available as an alternative, because "what moved most
  // recently" is a real question - it is simply not the first one.
  const sortField = q.sortField ?? 'significance';
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
export type ProjectFacetField = 'stage' | 'country' | 'region_state' | 'market' | 'development_category' | 'venue_type' | 'status';

// THE FIELDS MIGRATION 017's FUNCTION WILL ACTUALLY GROUP BY, AND THE 400 THEY
// EXPLAIN.
//
// project_facet_counts whitelists its p_field argument and raises for anything
// else - the parameter names a column, so it cannot be interpolated without
// that check. The whitelist was written before venue_type was a facet on this
// screen, so every load of the register asked the database to group by a column
// the function refuses, PostgREST turned the raised exception into HTTP 400,
// and the code below fell through to the client-side path and rendered
// correctly. One 400 in the console on every page load, a wasted round trip on
// every load, and nothing broken enough for anybody to chase it.
//
// This is the same shape as the three bypasses below: the RPC is not called
// with an argument it cannot answer. Adding venue_type to the function is one
// line of DDL and DDL is Philip's to run, not something to depend on silently -
// so this list is what 017 DECLARES, and widening it means widening the
// migration first.
const RPC_FACET_FIELDS: readonly ProjectFacetField[] = [
  'stage',
  'country',
  'region_state',
  'market',
  'development_category',
  'status',
];

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
  //
  // `loose` is the same problem in a second shape and is excluded for the same
  // reason: migration 017's function compares with `=`, so a tolerant filter it
  // has never heard of would simply not be applied, and the chips would count a
  // wider set than the list beside them shows.
  // `nullFields` joins them for the same reason: migration 017's function has
  // never heard of it, so a chip counted through the RPC would ignore the "no
  // venue type" constraint entirely and count the whole register beside a list
  // showing 64.
  const periodScoped = scoped.firstSeenFrom !== undefined || scoped.firstSeenTo !== undefined || scoped.ids !== undefined;
  // The fourth bypass, and the one that was answering with a 400 instead: a
  // field migration 017's function does not whitelist. See RPC_FACET_FIELDS.
  const unsupportedField = !RPC_FACET_FIELDS.includes(field);
  const { data, error } = periodScoped || unsupportedField || (scoped.loose ?? []).length > 0 || (scoped.nullFields ?? []).length > 0
    ? { data: null, error: { message: 'period-scoped, loosely-scoped or unsupported-field facets bypass the RPC' } }
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

// ---- The market facet, counted the way the click resolves ---------------------
//
// EVERY OTHER FACET ON THIS SCREEN COUNTS THE COLUMN IT FILTERS. The market
// facet did not, and that is the whole defect.
//
// projects.market is a MODE over the project's records - its most common market
// value - while clicking a market node filters on "holds any record naming this
// market" (see fetchProjectIdsMatchingRecords). Counting the column and
// resolving the click through the records are two different questions, so the
// rail printed one answer and produced another:
//
//   Las Vegas       rail 32, click 33
//   Oakland         rail  5, click  4
//   Orange County   rail  0, click  1
//   Willets Point   rail  0, click  1
//   Yonkers         rail  1, click  0
//
// The plus-one cases are cosmetic. The zeroes are not: Orange County and Willets
// Point rendered as empty nodes over a project the click would have returned, so
// the tree hid a reachable result. Yonkers is the same fault pointing the other
// way - a node promising one project and returning none.
//
// This counts the click. `q` is the register's base query with the market axis
// removed and every other axis (view, stage, geography, period, search, and the
// venue/category record facets) still applied, so a node's number is exactly the
// set that opens when it is pressed.

// Projects per request when fanning out over a bounded id set. Same figure the
// scope resolver uses, for the same PostgREST url-length reason.
const MARKET_FACET_ID_CHUNK = 150;
// Lead rows per page inside a chunk. PostgREST stops at 1000 by default, and a
// chunk of 150 projects can hold more than that.
const MARKET_FACET_PAGE = 1000;

/** Just the ids matching a query. The facet below fans out over these. */
export async function fetchProjectIds(q: ProjectQuery): Promise<string[]> {
  const out: string[] = [];
  for (let from = 0; ; from += MARKET_FACET_PAGE) {
    const { data, error } = await applyProjectFilters(
      supabase.from('projects').select('id'),
      q
    ).range(from, from + MARKET_FACET_PAGE - 1);
    if (error) throw new Error(`project id query failed: ${error.message}`);
    const rows = (data ?? []) as unknown as { id: string }[];
    out.push(...rows.map((r) => r.id));
    if (rows.length < MARKET_FACET_PAGE) break;
  }
  return out;
}

export async function fetchMarketFacetFromRecords(
  q: ProjectQuery
): Promise<{ counts: FacetCount[]; projects: number }> {
  const ids = await fetchProjectIds({ ...q, market: undefined });
  if (!ids.length) return { counts: [], projects: 0 };

  // market -> the projects reachable through it. A Set, because one project
  // holding four Clark County filings is one project, not four.
  const byMarket = new Map<string, Set<string>>();
  for (let i = 0; i < ids.length; i += MARKET_FACET_ID_CHUNK) {
    const chunk = ids.slice(i, i + MARKET_FACET_ID_CHUNK);
    for (let from = 0; ; from += MARKET_FACET_PAGE) {
      const { data, error } = await supabase
        .from('leads')
        .select('project_id,market')
        .in('project_id', chunk)
        .not('market', 'is', null)
        .neq('status', 'dismissed')
        .range(from, from + MARKET_FACET_PAGE - 1);
      if (error) throw new Error(`market facet query failed: ${error.message}`);
      const rows = (data ?? []) as unknown as { project_id: string | null; market: string | null }[];
      for (const r of rows) {
        if (!r.project_id || !r.market) continue;
        const set = byMarket.get(r.market) ?? new Set<string>();
        set.add(r.project_id);
        byMarket.set(r.market, set);
      }
      if (rows.length < MARKET_FACET_PAGE) break;
    }
  }

  return {
    counts: [...byMarket.entries()]
      .map(([value, set]) => ({ value, count: set.size }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
    projects: ids.length,
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
  // The capture lane that wrote the row. Decides RECORD vs PRESS in generated
  // documents (report-sections isFiling), so it is part of the record's shape
  // rather than an incidental column. Optional because fetchProjectTimeline
  // does not select it; report-build does.
  stream?: string | null;
  // FIGURES READ OUT OF THE ARTICLE BEHIND A PRESS URL, each carrying the
  // verbatim string and the sentence it was printed in (migration 034, written by
  // `npm run capture:press`). Null on every filing, and on any press record whose
  // publisher refused us - which is 17 of the 62 we hold on live projects.
  //
  // Typed structurally rather than by importing PressFact, because this interface
  // is the PostgREST row shape and jsonb arrives as whatever the column holds.
  // The shape is asserted where it is USED: report-entry reads it through
  // press-facts' own types, and the provenance gate refuses to render a figure
  // that is not a quotation from the sentence stored beside it.
  press_facts?: { kind: string; display: string; value: number | null; sentence: string }[] | null;
  // WHAT THE FILING ITSELF STATES, read out of the document this record points
  // at (migration 035, written by `npm run capture:filings`). Null on a press
  // record and on any filing whose form no reader covers - which is most of
  // them outside Clark County, Oakland, Anaheim and New York.
  //
  // Typed structurally rather than by importing FilingFact, for the same reason
  // press_facts is: this interface is the PostgREST row shape. The shape is
  // asserted where it is used.
  filing_facts?: { kind: string; label: string; display: string; value: number | null; line: string; group?: string | null }[] | null;
}

const TIMELINE_COLUMNS = [
  'id', 'title', 'url', 'source', 'source_type', 'published_date', 'deadline',
  'first_seen', 'date_source', 'cluster_reason', 'status', 'applicant',
  'representative', 'presented_by', 'action_sought', 'contact_name',
  'contact_email', 'contact_phone', 'primary_document_url',
  // The capture lane. Selected here now because the timeline is where records
  // are read since Records stopped being a destination, and RECORD / PRESS /
  // TENDER is decided from it (recordProvenance). Without it every timeline row
  // fell through to the legacy source list and a tender read as a filing.
  'stream',
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

// ---- FINDING ONE RECORD ------------------------------------------------------
//
// SEARCH, NOT BROWSE, AND THAT IS THE WHOLE DIFFERENCE.
//
// Records was a destination: three stream tabs, a geography tree, a triage bar
// and a page of filters over 1,500 raw rows. Nobody browses raw records - a
// project's records are its timeline, which is where they are read. What was
// genuinely lost by removing the screen is the ability to find ONE document you
// already know something about: a case reference somebody quoted, a headline, a
// link in an email. That is a search box, and the palette is already the search
// box.
//
// THREE FIELDS, AND THEY ARE THE THREE A PERSON HAS IN HAND. There is no case
// reference COLUMN: Legistar prints it inside the title ("RES.123-2025
// RESOLUTION - APPROVING..."), so a title match is a case-reference match. The
// url is here because a link pasted from a browser is the other thing people
// arrive with, and matching on it is the only way to answer "do we already hold
// this document".
export interface RecordHit {
  id: string;
  title: string | null;
  url: string;
  source: string | null;
  source_type: string | null;
  stream: string | null;
  published_date: string | null;
  market: string | null;
  project_id: string | null;
}

export async function searchRecords(term: string, limit = 12): Promise<RecordHit[]> {
  if (!term.trim()) return [];
  const safe = term.trim().replace(/\s+/g, ' ').replace(/["\\]/g, '');
  const { data, error } = await supabase
    .from('leads')
    .select('id,title,url,source,source_type,stream,published_date,market,project_id')
    .eq('module', LIVE_PIPELINE_STORAGE_KEY)
    // Dismissed rows are excluded for the same reason Trash is a separate view:
    // this is a way to find a document, not an archive dig. Nothing is deleted,
    // and a dismissed record is still reachable through its project.
    .neq('status', 'dismissed')
    .or(['title', 'url'].map((f) => `${f}.ilike."%${safe}%"`).join(','))
    .order('published_date', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(`record search failed: ${error.message}`);
  return (data ?? []) as unknown as RecordHit[];
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
