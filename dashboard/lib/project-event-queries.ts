// THE FOUR QUESTIONS THE REGISTER IS READ FOR.
//
// Built here, once, so the dashboard CONSUMES them rather than inventing its own
// slightly-different version in each component - which is how two pages end up
// disagreeing about what happened last week.
//
// THE CLIENT IS INJECTED rather than imported. The dashboard passes its
// authenticated anon client; the verification script passes the service-role
// client. One implementation, two callers, and the queries can be timed and
// proved from the repo root without a browser.
//
// EVERY FILTER IS SERVER-SIDE and hits an index from migration 020:
//   idx_project_events_recent  (module, occurred_at desc)  - period + pipeline
//   idx_project_events_type    (event_type, occurred_at)   - what moved
//   idx_project_events_project (project_id, occurred_at)   - one history
//
// The project and the triggering record are EMBEDDED in the same request via the
// foreign keys, not fetched in a loop. A per-row lookup would turn one query
// into several hundred, which is the difference between a page that loads and a
// page that times out at 25 markets.
//
// THE ONE THING DONE CLIENT-SIDE, and why. "Ordered by how advanced the
// destination stage is" cannot be expressed in PostgREST: it is an ordering over
// a custom ladder, not over a column's natural order. The FILTERING is
// server-side, so the set that reaches the client is already bounded by period
// and pipeline; sorting a bounded set in memory is cheap and honest, whereas
// ordering by to_value alphabetically would be wrong and silent.

import { LIVE_PIPELINE_STORAGE_KEY } from './pipelines';
import { STAGE_LADDER } from './taxonomy';

// Minimal shape of the query builder both clients satisfy. Typed structurally so
// this file depends on neither client package.
type Filterable = {
  select: (cols: string) => Filterable;
  eq: (col: string, val: unknown) => Filterable;
  in: (col: string, vals: readonly unknown[]) => Filterable;
  gte: (col: string, val: unknown) => Filterable;
  lte: (col: string, val: unknown) => Filterable;
  lt: (col: string, val: unknown) => Filterable;
  order: (col: string, opts?: { ascending?: boolean }) => Filterable;
  limit: (n: number) => Filterable;
  then: Promise<{ data: unknown; error: { message: string } | null }>['then'];
};
export type EventClient = { from: (table: string) => Filterable };

export interface Period {
  // HALF-OPEN [since, until): since inclusive, until EXCLUSIVE. Both optional -
  // omitting `since` means all of history, which is what a project's own
  // timeline wants, and omitting `until` means up to now.
  //
  // The upper bound was inclusive until period selection arrived, and inclusive
  // is unusable for a closed period: `lte('occurred_at', '2026-08-01')` compares
  // a timestamptz against midnight and silently drops everything that happened
  // during the last day. Weeks then do not sum to their month. lib/period.ts
  // produces bounds in exactly this shape.
  since?: string;
  until?: string;
}

export interface Scope extends Period {
  // The pipeline, stored in project_events.module. Defaults to hospitality's
  // legacy id; migration 021 is what turns this into a registry lookup.
  pipeline?: string;
  // Geography, matched on the PROJECT's market.
  markets?: string[];
  limit?: number;
}

// Scoped by the live pipeline's storage key, from the registry mirror.
const DEFAULT_PIPELINE = LIVE_PIPELINE_STORAGE_KEY;
const DEFAULT_LIMIT = 500;

// The columns every query returns, with the project and triggering record
// embedded through their foreign keys.
const EVENT_COLUMNS =
  'id,event_type,occurred_at,actor,from_value,to_value,detail,' +
  'project:projects!project_events_project_id_fkey(id,name,market,stage,watch),' +
  'lead:leads!project_events_lead_id_fkey(id,title,url,source)';

export interface EventRow {
  id: string;
  event_type: string;
  occurred_at: string;
  actor: string;
  from_value: string | null;
  to_value: string | null;
  detail: Record<string, unknown> | null;
  project: { id: string; name: string; market: string | null; stage: string | null; watch: boolean | null } | null;
  lead: { id: string; title: string | null; url: string | null; source: string | null } | null;
}

function applyScope(q: Filterable, s: Scope): Filterable {
  let out = q.eq('module', s.pipeline ?? DEFAULT_PIPELINE);
  if (s.since) out = out.gte('occurred_at', s.since);
  if (s.until) out = out.lt('occurred_at', s.until);
  return out;
}

// Geography is filtered on the EMBEDDED project's market, which PostgREST cannot
// do inside the same request without an inner join hint. Applied after the fetch
// for the same reason the ladder sort is: the set is already bounded by period
// and pipeline, so this is a filter over tens of rows, not a table scan.
function byMarket(rows: EventRow[], markets?: string[]): EventRow[] {
  if (!markets || markets.length === 0) return rows;
  const want = new Set(markets.map((m) => m.toLowerCase()));
  return rows.filter((r) => r.project?.market && want.has(r.project.market.toLowerCase()));
}

async function run(q: Filterable): Promise<EventRow[]> {
  const { data, error } = (await q) as { data: unknown; error: { message: string } | null };
  if (error) throw new Error(`project event query failed: ${error.message}`);
  return (data ?? []) as EventRow[];
}

// ---- 1. WHAT MOVED ----------------------------------------------------------
//
// Stage changes in a period, most advanced destination first. This is the Monday
// question, and the ordering is the point: a project reaching "under
// construction" matters more than one reaching "hearing scheduled", and a list
// ordered by time buries the important one among the routine.
export async function whatMoved(client: EventClient, scope: Scope = {}): Promise<EventRow[]> {
  const rows = await run(
    applyScope(client.from('project_events').select(EVENT_COLUMNS), scope)
      .eq('event_type', 'stage_changed')
      .order('occurred_at', { ascending: false })
      .limit(scope.limit ?? DEFAULT_LIMIT)
  );
  const rank = (stage: string | null): number => {
    const i = (STAGE_LADDER as readonly string[]).indexOf(stage ?? '');
    // Off-ladder states (stalled, dormant) sort below every rung rather than
    // above them: a project going dormant is not an advance.
    return i === -1 ? -1 : i;
  };
  return byMarket(rows, scope.markets).sort(
    (a, b) => rank(b.to_value) - rank(a.to_value) || b.occurred_at.localeCompare(a.occurred_at)
  );
}

// ---- 2. WHAT CAME IN --------------------------------------------------------
//
// New projects, and new records on projects that already existed - deliberately
// separated, because they are different news. A new project is a discovery; a
// record on a known project is that project moving. Attachments are grouped by
// project so ten filings on one matter read as one line rather than ten.
export interface WhatCameIn {
  created: EventRow[];
  attached: { project: EventRow['project']; events: EventRow[] }[];
}

export async function whatCameIn(client: EventClient, scope: Scope = {}): Promise<WhatCameIn> {
  const rows = await run(
    applyScope(client.from('project_events').select(EVENT_COLUMNS), scope)
      .in('event_type', ['project_created', 'record_attached'])
      .order('occurred_at', { ascending: false })
      .limit(scope.limit ?? DEFAULT_LIMIT)
  );
  const scoped = byMarket(rows, scope.markets);
  const created = scoped.filter((r) => r.event_type === 'project_created');
  const newIds = new Set(created.map((r) => r.project?.id));

  const groups = new Map<string, { project: EventRow['project']; events: EventRow[] }>();
  for (const r of scoped) {
    if (r.event_type !== 'record_attached') continue;
    const id = r.project?.id;
    // A record attached to a project created in the same period is part of that
    // project's arrival, not separate news.
    if (!id || newIds.has(id)) continue;
    if (!groups.has(id)) groups.set(id, { project: r.project, events: [] });
    groups.get(id)!.events.push(r);
  }
  return {
    created,
    attached: [...groups.values()].sort((a, b) => b.events.length - a.events.length),
  };
}

// ---- 3. PROJECT HISTORY -----------------------------------------------------
//
// Every event for one project, oldest first, because a history is read forwards.
// No period bound by default: the whole point is the whole story.
export async function projectHistory(
  client: EventClient,
  projectId: string,
  period: Period = {}
): Promise<EventRow[]> {
  let q = client.from('project_events').select(EVENT_COLUMNS).eq('project_id', projectId);
  if (period.since) q = q.gte('occurred_at', period.since);
  if (period.until) q = q.lt('occurred_at', period.until);
  return run(q.order('occurred_at', { ascending: true }).limit(2000));
}

// ---- 4. WATCHLIST ACTIVITY --------------------------------------------------
//
// Anything at all on a project Philip is watching. Every event type, because the
// point of watching is that you want to know about it whatever it is.
//
// Two requests rather than one: the watched project ids first, then their
// events. PostgREST cannot filter on an embedded column, and doing it the other
// way - fetching all events and discarding the unwatched - would read the whole
// period to return a handful of rows.
export async function watchlistActivity(client: EventClient, scope: Scope = {}): Promise<EventRow[]> {
  const { data, error } = (await client
    .from('projects')
    .select('id')
    .eq('module', scope.pipeline ?? DEFAULT_PIPELINE)
    .eq('watch', true)
    .limit(1000)) as { data: unknown; error: { message: string } | null };
  if (error) throw new Error(`watchlist lookup failed: ${error.message}`);
  const ids = ((data ?? []) as { id: string }[]).map((p) => p.id);
  if (ids.length === 0) return [];
  const rows = await run(
    applyScope(client.from('project_events').select(EVENT_COLUMNS), scope)
      .in('project_id', ids)
      .order('occurred_at', { ascending: false })
      .limit(scope.limit ?? DEFAULT_LIMIT)
  );
  return byMarket(rows, scope.markets);
}
