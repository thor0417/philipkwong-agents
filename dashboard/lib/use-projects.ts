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
//
// ONE EXCEPTION, and it is not about latency: the watch toggle. See the note on
// the watch mutation below. Its next value is computed from the row on screen,
// so a lagging read is not a slow screen there but a WRONG WRITE.

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
  type Project,
  type ProjectFacetField,
  type ProjectPage,
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

  // THE WATCH TOGGLE IS OPTIMISTIC, AND IT IS THE ONE EXCEPTION TO THE NOTE AT
  // THE TOP OF THIS FILE.
  //
  // W on the register computes its next value from the row on screen, as
  // `!current.watch`. The pane and the list are two DIFFERENT queries reading
  // the same fact: ['projects','detail',id] fetches one row and returns first,
  // ['projects','list',...] fetches a page AND a count and returns later. Both
  // are invalidated correctly - projectKeys.all is ['projects'] and prefix
  // matches both - but invalidation is not instantaneous, and between the two
  // returns the pane read "Watching" while the row's dot and the row's `watch`
  // still held the old value. A second press in that window therefore re-sent
  // the first mutation instead of reversing it: the key toggled once, and the
  // project was left on the watchlist.
  //
  // Patching both caches at the moment of the write closes the window rather
  // than narrowing it: there is no interval in which the screen disagrees with
  // what was just written, so the next press always reverses the last one. The
  // rename argument for staying pessimistic does not carry here - a watch flag
  // is one boolean, and it is rolled back below, so a failed write cannot leave
  // a dot standing for a project that was never watched.
  const patchWatch = (id: string, w: boolean): void => {
    client.setQueriesData<ProjectPage>({ queryKey: projectKeys.lists() }, (page) =>
      page && page.rows.some((r) => r.id === id)
        ? { ...page, rows: page.rows.map((r) => (r.id === id ? { ...r, watch: w } : r)) }
        : page
    );
    client.setQueryData<Project>(projectKeys.detail(id), (p) => (p ? { ...p, watch: w } : p));
  };

  const watch = useMutation({
    mutationFn: ({ id, watch: w }: { id: string; watch: boolean }) => setProjectWatch(id, w),
    onMutate: async ({ id, watch: w }: { id: string; watch: boolean }) => {
      // SNAPSHOT AND PATCH BEFORE THE FIRST await, SO BOTH HAPPEN INSIDE THE
      // .mutate() CALL ITSELF. Everything after an await runs a tick later, and
      // a tick is long enough for a second keypress to read the old value.
      const lists = client.getQueriesData<ProjectPage>({ queryKey: projectKeys.lists() });
      const detail = client.getQueryData<Project>(projectKeys.detail(id));
      patchWatch(id, w);
      // An in-flight read would land after the patch and undo it.
      await Promise.all([
        client.cancelQueries({ queryKey: projectKeys.lists() }),
        client.cancelQueries({ queryKey: projectKeys.detail(id) }),
      ]);
      return { id, lists, detail };
    },
    onError: (e, _vars, ctx) => {
      if (ctx) {
        ctx.lists.forEach(([key, data]) => client.setQueryData(key, data));
        client.setQueryData(projectKeys.detail(ctx.id), ctx.detail);
      }
      fail(e, 'Watch change failed.');
    },
    onSettled: invalidateAll,
  });

  // THE NEXT VALUE IS READ AT THE MOMENT OF THE PRESS, NOT FROM THE ROW THAT
  // WAS RENDERED. This is the other half of the W-key defect and the half the
  // cache patch above cannot reach on its own.
  //
  // The register's key handler closes over `rows` from the render that was on
  // screen when the listener was attached. Patching the cache re-renders and
  // re-attaches it, but a re-render is scheduled, not immediate: two presses in
  // the same tick are BOTH handled by the first closure, so the second still
  // computed `!oldValue` and re-sent the first write. Nothing that depends on a
  // render can close that window.
  //
  // The cache can. setQueryData is synchronous and onMutate patches before its
  // first await, so by the time .mutate() returns, the cache already holds what
  // was just written - whatever React has or has not re-rendered. Reading the
  // next value from there makes each press reverse the one before it.
  //
  // The row on screen is the fallback and nothing more: it is right whenever the
  // cache has no entry, and wrong only in the window this exists to close.
  const readWatch = (id: string, fallback: boolean): boolean => {
    const detail = client.getQueryData<Project>(projectKeys.detail(id));
    if (detail) return Boolean(detail.watch);
    for (const [, page] of client.getQueriesData<ProjectPage>({ queryKey: projectKeys.lists() })) {
      const row = page?.rows.find((r) => r.id === id);
      if (row) return Boolean(row.watch);
    }
    return fallback;
  };

  const toggleWatch = (id: string, onScreen: boolean | null): void => {
    watch.mutate({ id, watch: !readWatch(id, Boolean(onScreen)) });
  };

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
    toggleWatch,
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
