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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
const SAVED = [
  { key: 'none', label: 'None' },
  { key: 'watch-active', label: 'Watched, moving' },
  { key: 'anaheim', label: 'Anaheim' },
  { key: 'unstaged', label: 'No stage yet' },
] as const;

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

  // ---- URL state.
  const [view, setView] = useQueryState('view', parseAsString.withDefault('all'));
  const [stage, setStage] = useQueryState('stage', parseAsString);
  const [country, setCountry] = useQueryState('country', parseAsString);
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

  const geo = useMemo(
    () => ({
      country: country ?? undefined,
      region_state: region ?? undefined,
      market: market ?? undefined,
    }),
    [country, region, market]
  );

  const baseQuery: ProjectQuery = useMemo(
    () => ({
      module: LIVE_PIPELINE_STORAGE_KEY,
      ...statusFilter(viewKey),
      stage: stage ?? undefined,
      ...geo,
      search: search.trim() || undefined,
    }),
    [viewKey, stage, geo, search]
  );

  const listQuery: ProjectQuery = useMemo(
    () => ({ ...baseQuery, sortField, sortDir: sortDir === 'asc' ? 'asc' : 'desc', page, pageSize: DEFAULT_PROJECT_PAGE_SIZE }),
    [baseQuery, sortField, sortDir, page]
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
      if (key === 'watch-active') {
        void setView('watchlist');
        void setStage(null);
      } else if (key === 'anaheim') {
        void setView('all');
        void setCountry('United States');
        void setRegion('California');
        void setMarket('Anaheim');
      } else if (key === 'unstaged') {
        void setView('all');
        void setStage(null);
      } else {
        void setView('all');
        void setStage(null);
        void setCountry(null);
        void setRegion(null);
        void setMarket(null);
      }
    },
    [setSaved, setPage, setView, setStage, setCountry, setRegion, setMarket]
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
            void setSelected(current.id);
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
  }, [rows, selectedIndex, selected, move, watch]);

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
                  sortField === c.sort ? styles.colHeadActive : ''
                }`}
                onClick={() => c.sort && sortBy(c.sort)}
              >
                {c.label}
                {sortField === c.sort && (
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
            rows.map((r) => (
              <div
                key={r.id}
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
            ))
          )}
        </div>

        <div className={styles.pager}>
          <span className={`${styles.dim} mono`}>
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
