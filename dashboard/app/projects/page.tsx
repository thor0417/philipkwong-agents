'use client';
import { LIVE_PIPELINE_STORAGE_KEY } from '@/lib/pipelines';

// THE PROJECTS REGISTER. The primary view.
//
// The flat feed at /gli stays as the secondary tab, because a record-level view
// is still the right tool for triage. But the business thinks in projects, and
// at 25 markets the record count has to become irrelevant: 20,000 records is
// unreadable, and the ~1,500 projects behind them, with a stage and a market,
// are browsable.
//
// Everything here is server-side. Filtering, sorting, paging, searching and the
// facet counts all happen in Postgres against the indexes in migration 016; the
// footer prints how many rows this page load actually transferred, so "server-
// side paging" is a number on the screen rather than a claim.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { PROJECT_STAGES, STAGE_LADDER, isLadderStage } from '@/lib/taxonomy';
import {
  DEFAULT_PROJECT_PAGE_SIZE,
  type Project,
  type ProjectQuery,
  type TimelineRecord,
} from '@/lib/projects';
import {
  useInboxPage,
  useProject,
  useProjectFacet,
  useProjectMutations,
  useProjectPage,
  useProjectSearch,
  useProjectTimeline,
} from '@/lib/use-projects';
import { projectOverriddenFields } from '@/lib/project-mutations';
import styles from './page.module.css';

type Tab = 'register' | 'inbox';

const DASH = '--';

function fmtDate(d: string | null | undefined): string {
  if (!d) return DASH;
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? DASH : t.toISOString().slice(0, 10);
}

// The best date a record carries, and where it came from. A record with only a
// first_seen floor is badged rather than silently printed as if it were a real
// document date.
function recordDate(r: TimelineRecord): { date: string; unknown: boolean } {
  const d = r.published_date ?? r.deadline ?? r.first_seen ?? null;
  return { date: fmtDate(d), unknown: r.date_source === 'first_seen' || !r.date_source };
}

function stageClass(stage: string | null): string {
  if (!stage) return styles.stage;
  if (stage === 'stalled' || stage === 'dormant') return `${styles.stage} ${styles.stageHalted}`;
  if (isLadderStage(stage) && STAGE_LADDER.indexOf(stage as never) >= 2) {
    return `${styles.stage} ${styles.stageAdvanced}`;
  }
  return styles.stage;
}

export default function ProjectsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('register');
  const [error, setError] = useState<string | null>(null);

  // Every one of these is a database filter, never a client-side predicate.
  const [stage, setStage] = useState<string | null>(null);
  const [geo, setGeo] = useState<{ country?: string; region_state?: string; market?: string }>({});
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [watchOnly, setWatchOnly] = useState(false);
  const [sort, setSort] = useState<{ field: string; dir: 'asc' | 'desc' }>({
    field: 'last_activity',
    dir: 'desc',
  });
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [inboxPage, setInboxPage] = useState(1);
  const [inboxSearch, setInboxSearch] = useState('');
  const [inboxSearchInput, setInboxSearchInput] = useState('');

  useEffect(() => {
    let alive = true;
    async function init() {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) {
        router.replace('/login');
        return;
      }
      if (alive) setLoading(false);
    }
    init();
    return () => {
      alive = false;
    };
  }, [router]);

  const query: ProjectQuery = useMemo(
    () => ({
      module: LIVE_PIPELINE_STORAGE_KEY,
      stage: stage ?? undefined,
      country: geo.country,
      region_state: geo.region_state,
      market: geo.market,
      watch: watchOnly ? true : undefined,
      search: search || undefined,
      sortField: sort.field,
      sortDir: sort.dir,
      page,
      pageSize: DEFAULT_PROJECT_PAGE_SIZE,
    }),
    [stage, geo, watchOnly, search, sort, page]
  );

  // The stage facet must not filter on stage, or every chip reports the count of
  // the chip already selected.
  const facetBase: ProjectQuery = useMemo(() => ({ ...query, stage: undefined, page: 1 }), [query]);

  const projects = useProjectPage(query, !loading && tab === 'register');
  const stageFacet = useProjectFacet(facetBase, 'stage', !loading && tab === 'register');
  const countryFacet = useProjectFacet(
    { ...facetBase, country: undefined, region_state: undefined, market: undefined },
    'country',
    !loading && tab === 'register'
  );
  const stateFacet = useProjectFacet(
    { ...facetBase, region_state: undefined, market: undefined },
    'region_state',
    !loading && tab === 'register' && Boolean(geo.country)
  );
  const marketFacet = useProjectFacet(
    { ...facetBase, market: undefined },
    'market',
    !loading && tab === 'register' && Boolean(geo.region_state)
  );

  const inbox = useInboxPage(
    { search: inboxSearch || undefined, page: inboxPage, pageSize: DEFAULT_PROJECT_PAGE_SIZE },
    !loading && tab === 'inbox'
  );

  const mutations = useProjectMutations({ onError: setError });

  const resetPage = useCallback(() => setPage(1), []);

  const toggleSort = (field: string): void => {
    setSort((s) => (s.field === field ? { field, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { field, dir: 'desc' }));
    resetPage();
  };

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.empty}>Loading...</div>
      </div>
    );
  }

  const stageCounts = new Map((stageFacet.data?.counts ?? []).map((c) => [c.value, c.count]));
  const stageTotal = (stageFacet.data?.counts ?? []).reduce((a, c) => a + c.count, 0);

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1 className={styles.title}>
          <span className="bracket">[</span> PROJECTS <span className="bracket">]</span>
        </h1>
        <div className={styles.tabs}>
          <button
            className={tab === 'register' ? styles.tabActive : ''}
            onClick={() => setTab('register')}
          >
            Register
          </button>
          <button className={tab === 'inbox' ? styles.tabActive : ''} onClick={() => setTab('inbox')}>
            Inbox {inbox.data ? `(${inbox.data.total})` : ''}
          </button>
          <Link href="/gli">
            <button>Records</button>
          </Link>
        </div>
      </div>

      {error && (
        <div className={styles.error}>
          {error} <button className={styles.link} onClick={() => setError(null)}>dismiss</button>
        </div>
      )}

      {openId ? (
        <ProjectDetail
          id={openId}
          onClose={() => setOpenId(null)}
          mutations={mutations}
          onError={setError}
        />
      ) : tab === 'register' ? (
        <>
          <div className={styles.controls}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setSearch(searchInput);
                resetPage();
              }}
            >
              <input
                className={styles.search}
                placeholder="Search name, applicant, representative"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </form>
            <button
              className={watchOnly ? styles.tabActive : ''}
              onClick={() => {
                setWatchOnly((w) => !w);
                resetPage();
              }}
            >
              Watch only
            </button>
            {(stage || geo.country || search || watchOnly) && (
              <button
                onClick={() => {
                  setStage(null);
                  setGeo({});
                  setSearch('');
                  setSearchInput('');
                  setWatchOnly(false);
                  resetPage();
                }}
              >
                Clear
              </button>
            )}
          </div>

          {/* Geography navigation: country, then state, then market. Each level
              is an indexed database filter, and each carries its faceted count. */}
          <div className={styles.chips}>
            <button
              className={`${styles.chip} ${!geo.country ? styles.chipActive : ''}`}
              onClick={() => {
                setGeo({});
                resetPage();
              }}
            >
              All geography
            </button>
            {(countryFacet.data?.counts ?? []).slice(0, 12).map((c) => (
              <button
                key={c.value}
                className={`${styles.chip} ${geo.country === c.value ? styles.chipActive : ''}`}
                onClick={() => {
                  setGeo({ country: c.value });
                  resetPage();
                }}
              >
                {c.value}
                <span className={styles.chipCount}>{c.count}</span>
              </button>
            ))}
          </div>
          {geo.country && (
            <div className={styles.chips}>
              {(stateFacet.data?.counts ?? []).map((c) => (
                <button
                  key={c.value}
                  className={`${styles.chip} ${geo.region_state === c.value ? styles.chipActive : ''}`}
                  onClick={() => {
                    setGeo({ country: geo.country, region_state: c.value });
                    resetPage();
                  }}
                >
                  {c.value}
                  <span className={styles.chipCount}>{c.count}</span>
                </button>
              ))}
            </div>
          )}
          {geo.region_state && (
            <div className={styles.chips}>
              {(marketFacet.data?.counts ?? []).map((c) => (
                <button
                  key={c.value}
                  className={`${styles.chip} ${geo.market === c.value ? styles.chipActive : ''}`}
                  onClick={() => {
                    setGeo({ ...geo, market: c.value });
                    resetPage();
                  }}
                >
                  {c.value}
                  <span className={styles.chipCount}>{c.count}</span>
                </button>
              ))}
            </div>
          )}

          {/* Stage chips, with faceted counts. Same pattern as the category
              chips on the records view. */}
          <div className={styles.chips}>
            <button
              className={`${styles.chip} ${!stage ? styles.chipActive : ''}`}
              onClick={() => {
                setStage(null);
                resetPage();
              }}
            >
              All stages
              <span className={styles.chipCount}>{stageTotal}</span>
            </button>
            {PROJECT_STAGES.map((s) => (
              <button
                key={s}
                className={`${styles.chip} ${stage === s ? styles.chipActive : ''}`}
                onClick={() => {
                  setStage(stage === s ? null : s);
                  resetPage();
                }}
              >
                {s}
                <span className={styles.chipCount}>{stageCounts.get(s) ?? 0}</span>
              </button>
            ))}
          </div>

          <table className={styles.table}>
            <thead>
              <tr>
                <th onClick={() => toggleSort('name')}>Project</th>
                <th onClick={() => toggleSort('market')}>Market</th>
                <th onClick={() => toggleSort('stage')}>Stage</th>
                <th onClick={() => toggleSort('last_activity')}>Last activity</th>
                <th onClick={() => toggleSort('record_count')} style={{ textAlign: 'right' }}>
                  Records
                </th>
                <th onClick={() => toggleSort('watch')}>Watch</th>
                <th onClick={() => toggleSort('primary_applicant')}>Applicant</th>
              </tr>
            </thead>
            <tbody>
              {(projects.data?.rows ?? []).map((p) => (
                <tr key={p.id} className={styles.row} onClick={() => setOpenId(p.id)}>
                  <td>
                    <div className={styles.name}>{p.name}</div>
                    {p.next_milestone && (
                      <div className={styles.meta}>next milestone {fmtDate(p.next_milestone)}</div>
                    )}
                  </td>
                  <td className={styles.meta}>
                    {p.market ?? p.region_state ?? p.country ?? DASH}
                  </td>
                  <td>
                    <span className={stageClass(p.stage)}>{p.stage ?? DASH}</span>
                  </td>
                  <td className={styles.meta}>{fmtDate(p.last_activity)}</td>
                  <td className={styles.num}>{p.record_count ?? 0}</td>
                  <td className={styles.watch}>{p.watch ? 'WATCH' : ''}</td>
                  <td className={styles.meta}>{p.primary_applicant ?? DASH}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {projects.data && projects.data.rows.length === 0 && (
            <div className={styles.empty}>No projects match this filter.</div>
          )}

          <div className={styles.footer}>
            <div>
              {projects.data
                ? `${projects.data.total} projects | page ${projects.data.page} of ${projects.data.pageCount} | ` +
                  `${projects.data.rowsFetched} rows fetched this load | ` +
                  `rows ${projects.data.rowsMs}ms, count ${projects.data.countMs}ms | ` +
                  `facets ${stageFacet.data?.viaRpc ? 'via RPC' : 'client-grouped (migration 017 not applied)'}`
                : 'loading...'}
            </div>
            <div className={styles.pager}>
              <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Prev
              </button>
              <button
                disabled={!projects.data || page >= projects.data.pageCount}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      ) : (
        <InboxView
          data={inbox.data}
          searchInput={inboxSearchInput}
          onSearchInput={setInboxSearchInput}
          onSearch={(v) => {
            setInboxSearch(v);
            setInboxPage(1);
          }}
          page={inboxPage}
          onPage={setInboxPage}
          mutations={mutations}
        />
      )}
    </div>
  );
}

// ---- Detail -----------------------------------------------------------------

function ProjectDetail({
  id,
  onClose,
  mutations,
  onError,
}: {
  id: string;
  onClose: () => void;
  mutations: ReturnType<typeof useProjectMutations>;
  onError: (m: string) => void;
}) {
  const project = useProject(id);
  const timeline = useProjectTimeline(id);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [notesDraft, setNotesDraft] = useState<string | null>(null);

  const p: Project | undefined = project.data;
  if (project.isLoading || !p) {
    return (
      <div className={styles.detail}>
        <div className={styles.empty}>{project.isError ? 'Project not found.' : 'Loading...'}</div>
        <button onClick={onClose}>Back to register</button>
      </div>
    );
  }

  const overridden = projectOverriddenFields(p.manual_overrides);
  const records = timeline.data ?? [];

  // People, with their provenance: which record named them, and whether that
  // record's own document supplied it.
  const people = records
    .flatMap((r) =>
      [
        ['Applicant', r.applicant],
        ['Representative', r.representative],
        ['Presented by', r.presented_by],
        ['Contact', r.contact_name],
      ]
        .filter(([, v]) => Boolean(v))
        .map(([role, value]) => ({
          role: role as string,
          value: value as string,
          source: r.title ?? r.url,
          url: r.url,
          fromDocument: Boolean(r.primary_document_url),
        }))
    )
    .filter((v, i, arr) => arr.findIndex((o) => o.role === v.role && o.value === v.value) === i);

  return (
    <div className={styles.detail}>
      <div className={styles.detailHead}>
        <div>
          {renaming ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                mutations.rename.mutate(
                  { id, name: nameDraft },
                  { onSuccess: () => setRenaming(false) }
                );
              }}
            >
              <input
                className={styles.search}
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                autoFocus
              />
              <button type="submit">Save</button>
              <button type="button" onClick={() => setRenaming(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <h2 className={styles.detailTitle}>{p.name}</h2>
          )}
          <div className={styles.meta}>
            {[p.market, p.region_state, p.country].filter(Boolean).join(' / ') || 'no geography'}
            {' | '}
            {p.record_count ?? 0} records
            {' | first seen '}
            {fmtDate(p.first_seen)}
            {p.next_milestone ? ` | next milestone ${fmtDate(p.next_milestone)}` : ''}
            {overridden.length ? ` | hand-set: ${overridden.join(', ')}` : ''}
          </div>
        </div>
        <div className={styles.detailActions}>
          <span className={stageClass(p.stage)}>{p.stage ?? DASH}</span>
          <select
            value={p.stage ?? ''}
            onChange={(e) => mutations.stage.mutate({ id, stage: e.target.value })}
          >
            {PROJECT_STAGES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              setNameDraft(p.name);
              setRenaming(true);
            }}
          >
            Rename
          </button>
          <button onClick={() => mutations.watch.mutate({ id, watch: !p.watch })}>
            {p.watch ? 'Unwatch' : 'Watch'}
          </button>
          <button onClick={onClose}>Back</button>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Timeline ({records.length})</div>
        <ul className={styles.timeline}>
          {records.map((r) => {
            const d = recordDate(r);
            return (
              <li key={r.id} className={styles.event}>
                <span className={styles.eventDate}>
                  {d.date}
                  {d.unknown ? '*' : ''}
                </span>
                <span className={styles.eventType}>
                  {r.source_type ?? r.source ?? DASH}
                  <br />
                  <span style={{ opacity: 0.7 }}>{r.cluster_reason ?? DASH}</span>
                </span>
                <span className={styles.eventTitle}>
                  <a href={r.url} target="_blank" rel="noreferrer">
                    {(r.title ?? r.url).replace(/\s+/g, ' ').slice(0, 200)}
                  </a>
                  {r.action_sought && <div className={styles.provenance}>{r.action_sought}</div>}
                </span>
                <button
                  className={styles.link}
                  onClick={() => mutations.detach.mutate({ leadId: r.id, projectId: id })}
                >
                  Detach
                </button>
              </li>
            );
          })}
        </ul>
        {records.length === 0 && <div className={styles.empty}>No records attached.</div>}
        <div className={styles.provenance} style={{ marginTop: 8 }}>
          * date is a first-seen floor, not a document date. Detached records return to the Inbox
          and are never deleted.
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>People</div>
        {people.length === 0 ? (
          <div className={styles.empty}>No people named in the records.</div>
        ) : (
          <div className={styles.people}>
            {people.map((pp, i) => (
              <div key={`${pp.role}-${i}`} style={{ display: 'contents' }}>
                <div className={styles.peopleLabel}>{pp.role}</div>
                <div>
                  {pp.value}
                  <div className={styles.provenance}>
                    from{' '}
                    <a href={pp.url} target="_blank" rel="noreferrer">
                      {pp.source.replace(/\s+/g, ' ').slice(0, 90)}
                    </a>
                    {pp.fromDocument ? ' (document-sourced)' : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Notes</div>
        <textarea
          className={styles.notes}
          value={notesDraft ?? p.notes ?? ''}
          onChange={(e) => setNotesDraft(e.target.value)}
        />
        <div className={styles.attachRow}>
          <button
            disabled={notesDraft === null}
            onClick={() => {
              if (notesDraft === null) return;
              mutations.notes.mutate(
                { id, notes: notesDraft },
                { onSuccess: () => setNotesDraft(null), onError: () => onError('Note save failed.') }
              );
            }}
          >
            Save note
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Inbox ------------------------------------------------------------------

function InboxView({
  data,
  searchInput,
  onSearchInput,
  onSearch,
  page,
  onPage,
  mutations,
}: {
  data: Awaited<ReturnType<typeof import('@/lib/projects').fetchInboxPage>> | undefined;
  searchInput: string;
  onSearchInput: (v: string) => void;
  onSearch: (v: string) => void;
  page: number;
  onPage: (p: number) => void;
  mutations: ReturnType<typeof useProjectMutations>;
}) {
  const [attachFor, setAttachFor] = useState<string | null>(null);
  const [projectQuery, setProjectQuery] = useState('');
  const candidates = useProjectSearch(projectQuery);

  return (
    <>
      <div className={styles.controls}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSearch(searchInput);
          }}
        >
          <input
            className={styles.search}
            placeholder="Search unclustered records"
            value={searchInput}
            onChange={(e) => onSearchInput(e.target.value)}
          />
        </form>
        <span className={styles.meta}>
          Records the engine could not place. Visible, never hidden, never deleted.
        </span>
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Record</th>
            <th>Source</th>
            <th>Date</th>
            <th>Applicant</th>
            <th>Attach</th>
          </tr>
        </thead>
        <tbody>
          {(data?.rows ?? []).map((r) => {
            const d = recordDate(r);
            return (
              <tr key={r.id}>
                <td>
                  <a href={r.url} target="_blank" rel="noreferrer">
                    {(r.title ?? r.url).replace(/\s+/g, ' ').slice(0, 140)}
                  </a>
                  {r.cluster_reason === 'detached' && (
                    <div className={styles.provenance}>detached by hand</div>
                  )}
                </td>
                <td className={styles.meta}>{r.source_type ?? r.source ?? DASH}</td>
                <td className={styles.meta}>
                  {d.date}
                  {d.unknown ? '*' : ''}
                </td>
                <td className={styles.meta}>{r.applicant ?? DASH}</td>
                <td>
                  {attachFor === r.id ? (
                    <div className={styles.attachRow}>
                      <input
                        className={styles.search}
                        placeholder="Find a project"
                        value={projectQuery}
                        onChange={(e) => setProjectQuery(e.target.value)}
                        autoFocus
                      />
                      <select
                        onChange={(e) => {
                          if (!e.target.value) return;
                          mutations.attach.mutate(
                            { leadId: r.id, projectId: e.target.value },
                            {
                              onSuccess: () => {
                                setAttachFor(null);
                                setProjectQuery('');
                              },
                            }
                          );
                        }}
                        defaultValue=""
                      >
                        <option value="">
                          {candidates.data?.length ? 'Select a project' : 'Type at least 2 letters'}
                        </option>
                        {(candidates.data ?? []).map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({c.record_count ?? 0}) {c.market ? `- ${c.market}` : ''}
                          </option>
                        ))}
                      </select>
                      <button onClick={() => setAttachFor(null)}>Cancel</button>
                    </div>
                  ) : (
                    <button className={styles.link} onClick={() => setAttachFor(r.id)}>
                      Attach
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {data && data.rows.length === 0 && <div className={styles.empty}>The Inbox is empty.</div>}

      <div className={styles.footer}>
        <div>
          {data
            ? `${data.total} unclustered records | page ${data.page} of ${data.pageCount} | ${data.rowsFetched} rows fetched this load`
            : 'loading...'}
        </div>
        <div className={styles.pager}>
          <button disabled={page <= 1} onClick={() => onPage(Math.max(1, page - 1))}>
            Prev
          </button>
          <button disabled={!data || page >= data.pageCount} onClick={() => onPage(page + 1)}>
            Next
          </button>
        </div>
      </div>
    </>
  );
}
