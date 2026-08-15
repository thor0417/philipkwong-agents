'use client';

// The register's data layer. Same shape as use-leads.ts: every read is a keyed
// query carrying the WHOLE filter state, so returning to a filter already
// visited is a cache read rather than a refetch, and two different filters can
// never share a cache entry.
//
// Project writes are NOT optimistic, and that is deliberate. The leads table is
// swept hundreds of rows at a time, where a round trip per click is the
// difference between usable and not. A project is renamed or re-staged
// occasionally and one at a time, so the simpler code is worth more than the
// latency, and a failed write cannot leave a half-applied rename on screen.

import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  countProjects,
  fetchInboxPage,
  fetchProject,
  fetchProjectPage,
  fetchProjectTimeline,
  fetchMarketFacetFromRecords,
  projectFacetCounts,
  searchProjects,
  searchRecords,
  type InboxQuery,
  type ProjectFacetField,
  type ProjectQuery,
} from './projects';
import {
  attachRecord,
  detachRecord,
  renameProject,
  setProjectNotes,
  setProjectStage,
  setProjectWatch,
  setProjectStatus,
  type ProjectStatus,
} from './project-mutations';

function stable(q: object): string {
  const entries = Object.entries(q)
    .filter(([, v]) => v !== undefined && v !== '')
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
}

export const projectKeys = {
  all: ['projects'] as const,
  lists: () => ['projects', 'list'] as const,
  list: (q: ProjectQuery) => ['projects', 'list', stable(q), q] as const,
  counts: () => ['projects', 'count'] as const,
  count: (q: ProjectQuery) => ['projects', 'count', stable(q), q] as const,
  facets: () => ['projects', 'facet'] as const,
  facet: (q: ProjectQuery, f: ProjectFacetField) => ['projects', 'facet', f, stable(q), q] as const,
  marketFacet: (q: ProjectQuery) => ['projects', 'facet', 'market-via-records', stable(q), q] as const,
  detail: (id: string) => ['projects', 'detail', id] as const,
  timeline: (id: string) => ['projects', 'timeline', id] as const,
  inbox: (q: InboxQuery) => ['projects', 'inbox', stable(q), q] as const,
  search: (t: string) => ['projects', 'search', t] as const,
  recordSearch: (t: string) => ['records', 'search', t] as const,
};

export function useProjectPage(q: ProjectQuery, enabled = true) {
  return useQuery({
    queryKey: projectKeys.list(q),
    queryFn: () => fetchProjectPage(q),
    enabled,
    // Keep the current page on screen while the next loads, so paging and
    // filtering never flash an empty register.
    placeholderData: (prev) => prev,
  });
}

export function useProjectCount(q: ProjectQuery, enabled = true) {
  return useQuery({
    queryKey: projectKeys.count(q),
    queryFn: () => countProjects(q),
    enabled,
    placeholderData: (prev) => prev,
  });
}

export function useProjectFacet(q: ProjectQuery, field: ProjectFacetField, enabled = true) {
  return useQuery({
    queryKey: projectKeys.facet(q, field),
    queryFn: () => projectFacetCounts(q, field),
    enabled,
    placeholderData: (prev) => prev,
  });
}

// The market facet, counted through the records rather than off the mode column,
// so a node's number is the set clicking it opens. See fetchMarketFacetFromRecords.
export function useMarketFacetFromRecords(q: ProjectQuery, enabled = true) {
  return useQuery({
    queryKey: projectKeys.marketFacet(q),
    queryFn: () => fetchMarketFacetFromRecords(q),
    enabled,
    placeholderData: (prev) => prev,
  });
}

export function useProject(id: string | null) {
  return useQuery({
    queryKey: projectKeys.detail(id ?? ''),
    queryFn: () => fetchProject(id as string),
    enabled: Boolean(id),
  });
}

export function useProjectTimeline(id: string | null) {
  return useQuery({
    queryKey: projectKeys.timeline(id ?? ''),
    queryFn: () => fetchProjectTimeline(id as string),
    enabled: Boolean(id),
  });
}

export function useInboxPage(q: InboxQuery, enabled = true) {
  return useQuery({
    queryKey: projectKeys.inbox(q),
    queryFn: () => fetchInboxPage(q),
    enabled,
    placeholderData: (prev) => prev,
  });
}

export function useProjectSearch(term: string) {
  return useQuery({
    queryKey: projectKeys.search(term),
    queryFn: () => searchProjects(term),
    enabled: term.trim().length >= 2,
  });
}

// FINDING ONE RECORD, from the palette. Three characters rather than two,
// because a record search matches title AND url and two characters of a url
// matches most of the corpus.
export function useRecordSearch(term: string) {
  return useQuery({
    queryKey: projectKeys.recordSearch(term),
    queryFn: () => searchRecords(term),
    enabled: term.trim().length >= 3,
  });
}

export interface ProjectFeedback {
  onError?: (message: string) => void;
}

// A rename or a stage change moves a project between facets and can move it in
// the sort, so everything project-shaped is invalidated. Attach and detach also
// move records between the register and the Inbox, so those invalidate the
// Inbox too.
export function useProjectMutations(feedback: ProjectFeedback = {}) {
  const client = useQueryClient();
  const fail = (err: unknown, fallback: string): void =>
    feedback.onError?.(err instanceof Error ? err.message : fallback);

  const invalidateAll = (): Promise<unknown> =>
    Promise.all([
      client.invalidateQueries({ queryKey: projectKeys.all }),
      client.invalidateQueries({ queryKey: ['leads'] }),
    ]);

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameProject(id, name),
    onError: (e) => fail(e, 'Rename failed.'),
    onSettled: invalidateAll,
  });

  const stage = useMutation({
    mutationFn: ({ id, stage: s }: { id: string; stage: string }) => setProjectStage(id, s),
    onError: (e) => fail(e, 'Stage change failed.'),
    onSettled: invalidateAll,
  });

  const watch = useMutation({
    mutationFn: ({ id, watch: w }: { id: string; watch: boolean }) => setProjectWatch(id, w),
    onError: (e) => fail(e, 'Watch change failed.'),
    onSettled: invalidateAll,
  });

  const status = useMutation({
    mutationFn: ({ id, status: st }: { id: string; status: ProjectStatus }) =>
      setProjectStatus(id, st),
    onError: (e) => fail(e, 'Status change failed.'),
    onSettled: invalidateAll,
  });

  const notes = useMutation({
    mutationFn: ({ id, notes: n }: { id: string; notes: string }) => setProjectNotes(id, n),
    onError: (e) => fail(e, 'Note save failed.'),
    onSettled: invalidateAll,
  });

  const detach = useMutation({
    mutationFn: ({ leadId, projectId }: { leadId: string; projectId: string }) =>
      detachRecord(leadId, projectId),
    onError: (e) => fail(e, 'Detach failed.'),
    onSettled: invalidateAll,
  });

  const attach = useMutation({
    mutationFn: ({ leadId, projectId }: { leadId: string; projectId: string }) =>
      attachRecord(leadId, projectId),
    onError: (e) => fail(e, 'Attach failed.'),
    onSettled: invalidateAll,
  });

  return {
    rename,
    stage,
    watch,
    status,
    notes,
    detach,
    attach,
    busy:
      rename.isPending ||
      stage.isPending ||
      watch.isPending ||
      status.isPending ||
      notes.isPending ||
      detach.isPending ||
      attach.isPending,
  };
}
