'use client';

// THE REGISTER. The working surface: rail, list, detail.
//
// WHY THIS IS THE PROJECT SURFACE AND NOT THE RECORD TABLE. The brief specifies
// the columns as project / applicant / market / stage / last activity, and the
// detail pane as record count, people with provenance, and a timeline of every
// record. Those are project properties; a single record has no timeline of
// records. The record table still exists, unchanged, at /records.
//
// EVERY FILTER AND THE SELECTION LIVE IN THE URL. A filtered Register is a link
// you can send, the back button steps through the filters you applied, and a
// reload puts you back exactly where you were, mid-triage, on the same row.
//
// TRIAGE IS A KEYBOARD JOB. J and K to move, Enter to open, E to dismiss, W to
// watch, Escape to close. A tool that needs the mouse to clear a backlog does
// not get used to clear a backlog.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryState, parseAsString, parseAsInteger } from 'nuqs';
import { PROJECT_STAGES } from '@/lib/taxonomy';
import { LIVE_PIPELINE_STORAGE_KEY } from '@/lib/pipelines';
import { DEFAULT_PROJECT_PAGE_SIZE, type Project, type ProjectQuery } from '@/lib/projects';
import {
  useProjectPage,
  useProjectCount,
  useProjectFacet,
  useProjectMutations,
} from '@/lib/use-projects';
import PeriodSelector from '@/components/PeriodSelector';
import { BUCKETS, PERIOD_AXES, bucketOf, type BucketMode } from '@/lib/period';
import { usePeriodState, useMovedProjectIds } from '@/lib/use-period';
import RegisterRail from './RegisterRail';
import RegisterDetail from './RegisterDetail';
import styles from './page.module.css';

// The views from Brief A, on the project axis. 'all' is the working set:
// everything except dismissed, because a working set that includes the bin is
// not a working set.
//
// INBOX IS DELIBERATELY ABSENT. The brief lists it, but Inbox means records not
// yet attached to any project, and this is the PROJECT register: as a project
// filter it can only resolve to "every project", which is what All already is.
// It shipped that way for one build and read as 184 next to All's 184, which is
// a control that lies about doing something. It belongs on the Records screen,
// where an unattached record is a real thing.
const VIEWS = [
  { key: 'new', label: 'New' },
  { key: 'watchlist', label: 'Watchlist' },
  { key: 'client_ready', label: 'Client ready' },
  { key: 'all', label: 'All' },
  { key: 'trash', label: 'Trash' },
] as const;
type ViewKey = (typeof VIEWS)[number]['key'];
const VIEW_KEYS = VIEWS.map((v) => v.key) as [ViewKey, ...ViewKey[]];

// Saved views are filter combinations worth one click. Deliberately a constant
// rather than a stored list: a saved view nobody named is a bookmark, and the
// URL already does bookmarks.
// Saved views are filter COMBINATIONS worth one click, and every one of them
// must actually change the result set. Two earlier entries did not and were
// removed rather than documented:
//
//   "No stage yet"    set stage to null, which is what All already does.
//                     applyProjectFilters has no "stage IS NULL" case, so an
//                     unstaged filter is not expressible against this schema.
//   "Watched, moving" only filtered on watch, so the label promised a
//                     movement filter the query never applied.
const SAVED = [
  { key: 'none', label: 'None' },
  { key: 'anaheim', label: 'Anaheim' },
  { key: 'approved', label: 'Approved, anywhere' },
  { key: 'hearing', label: 'Hearing scheduled' },
] as const;

// THE REGISTER OPENS ON THE UNITED STATES.
//
// All ten covered markets are US. The other 22 projects are global intelligence
// captures - a Jeddah headline, a Queensland trade item - which are worth having
// and are not what Philip triages. Mixed into the default list they pad the
// count and put a row with no market between two Clark County filings.
//
// CLEARING IT MUST STILL BE POSSIBLE, and that is why this is not simply a
// nuqs default. With `withDefault('United States')`, clearing writes null, null
// reads back as the default, and the filter cannot be removed at all - a
// control that silently refuses. So the parameter carries three states:
//
//   absent   the default, United States
//   'any'    explicitly cleared, every country
//   a value  that country
//
// The sentinel is a real URL value, so a cleared Register is still a link that
// survives being sent and reloaded.
const DEFAULT_COUNTRY = 'United States';
const GEO_ANY = 'any';

function effectiveCountry(param: string | null): string | undefined {
  if (param === null) return DEFAULT_COUNTRY;
  if (param === GEO_ANY) return undefined;
  return param;
}

function statusFilter(view: ViewKey): Pick<ProjectQuery, 'status' | 'excludeStatus' | 'watch'> {
  if (view === 'trash') return { status: 'dismissed' };
  if (view === 'watchlist') return { excludeStatus: 'dismissed', watch: true };
  if (view === 'all') return { excludeStatus: 'dismissed' };
  return { status: view };
}

function ymd(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : '--';
}

const COLUMNS: { key: string; label: string; sort?: string; numeric?: boolean }[] = [
  { key: 'name', label: 'Project', sort: 'name' },
  { key: 'applicant', label: 'Applicant', sort: 'primary_applicant' },
  { key: 'market', label: 'Market', sort: 'market' },
  { key: 'stage', label: 'Stage', sort: 'stage' },
  { key: 'last', label: 'Last activity', sort: 'last_activity', numeric: true },
];

export default function RegisterPage() {
  const router = useRouter();

  // ---- URL state.
  const [view, setView] = useQueryState('view', parseAsString.withDefault('all'));
  const [stage, setStage] = useQueryState('stage', parseAsString);
  const [countryParam, setCountryParam] = useQueryState('country', parseAsString);
  const [region, setRegion] = useQueryState('region', parseAsString);
  const [market, setMarket] = useQueryState('market', parseAsString);
  const [search, setSearch] = useQueryState('q', parseAsString.withDefault(''));
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [selected, setSelected] = useQueryState('selected', parseAsString);
  const [saved, setSaved] = useQueryState('saved', parseAsString.withDefault('none'));
  const [sortField, setSortField] = useQueryState(
    'sort',
    parseAsString.withDefault('last_activity')
  );
  const [sortDir, setSortDir] = useQueryState('dir', parseAsString.withDefault('desc'));
  const [bucket, setBucket] = useQueryState('bucket', parseAsString.withDefault('none'));

  // THE PERIOD. Default 'all', not a rolling window: the Register is the whole
  // register. Today is the screen that answers "recently"; opening the Register
  // on the last 30 days would hide 'projects' rather than filter them, and the
  // operator would have no way of knowing what was missing.
  const { period, setToken: setPeriod, axis, setAxis } = usePeriodState('all');
  const periodNow = useMemo(() => new Date(), []);

  // The moved axis resolves through project_events, so it is a second query.
  // Only issued when that axis is selected.
  const moved = useMovedProjectIds(period, axis === 'moved');

  const [error, setError] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState(search);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);

  const viewKey = (VIEW_KEYS as readonly string[]).includes(view) ? (view as ViewKey) : 'all';

  // Debounced search: every keystroke is a URL write and a query, and neither
  // should happen per character.
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchDraft !== search) {
        void setSearch(searchDraft || null);
        void setPage(1);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [searchDraft, search, setSearch, setPage]);

  const country = effectiveCountry(countryParam);

  const geo = useMemo(
    () => ({
      country,
      region_state: region ?? undefined,
      market: market ?? undefined,
    }),
    [country, region, market]
  );

  // Clearing the country writes the sentinel rather than removing the parameter,
  // because removing it is what brings the default back.
  const setCountry = useCallback(
    (next: string | null) => setCountryParam(next ?? GEO_ANY),
    [setCountryParam]
  );

  // THE PERIOD, ON ONE OF TWO AXES.
  //
  //   ARRIVED  projects.first_seen. When we captured it.
  //   MOVED    a project_events row inside the period. When something happened
  //            to it. Resolved to a list of ids, because the events are in
  //            another table.
  //
  // The moved axis deliberately contributes NOTHING until its query has
  // answered. Passing `ids: []` while it is in flight would show an empty
  // register for a moment and read as "nothing moved in July", which is a
  // different statement from "not known yet".
  const periodFilter: Pick<ProjectQuery, 'firstSeenFrom' | 'firstSeenTo' | 'ids'> = useMemo(() => {
    if (period.key === 'all') return {};
    if (axis === 'moved') return moved.data ? { ids: moved.data.ids } : {};
    return { firstSeenFrom: period.since, firstSeenTo: period.until };
  }, [period, axis, moved.data]);

  const baseQuery: ProjectQuery = useMemo(
    () => ({
      module: LIVE_PIPELINE_STORAGE_KEY,
      ...statusFilter(viewKey),
      stage: stage ?? undefined,
      ...geo,
      ...periodFilter,
      search: search.trim() || undefined,
    }),
    [viewKey, stage, geo, periodFilter, search]
  );

  // BUCKETING OWNS THE SORT WHILE IT IS ON.
  //
  // Buckets group the rows of the page that was fetched. Sorted by anything
  // other than the bucket's own date, a page produces interleaved headings -
  // July, then June, then July again - which is not a sequence, it is a mess
  // that looks like a data error. So turning bucketing on takes the sort with
  // it, and the column headers show that it has.
  const bucketMode = ((): BucketMode =>
    bucket === 'week' || bucket === 'month' ? bucket : 'none')();
  const bucketField = axis === 'moved' ? 'last_activity' : 'first_seen';
  const effectiveSort = bucketMode === 'none' ? sortField : bucketField;

  const listQuery: ProjectQuery = useMemo(
    () => ({
      ...baseQuery,
      sortField: effectiveSort,
      sortDir: sortDir === 'asc' ? 'asc' : 'desc',
      page,
      pageSize: DEFAULT_PROJECT_PAGE_SIZE,
    }),
    [baseQuery, effectiveSort, sortDir, page]
  );

  const list = useProjectPage(listQuery);
  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const pageCount = list.data?.pageCount ?? 1;

  // View counts share every filter EXCEPT the status axis, so a view's count is
  // exactly the rows it shows when clicked.
  const withoutStatus: ProjectQuery = {
    ...baseQuery,
    status: undefined,
    excludeStatus: undefined,
    watch: undefined,
  };
  const counts: Record<ViewKey, number | undefined> = {
    new: useProjectCount({ ...withoutStatus, status: 'new' }).data,
    watchlist: useProjectCount({ ...withoutStatus, excludeStatus: 'dismissed', watch: true }).data,
    client_ready: useProjectCount({ ...withoutStatus, status: 'client_ready' }).data,
    all: useProjectCount({ ...withoutStatus, excludeStatus: 'dismissed' }).data,
    trash: useProjectCount({ ...withoutStatus, status: 'dismissed' }).data,
  };

  // Stage facets exclude the stage filter, so a chip's count equals what
  // clicking it shows.
  const stageFacet = useProjectFacet({ ...baseQuery, stage: undefined }, 'stage');
  const geoBase: ProjectQuery = {
    ...baseQuery,
    country: undefined,
    region_state: undefined,
    market: undefined,
  };
  const countryFacet = useProjectFacet(geoBase, 'country');
  const regionFacet = useProjectFacet({ ...geoBase, country: geo.country }, 'region_state', !!geo.country);
  const marketFacet = useProjectFacet(
    { ...geoBase, country: geo.country, region_state: geo.region_state },
    'market',
    !!geo.country && !!geo.region_state
  );

  const { watch, status: statusMutation, busy } = useProjectMutations({ onError: setError });

  // ---- Navigation within the list.
  const selectedIndex = rows.findIndex((r) => r.id === selected);

  const move = useCallback(
    (delta: number) => {
      if (rows.length === 0) return;
      const next = selectedIndex < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, selectedIndex + delta));
      void setSelected(rows[next].id);
      // Keep the moving row in view without yanking the page around.
      listRef.current
        ?.querySelector(`[data-row-id="${rows[next].id}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    },
    [rows, selectedIndex, setSelected]
  );

  const applyStage = useCallback(
    (key: string | null) => {
      void setStage(key);
      void setPage(1);
      void setSaved('none');
    },
    [setStage, setPage, setSaved]
  );

  const applySaved = useCallback(
    (key: string) => {
      void setSaved(key);
      void setPage(1);
      if (key === 'anaheim') {
        void setView('all');
        void setStage(null);
        void setCountry('United States');
        void setRegion('California');
        void setMarket('Anaheim');
      } else if (key === 'approved') {
        void setView('all');
        void setStage('approved');
        void setCountry(null);
        void setRegion(null);
        void setMarket(null);
      } else if (key === 'hearing') {
        void setView('all');
        void setStage('hearing scheduled');
        void setCountry(null);
        void setRegion(null);
        void setMarket(null);
      } else {
        // None means "no saved view", not "no geography". It removes the
        // parameter entirely, which is what puts the United States default back.
        void setView('all');
        void setStage(null);
        void setCountryParam(null);
        void setRegion(null);
        void setMarket(null);
      }
    },
    [setSaved, setPage, setView, setStage, setCountry, setCountryParam, setRegion, setMarket]
  );

  // Dismiss is a status write, never a delete: Trash is a view, so restoring is
  // just another status write. Declared above the keyboard handler because that
  // handler calls it, and a const used before its declaration is a TDZ error.
  const dismiss = useCallback(
    (p: Project) => {
      setError(null);
      statusMutation.mutate({ id: p.id, status: 'dismissed' });
    },
    [statusMutation]
  );

  // Trash is a view, so restoring is the same write with a different value.
  const restore = useCallback(
    (p: Project) => {
      setError(null);
      statusMutation.mutate({ id: p.id, status: 'new' });
    },
    [statusMutation]
  );

  // ---- Keyboard triage.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Never steal a key from a field the operator is typing in.
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) {
        if (e.key === 'Escape') el.blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const current = selectedIndex >= 0 ? rows[selectedIndex] : null;
      switch (e.key.toLowerCase()) {
        case 'j':
          e.preventDefault();
          move(1);
          break;
        case 'k':
          e.preventDefault();
          move(-1);
          break;
        case 'enter':
          if (current) {
            e.preventDefault();
            // Enter is "go and read this properly", which is the full page.
            // Selecting alone is what J and K already do.
            router.push(`/project/${current.id}`);
          }
          break;
        case 'e':
          if (current) {
            e.preventDefault();
            // Dismiss moves the row out of the working set, so selection has to
            // move with it or the pane would show a project no longer listed.
            setChecked(new Set());
            void setSelected(rows[Math.min(rows.length - 1, selectedIndex + 1)]?.id ?? null);
            dismiss(current);
          }
          break;
        case 'w':
          if (current) {
            e.preventDefault();
            watch.mutate({ id: current.id, watch: !current.watch });
          }
          break;
        case 'escape':
          if (selected) {
            e.preventDefault();
            void setSelected(null);
          }
          break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, selectedIndex, selected, move, router, watch]);

  const toggleCheck = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const sortBy = (field: string) => {
    if (sortField === field) void setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else {
      void setSortField(field);
      void setSortDir('asc');
    }
    // Clicking a column header is an instruction to sort by that column, and
    // bucketing owns the sort. Leaving both on would put the arrow on one column
    // while the rows obeyed another - a header lying about what it had just done.
    void setBucket(null);
    void setPage(1);
  };

  const stageChips = useMemo(() => {
    const counts = new Map((stageFacet.data?.counts ?? []).map((f) => [f.value, f.count] as const));
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    return [
      { value: null as string | null, label: 'All stages', count: total },
      ...PROJECT_STAGES.filter((s) => (counts.get(s) ?? 0) > 0 || stage === s).map((s) => ({
        value: s as string | null,
        label: s,
        count: counts.get(s) ?? 0,
      })),
    ];
  }, [stageFacet.data, stage]);

  return (
    <div className={styles.screen}>
      <RegisterRail
        views={VIEWS.map((v) => ({ ...v, count: counts[v.key] }))}
        view={viewKey}
        onView={(k) => {
          void setView(k);
          void setPage(1);
          void setSelected(null);
        }}
        countries={countryFacet.data?.counts ?? []}
        regions={regionFacet.data?.counts ?? []}
        markets={marketFacet.data?.counts ?? []}
        geo={geo}
        onGeo={(next) => {
          void setCountry(next.country ?? null);
          void setRegion(next.region_state ?? null);
          void setMarket(next.market ?? null);
          void setPage(1);
        }}
        savedViews={[...SAVED]}
        activeSaved={saved}
        onSaved={applySaved}
      />

      <div className={`${styles.listPane} ${viewKey === 'trash' ? styles.trashView : ''}`}>
        <div className={styles.listHead}>
          <div className={styles.chips}>
            {stageChips.map((c) => (
              <button
                key={c.label}
                type="button"
                data-stage={c.value ?? 'all'}
                className={`${styles.chip} ${stage === c.value ? styles.chipActive : ''}`}
                onClick={() => applyStage(c.value)}
              >
                {c.label}
                <span className={`${styles.chipCount} mono`}>{c.count}</span>
              </button>
            ))}
          </div>
          <input
            className={styles.search}
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Project, applicant or representative"
            aria-label="Search projects"
          />
        </div>

        <div className={styles.periodBar}>
          <PeriodSelector
            period={period}
            now={periodNow}
            onChange={(t) => {
              setPeriod(t);
              void setPage(1);
            }}
          />

          {/* THE AXIS. Which date the period is applied to. Two different
              questions - what arrived, and what moved - that a single "period"
              control would silently conflate. */}
          <div className={styles.axisGroup}>
            {PERIOD_AXES.map((a) => (
              <button
                key={a.key}
                type="button"
                title={a.help}
                data-axis={a.key}
                className={`${styles.chip} ${axis === a.key ? styles.chipActive : ''}`}
                onClick={() => {
                  setAxis(a.key);
                  void setPage(1);
                }}
              >
                {a.label}
              </button>
            ))}
            {BUCKETS.map((b) => (
              <button
                key={b.key}
                type="button"
                data-bucket={b.key}
                className={`${styles.chip} ${bucketMode === b.key ? styles.chipActive : ''}`}
                onClick={() => {
                  void setBucket(b.key === 'none' ? null : b.key);
                  void setPage(1);
                }}
              >
                {b.label}
              </button>
            ))}
          </div>

          {bucketMode !== 'none' && (
            <span className={`${styles.dim} mono`} data-testid="bucket-sort-note">
              ordered by {bucketField === 'first_seen' ? 'first seen' : 'last activity'}
            </span>
          )}

          {axis === 'moved' && (
            <span className={`${styles.dim} mono`}>
              {moved.isPending
                ? 'resolving events...'
                : `${moved.data?.events ?? 0} events, ${moved.data?.ids.length ?? 0} projects`}
              {moved.data?.capped ? ' (CAPPED)' : ''}
            </span>
          )}
        </div>

        {error && (
          <div className={styles.error} role="alert">
            {error}
            <button type="button" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        )}

        {checked.size > 0 && (
          <div className={styles.bulk}>
            <span className="mono">{checked.size} selected</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                rows.filter((r) => checked.has(r.id)).forEach((r) => watch.mutate({ id: r.id, watch: true }));
                setChecked(new Set());
              }}
            >
              Watch
            </button>
            {/* In Trash the only useful bulk action is the way back out.
                Nothing is ever deleted, so this is the same status write. */}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                rows
                  .filter((r) => checked.has(r.id))
                  .forEach(viewKey === 'trash' ? restore : dismiss);
                setChecked(new Set());
              }}
            >
              {viewKey === 'trash' ? 'Restore' : 'Dismiss'}
            </button>
            <button type="button" onClick={() => setChecked(new Set())}>
              Clear
            </button>
          </div>
        )}

        <div className={styles.table} ref={listRef}>
          <div className={styles.headRow} role="row">
            <span />
            {COLUMNS.map((c) => (
              <button
                key={c.key}
                type="button"
                className={`${styles.colHead} ${c.numeric ? styles.num : ''} ${
                  effectiveSort === c.sort ? styles.colHeadActive : ''
                }`}
                onClick={() => c.sort && sortBy(c.sort)}
              >
                {c.label}
                {effectiveSort === c.sort && (
                  <span className={`${styles.sortMark} mono`} aria-hidden="true">
                    {sortDir === 'asc' ? '↑' : '↓'}
                  </span>
                )}
              </button>
            ))}
          </div>

          {list.isPending ? (
            <p className={styles.dim}>Loading...</p>
          ) : rows.length === 0 ? (
            <p className={styles.dim}>
              No projects match this view. {view !== 'all' && 'Try All, or clear the geography filter.'}
            </p>
          ) : (
            rows.map((r, i) => (
              <Fragment key={r.id}>
                {bucketMode !== 'none' &&
                  bucketOf(bucketField === 'first_seen' ? r.first_seen : r.last_activity, bucketMode) !==
                    bucketOf(
                      i === 0
                        ? null
                        : bucketField === 'first_seen'
                          ? rows[i - 1].first_seen
                          : rows[i - 1].last_activity,
                      bucketMode
                    ) && (
                    <div className={styles.bucketHead} role="row">
                      {bucketOf(
                        bucketField === 'first_seen' ? r.first_seen : r.last_activity,
                        bucketMode
                      ) || 'Undated'}
                    </div>
                  )}
              <div
                data-row-id={r.id}
                role="row"
                tabIndex={-1}
                className={`${styles.row} ${selected === r.id ? styles.rowSelected : ''}`}
                onClick={() => void setSelected(r.id)}
              >
                <span onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    className={styles.check}
                    checked={checked.has(r.id)}
                    onChange={() => toggleCheck(r.id)}
                    aria-label={`Select ${r.name}`}
                  />
                </span>
                <span className={styles.cellName} title={r.name}>
                  {r.watch && (
                    <span className={styles.watchDot} title="Watched" aria-label="Watched" />
                  )}
                  {r.name}
                </span>
                <span className={styles.cell}>{r.primary_applicant ?? '--'}</span>
                <span className={styles.cell}>{r.market ?? r.region_state ?? '--'}</span>
                <span className={styles.cell}>{r.stage ?? '--'}</span>
                <span className={`${styles.cell} ${styles.num} mono`}>{ymd(r.last_activity)}</span>
                {viewKey === 'trash' && (
                  <button
                    type="button"
                    className={styles.rowAction}
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      restore(r);
                    }}
                  >
                    Restore
                  </button>
                )}
              </div>
              </Fragment>
            ))
          )}
        </div>

        <div className={styles.pager}>
          {/* data-total carries the server's exact count as a value rather than
              as prose. The filtering audit reads it, and parsing "1-50 of 184 |
              648 ms rows" out of a sentence is the kind of thing that silently
              starts matching the wrong element. */}
          <span
            className={`${styles.dim} mono`}
            data-testid="pager-total"
            {...(list.isPending ? {} : { 'data-total': total })}
          >
            {total === 0
              ? 'No projects'
              : `${(page - 1) * DEFAULT_PROJECT_PAGE_SIZE + 1}-${Math.min(
                  page * DEFAULT_PROJECT_PAGE_SIZE,
                  total
                )} of ${total}`}
            {list.data ? ` | ${list.data.rowsMs} ms rows, ${list.data.countMs} ms count` : ''}
          </span>
          <div className={styles.pagerBtns}>
            <button type="button" disabled={page <= 1} onClick={() => void setPage(page - 1)}>
              Previous
            </button>
            <span className="mono">
              {page} / {pageCount}
            </span>
            <button
              type="button"
              disabled={page >= pageCount}
              onClick={() => void setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </div>

        <p className={styles.keys}>
          <span className="mono">J</span> / <span className="mono">K</span> move
          <span className={styles.dot} aria-hidden="true" />
          <span className="mono">Enter</span> open
          <span className={styles.dot} aria-hidden="true" />
          <span className="mono">E</span> dismiss
          <span className={styles.dot} aria-hidden="true" />
          <span className="mono">W</span> watch
          <span className={styles.dot} aria-hidden="true" />
          <span className="mono">Esc</span> close
        </p>
      </div>

      {selected && (
        <RegisterDetail id={selected} onClose={() => void setSelected(null)} onError={setError} />
      )}
    </div>
  );
}
