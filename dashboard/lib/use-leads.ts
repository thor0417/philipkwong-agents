'use client';
import { LIVE_PIPELINE_STORAGE_KEY } from './pipelines';

// THE DASHBOARD'S DATA LAYER. Every read is a keyed query, every write is an
// optimistic mutation.
//
// Why optimistic: the triage sweep is hundreds of clicks. Before this, each
// Dismiss cost a round trip, then a page refetch, then five count queries, and
// the row sat there until all of it came back. Now the row leaves the view on
// the click, the request goes in the background, and a failure rolls the row
// back and says so.
//
// Query keys carry the WHOLE filter state, so switching back to a filter Philip
// already visited is a cache read rather than a refetch, and two different
// filters can never share a cache entry.

import { useCallback } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import type { GLILead } from './types';
import {
  countLeads,
  countUnresolvedGeography,
  facetCounts,
  fetchLeadPage,
  type FacetField,
  type LeadPage,
  type LeadQuery,
} from './query';
import {
  applyEdit,
  setNotes,
  setStatus,
  type EditableField,
  type LeadStatus,
} from './mutations';

// ---- keys -------------------------------------------------------------------
// A stable serialization: undefined dropped, keys sorted, arrays preserved. Two
// query objects that mean the same thing must produce the same key, or the cache
// silently fragments and every filter change looks like a miss.
function stable(q: LeadQuery): string {
  const entries = Object.entries(q)
    .filter(([, v]) => v !== undefined && v !== '')
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
}

export const leadKeys = {
  all: ['leads'] as const,
  lists: () => ['leads', 'list'] as const,
  list: (q: LeadQuery) => ['leads', 'list', stable(q), q] as const,
  counts: () => ['leads', 'count'] as const,
  count: (q: LeadQuery) => ['leads', 'count', stable(q), q] as const,
  facets: () => ['leads', 'facet'] as const,
  facet: (q: LeadQuery, field: FacetField) => ['leads', 'facet', field, stable(q), q] as const,
  unresolvedGeo: (q: LeadQuery) => ['leads', 'unresolved-geo', stable(q), q] as const,
  backlog: () => ['leads', 'backlog'] as const,
};

// The LeadQuery a cached key was built from, for optimistic cache surgery.
function queryOf(key: QueryKey): LeadQuery | null {
  const last = key[key.length - 1];
  return last && typeof last === 'object' ? (last as LeadQuery) : null;
}

// ---- reads ------------------------------------------------------------------

export function useLeadPage(q: LeadQuery, enabled = true) {
  return useQuery({
    queryKey: leadKeys.list(q),
    queryFn: () => fetchLeadPage<GLILead>(q),
    enabled,
    // Keep the previous page on screen while the next one loads, so paging and
    // filtering never flash an empty table.
    placeholderData: (prev) => prev,
  });
}

export function useLeadCount(q: LeadQuery, enabled = true) {
  return useQuery({
    queryKey: leadKeys.count(q),
    queryFn: () => countLeads(q),
    enabled,
    placeholderData: (prev) => prev,
  });
}

export function useFacet(q: LeadQuery, field: FacetField, enabled = true) {
  return useQuery({
    queryKey: leadKeys.facet(q, field),
    queryFn: () => facetCounts(q, field),
    enabled,
    placeholderData: (prev) => prev,
  });
}

export function useUnresolvedGeoCount(q: LeadQuery, enabled = true) {
  return useQuery({
    queryKey: leadKeys.unresolvedGeo(q),
    queryFn: () => countUnresolvedGeography(q),
    enabled,
    placeholderData: (prev) => prev,
  });
}

// The untriaged pile, across every stream and both lifecycle views.
export function useBacklog() {
  return useQuery({
    queryKey: leadKeys.backlog(),
    queryFn: () => countLeads({ module: LIVE_PIPELINE_STORAGE_KEY, status: 'new' }),
    placeholderData: (prev) => prev,
  });
}

// ---- optimistic helpers -----------------------------------------------------

// Does a row still belong in a list built from this query, given its status?
// A status mutation can only change membership on the status axis, so that is
// the only axis this checks.
function statusStillMatches(q: LeadQuery, status: string): boolean {
  if (q.status) {
    const wanted = Array.isArray(q.status) ? q.status : [q.status];
    if (!wanted.includes(status)) return false;
  }
  if (q.excludeStatus) {
    const excluded = Array.isArray(q.excludeStatus) ? q.excludeStatus : [q.excludeStatus];
    if (excluded.includes(status)) return false;
  }
  return true;
}

// Does a count query count rows of this status?
function countIncludesStatus(q: LeadQuery, status: string): boolean {
  return statusStillMatches(q, status);
}

export interface Snapshot {
  key: QueryKey;
  data: unknown;
}

// Apply a status change across every cached list, count, facet, and the backlog,
// and hand back the snapshots needed to undo it.
export function optimisticStatus(
  client: QueryClient,
  ids: string[],
  next: LeadStatus
): { snapshots: Snapshot[]; previousById: Map<string, string> } {
  const idSet = new Set(ids);
  const snapshots: Snapshot[] = [];
  const previousById = new Map<string, string>();

  // 1. Lists: patch the row, then drop it if it no longer belongs in this view.
  for (const [key, data] of client.getQueryCache().findAll({ queryKey: leadKeys.lists() }).map(
    (c) => [c.queryKey, c.state.data] as const
  )) {
    const page = data as LeadPage<GLILead> | undefined;
    if (!page?.rows) continue;
    const q = queryOf(key);
    if (!q) continue;
    const hit = page.rows.some((r) => idSet.has(r.id));
    if (!hit) continue;
    snapshots.push({ key, data: page });
    for (const r of page.rows) {
      if (idSet.has(r.id) && !previousById.has(r.id)) previousById.set(r.id, r.status ?? 'new');
    }
    const patched = page.rows.map((r) => (idSet.has(r.id) ? { ...r, status: next } : r));
    const kept = patched.filter((r) => statusStillMatches(q, r.status ?? 'new'));
    const removed = patched.length - kept.length;
    client.setQueryData(key, {
      ...page,
      rows: kept,
      total: Math.max(0, page.total - removed),
    });
  }

  // 2. Counts: move each affected count by how many rows entered or left it.
  for (const cache of client.getQueryCache().findAll({ queryKey: leadKeys.counts() })) {
    const current = cache.state.data as number | undefined;
    if (typeof current !== 'number') continue;
    const q = queryOf(cache.queryKey);
    if (!q) continue;
    let delta = 0;
    for (const id of ids) {
      const before = previousById.get(id);
      // Only rows whose previous status is known can be reasoned about; the rest
      // are corrected by the invalidation in onSettled.
      if (before === undefined) continue;
      const wasIn = countIncludesStatus(q, before);
      const isIn = countIncludesStatus(q, next);
      if (wasIn && !isIn) delta -= 1;
      if (!wasIn && isIn) delta += 1;
    }
    if (delta !== 0) {
      snapshots.push({ key: cache.queryKey, data: current });
      client.setQueryData(cache.queryKey, Math.max(0, current + delta));
    }
  }

  // 3. Backlog: the count of status = new, so it moves the moment a row leaves
  // or enters 'new'. This is the number Philip watches while sweeping.
  const backlog = client.getQueryData<number>(leadKeys.backlog());
  if (typeof backlog === 'number') {
    let delta = 0;
    for (const id of ids) {
      const before = previousById.get(id);
      if (before === undefined) continue;
      if (before === 'new' && next !== 'new') delta -= 1;
      if (before !== 'new' && next === 'new') delta += 1;
    }
    if (delta !== 0) {
      snapshots.push({ key: leadKeys.backlog(), data: backlog });
      client.setQueryData(leadKeys.backlog(), Math.max(0, backlog + delta));
    }
  }

  return { snapshots, previousById };
}

export function restore(client: QueryClient, snapshots: Snapshot[]): void {
  for (const s of snapshots) client.setQueryData(s.key, s.data);
}

// Everything a status change can move: the lists it enters or leaves, every
// count, every facet (geography included, since a dismissed row leaves its
// market's tally), and the backlog.
async function invalidateAfterStatus(client: QueryClient): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: leadKeys.lists() }),
    client.invalidateQueries({ queryKey: leadKeys.counts() }),
    client.invalidateQueries({ queryKey: leadKeys.facets() }),
    client.invalidateQueries({ queryKey: ['leads', 'unresolved-geo'] }),
    client.invalidateQueries({ queryKey: leadKeys.backlog() }),
    // THE INBOX IS A LIST OF LEADS UNDER A PROJECT KEY, and dismissing is what
    // takes a record out of it. Without this the Inbox does not empty: measured,
    // pressing E wrote the dismissal, the server count was correct on the next
    // load, and the record stayed on screen because nothing told this query it
    // was stale. A pile that does not visibly shrink as you work it is the exact
    // failure the Inbox was built to end.
    //
    // Written as a literal prefix rather than through projectKeys, to keep the
    // leads layer from importing the projects layer for one key. invalidateQueries
    // matches on prefix, so this catches every filtered and paged Inbox query.
    client.invalidateQueries({ queryKey: ['projects', 'inbox'] }),
  ]);
}

// ---- mutations --------------------------------------------------------------

export interface MutationFeedback {
  onError?: (message: string) => void;
}

// One mutation for one row and for a whole selection: a bulk action is the same
// call with more ids, so it is a single request, optimistic in one step, and it
// rolls back in one step.
export function useSetStatus(feedback: MutationFeedback = {}) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: LeadStatus }) => setStatus(ids, status),
    onMutate: async ({ ids, status }) => {
      await client.cancelQueries({ queryKey: leadKeys.all });
      return optimisticStatus(client, ids, status);
    },
    onError: (err, _vars, ctx) => {
      if (ctx) restore(client, ctx.snapshots);
      feedback.onError?.(err instanceof Error ? err.message : 'Status change failed.');
    },
    onSettled: () => invalidateAfterStatus(client),
  });
}

// Patch one row wherever it is cached, for edits and notes.
function optimisticRowPatch(
  client: QueryClient,
  id: string,
  patch: Partial<GLILead>
): Snapshot[] {
  const snapshots: Snapshot[] = [];
  for (const cache of client.getQueryCache().findAll({ queryKey: leadKeys.lists() })) {
    const page = cache.state.data as LeadPage<GLILead> | undefined;
    if (!page?.rows?.some((r) => r.id === id)) continue;
    snapshots.push({ key: cache.queryKey, data: page });
    client.setQueryData(cache.queryKey, {
      ...page,
      rows: page.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    });
  }
  return snapshots;
}

export function useApplyEdit(feedback: MutationFeedback = {}) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, field, value }: { id: string; field: EditableField; value: string }) =>
      applyEdit(id, field, value),
    onMutate: async ({ id, field, value }) => {
      await client.cancelQueries({ queryKey: leadKeys.lists() });
      return { snapshots: optimisticRowPatch(client, id, { [field]: value } as Partial<GLILead>) };
    },
    onError: (err, _vars, ctx) => {
      if (ctx) restore(client, ctx.snapshots);
      feedback.onError?.(err instanceof Error ? err.message : 'Edit failed.');
    },
    // A category, venue, market, or stream correction moves the row between
    // facets and streams, so the same full invalidation applies.
    onSettled: () => invalidateAfterStatus(client),
  });
}

export function useSetNotes(feedback: MutationFeedback = {}) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, notes }: { id: string; notes: string }) => setNotes(id, notes),
    onMutate: async ({ id, notes }) => {
      await client.cancelQueries({ queryKey: leadKeys.lists() });
      return { snapshots: optimisticRowPatch(client, id, { notes }) };
    },
    onError: (err, _vars, ctx) => {
      if (ctx) restore(client, ctx.snapshots);
      feedback.onError?.(err instanceof Error ? err.message : 'Note save failed.');
    },
    // Notes move nothing, so only the lists holding this row need refreshing.
    onSettled: () => client.invalidateQueries({ queryKey: leadKeys.lists() }),
  });
}

// A single entry point for the page: the three mutations plus a helper that
// applies a status to one row or to a whole selection.
export function useLeadMutations(feedback: MutationFeedback = {}) {
  const status = useSetStatus(feedback);
  const edit = useApplyEdit(feedback);
  const notes = useSetNotes(feedback);
  const applyStatus = useCallback(
    (ids: string[], next: LeadStatus) => {
      if (ids.length === 0) return;
      status.mutate({ ids, status: next });
    },
    [status]
  );
  return { status, edit, notes, applyStatus, busy: status.isPending || edit.isPending || notes.isPending };
}
