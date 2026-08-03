'use client';
import { LIVE_PIPELINE_STORAGE_KEY } from '@/lib/pipelines';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import type { GLILead } from '@/lib/types';
import { VENUE_TYPES, DEVELOPMENT_CATEGORIES, categoryForVenue } from '@/lib/taxonomy';
import GLINav from '@/components/GLINav';
import GLIStats from '@/components/GLIStats';
import GLIFilters, { type GLIChip } from '@/components/GLIFilters';
import GLITable, { type GLIColumn } from '@/components/GLITable';
import GLIDetail from '@/components/GLIDetail';
import GLISourceLink from '@/components/GLISourceLink';
import { buildGliWorkbook, gliXlsxFilename } from '@/lib/gli-xlsx';
import { buildReportPayload, gliReportFilename, type ReportScope } from '@/lib/gli-report';
import { GLI_PRESETS } from '@/lib/gli-presets';
import { fetchLeadPage, DEFAULT_PAGE_SIZE, daysAgoIso, type LeadQuery } from '@/lib/query';
import { STATUS_LABELS, type LeadStatus } from '@/lib/mutations';
import {
  useLeadPage,
  useLeadCount,
  useFacet,
  useUnresolvedGeoCount,
  useBacklog,
  useLeadMutations,
} from '@/lib/use-leads';
import GeoNav from '@/components/GeoNav';
import styles from './page.module.css';
import { authedFetch } from '@/lib/authed-fetch';

const GLI_COLUMNS_BASE =
  'id, title, venue_type, signal_type, location, company, contact_name, contact_email, contact_phone, url, raw_content, date_found, score, source_tier, stream, deadline, published_date, source';
// Pass 4 government fields + date provenance (012). Selected only when the 009-012
// migrations exist; the load falls back to the base set otherwise so the page never
// breaks (date_source then reads as undefined and the badge falls back to the date
// columns, which are always in the base set).
const GLI_COLUMNS_FULL =
  `${GLI_COLUMNS_BASE}, source_type, presented_by, applicant, representative, action_sought, primary_document_url, has_primary_document, date_source, first_seen, object_type, milestone_date`;

const DASH = '--';

// Canonical accessors (single source of truth). Trimmed so trailing/leading
// whitespace can never split a value between the count and the filter logic.
// Category derives from the canonical venue_type (single mapping in the taxonomy),
// so venue and category can never disagree.
const catOf = (l: GLILead): string => categoryForVenue(l.venue_type);
const venueOf = (l: GLILead): string => (l.venue_type ?? '').trim() || 'Other';

const MS_DAY = 24 * 60 * 60 * 1000;

const streamOf = (l: GLILead): string => l.stream ?? 'opportunity';

// The lead's best-available CONTENT date (ms), or null when it has only a
// first_seen floor. Opportunity keys off its bid deadline first (a real
// submission deadline), then falls back to a published/parsed date; government
// and intelligence key off published_date (which also carries any parsed date).
function contentTime(l: GLILead, stream: string): number | null {
  if (stream === 'opportunity') {
    const dl = timeOf(l.deadline, NaN);
    if (!Number.isNaN(dl)) return dl;
  }
  const pub = timeOf(l.published_date, NaN);
  return Number.isNaN(pub) ? null : pub;
}

// A lead's date is genuinely UNKNOWN when its provenance is not a real source or
// parsed date. Uses date_source when present (migration 012); before backfill it
// falls back to "no usable date column for this stream" so it never mislabels.
function isDateUnknown(l: GLILead, stream: string): boolean {
  if (l.date_source === 'source' || l.date_source === 'parsed') return false;
  return contentTime(l, stream) === null;
}

// The lead's object_type (two-object model): a deadline-bound OPPORTUNITY or a
// PROJECT EVENT. Uses the stored object_type when present (migration 013); before
// backfill, falls back to the deadline rule so the page never breaks.
function objectTypeOf(l: GLILead): 'opportunity' | 'project_event' {
  if (l.object_type === 'opportunity' || l.object_type === 'project_event') return l.object_type;
  return Number.isNaN(timeOf(l.deadline, NaN)) ? 'project_event' : 'opportunity';
}
// Start of the UTC calendar day, so liveness is judged on the date (matching the
// agent-side classifier), not the exact instant -- a deadline/milestone dated
// today reads as live today, not archived mid-afternoon.
function startOfUtcDay(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
const isFutureIso = (iso: string | null | undefined, now: number): boolean => {
  const t = timeOf(iso ?? null, NaN);
  return !Number.isNaN(t) && startOfUtcDay(t) > startOfUtcDay(now);
};

// Read-time liveness, keyed to each lead's OWN dates (not scrape time), by object:
//  - OPPORTUNITY: a deadline-bound solicitation. LIVE iff its deadline is today or
//    later; a passed deadline is Archive. (Dead pre-2026 opportunities are purged,
//    so they do not appear.)
//  - PROJECT EVENT: lives by heartbeat. LIVE iff a future milestone exists, OR its
//    last activity is within 12 months, OR it is undated (never assumed old,
//    badged DATE UNKNOWN). Older-and-silent (dormant 12-24mo, archived >24mo) fall
//    to the Archive view for Phase 1. Origination date is NEVER a liveness filter,
//    so a 2022-origin project with 2026 activity or a 2028 milestone stays LIVE.
function isFresh(l: GLILead, _stream: string, now: number): boolean {
  if (objectTypeOf(l) === 'opportunity') {
    const dl = timeOf(l.deadline, NaN);
    return Number.isNaN(dl) ? true : dl >= startOfUtcDay(now);
  }
  if (isFutureIso(l.milestone_date, now)) return true; // future milestone -> always live
  const t = contentTime(l, 'project_event'); // last-activity proxy (published/parsed)
  if (t === null) return true; // undated -> Active (badged DATE UNKNOWN)
  return t >= now - 365 * MS_DAY; // active within 12 months
}

// Active vs Archive: a lead is Active when it is fresh/open for its stream (or
// undated), and Archive otherwise. The two views are mutually exclusive and
// together contain every lead. Nothing is deleted; only the date/deadline status
// decides which view a lead appears in.
type GLIView = 'active' | 'archive';
function passesView(l: GLILead, stream: string, view: GLIView, now: number): boolean {
  const fresh = isFresh(l, stream, now);
  return view === 'active' ? fresh : !fresh;
}

function ymd(iso: string | null): string {
  return iso ? iso.slice(0, 10) : DASH;
}
function timeOf(iso: string | null, fallback: number): number {
  if (!iso) return fallback;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? fallback : t;
}

// Muted badge for a lead whose date is genuinely unknown (only a first_seen
// floor). Kept Active but flagged so nothing undated reads as verified-current.
// Accent-muted house style: EMPHASIS font, uppercase, hairline border, no fill.
function DateUnknownBadge() {
  return (
    <span
      title="No source or parsed date; shown by first-seen order"
      style={{
        fontFamily: 'var(--font-emphasis)',
        fontSize: '9px',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--muted)',
        border: '0.5px solid var(--hairline)',
        padding: '2px 5px',
        whiteSpace: 'nowrap',
      }}
    >
      Date Unknown
    </span>
  );
}

// Deadline cell: accent + EMPHASIS when the deadline is within the next 30 days.
function DeadlineCell({ deadline }: { deadline: string | null }) {
  if (!deadline) return <>{DASH}</>;
  const t = new Date(deadline).getTime();
  const soon = !Number.isNaN(t) && t >= Date.now() && t - Date.now() <= 30 * 24 * 60 * 60 * 1000;
  return (
    <span style={soon ? { color: 'var(--accent)', fontFamily: 'var(--font-emphasis)' } : undefined}>
      {deadline.slice(0, 10)}
    </span>
  );
}

const categoryCol: GLIColumn = {
  key: 'category',
  label: 'Category',
  variant: 'meta',
  render: (l) => l.development_category ?? 'Other/Uncategorized',
  sortValue: (l) => l.development_category ?? 'Other/Uncategorized',
};
const titleCol: GLIColumn = {
  key: 'title',
  label: 'Title',
  variant: 'title',
  render: (l) => l.title ?? DASH,
  sortValue: (l) => (l.title ?? '').toLowerCase(),
};
const locationCol: GLIColumn = {
  key: 'location',
  label: 'Location',
  variant: 'strong',
  render: (l) => l.location ?? DASH,
  sortValue: (l) => (l.location ?? '').toLowerCase(),
};
const jurisdictionCol: GLIColumn = { ...locationCol, key: 'jurisdiction', label: 'Jurisdiction' };
const deadlineCol: GLIColumn = {
  key: 'deadline',
  label: 'Deadline',
  variant: 'meta',
  render: (l) =>
    l.deadline ? (
      <DeadlineCell deadline={l.deadline} />
    ) : isDateUnknown(l, streamOf(l)) ? (
      <DateUnknownBadge />
    ) : (
      DASH
    ),
  sortValue: (l) => timeOf(l.deadline, Infinity),
};
const publishedCol: GLIColumn = {
  key: 'published',
  label: 'Published',
  variant: 'meta',
  render: (l) =>
    l.published_date ? ymd(l.published_date) : isDateUnknown(l, streamOf(l)) ? <DateUnknownBadge /> : DASH,
  sortValue: (l) => timeOf(l.published_date, -Infinity),
};
const linkCol: GLIColumn = { key: 'link', label: 'Source', render: (l) => <GLISourceLink url={l.url} /> };
// Government (Pass 4) columns.
const sourceTypeCol: GLIColumn = {
  key: 'source_type',
  label: 'Doc Type',
  variant: 'meta',
  render: (l) => l.source_type ?? DASH,
  sortValue: (l) => (l.source_type ?? '').toLowerCase(),
};
// The three streams. Opportunities group by signal_type (Feasibility RFP becomes
// its own section) and sort by soonest deadline; Intelligence sorts by newest
// publication; Government keeps the query order (newest first).
const STREAMS: {
  key: string;
  label: string;
  columns: GLIColumn[];
  group: boolean;
  sortKey?: string;
  sortDir: 'asc' | 'desc';
}[] = [
  // Table view keeps only the high-value triage columns and fits the viewport
  // (no horizontal scroll). Title leads as the flexible, sticky, truncating column.
  // Signal, Venue, Applicant/Presenter, and the Primary Document link move to the
  // detail panel (GLIDetail) on row click -- nothing is lost. Opportunities still
  // surface signal_type as the group band.
  {
    key: 'opportunity',
    label: 'Opportunities',
    columns: [titleCol, categoryCol, locationCol, deadlineCol, linkCol],
    group: true,
    sortKey: 'deadline',
    sortDir: 'asc',
  },
  {
    key: 'intelligence',
    label: 'Intelligence',
    columns: [titleCol, categoryCol, locationCol, publishedCol, linkCol],
    group: false,
    sortKey: 'published',
    sortDir: 'desc',
  },
  {
    key: 'government',
    label: 'Government',
    columns: [titleCol, categoryCol, sourceTypeCol, jurisdictionCol, publishedCol, linkCol],
    group: false,
    sortDir: 'desc',
  },
];

const STREAM_KEYS = STREAMS.map((s) => s.key);

// Triage views. Each is a status filter applied in the database. 'all' is the
// working set (everything except Trash); 'trash' is dismissed rows only, which
// is where Restore lives. Nothing is ever deleted, so Trash is a view, not a bin.
type TriageView = 'all' | 'new' | 'watchlist' | 'client_ready' | 'trash';
const TRIAGE_VIEWS: { key: TriageView; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'watchlist', label: 'Watchlist' },
  { key: 'client_ready', label: 'Client Ready' },
  { key: 'trash', label: 'Trash' },
];
// Delta windows, all on first_seen (when the row was captured), which is the
// only date that answers "what is new since I last looked". The stream's own
// date stays available as the table sort.
type DateWindow = 'all' | '7d' | '30d' | 'custom';
const DATE_WINDOWS: { key: DateWindow; label: string }[] = [
  { key: 'all', label: 'All time' },
  { key: '7d', label: 'New this week' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'custom', label: 'Since' },
];
function firstSeenFloor(w: DateWindow, customFrom: string): string | undefined {
  if (w === '7d') return daysAgoIso(7);
  if (w === '30d') return daysAgoIso(30);
  if (w === 'custom' && customFrom) return new Date(customFrom).toISOString();
  return undefined;
}

// Table column key to database column. A column absent here is not sortable,
// which is the same set the table already treated as sortable (those with a
// sortValue accessor).
const SORT_COLUMN: Record<string, string> = {
  title: 'title',
  category: 'development_category',
  location: 'location',
  jurisdiction: 'location',
  deadline: 'deadline',
  published: 'published_date',
  source_type: 'source_type',
};

function statusFilterFor(v: TriageView): Pick<LeadQuery, 'status' | 'excludeStatus'> {
  if (v === 'trash') return { status: 'dismissed' };
  if (v === 'all') return { excludeStatus: 'dismissed' };
  return { status: v };
}

export default function GLIPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [activeStream, setActiveStream] = useState('opportunity');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [venueFilter, setVenueFilter] = useState('all');
  const [locationQuery, setLocationQuery] = useState('');
  const [view, setView] = useState<GLIView>('active');
  const [reporting, setReporting] = useState(false);
  const [presetKey, setPresetKey] = useState('all');
  const [focusLabel, setFocusLabel] = useState<string | undefined>(undefined);
  const [selectedLead, setSelectedLead] = useState<GLILead | null>(null);

  // ---- Filter state. Every one of these is a database filter; TanStack Query
  // keys carry the whole set, so returning to a filter already visited is a
  // cache read rather than another round trip.
  const [page, setPage] = useState(1);
  const pageSize = DEFAULT_PAGE_SIZE;
  const [mutationError, setMutationError] = useState<string | null>(null);

  // ---- Triage. `triageView` is a status filter, not a client-side predicate.
  // Trash is status = 'dismissed'; every other view excludes it.
  const [triageView, setTriageView] = useState<TriageView>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ---- Geography + delta. All three geography levels are stored, indexed
  // columns; selecting one is a database filter, never a text match.
  const [geo, setGeo] = useState<{ country?: string; region_state?: string; market?: string }>({});
  const [dateWindow, setDateWindow] = useState<DateWindow>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [sortOverride, setSortOverride] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);

  // The one query object every read on this page derives from. `view` maps onto
  // lifecycle, which is the scraper's axis (active / expired / dead). Status is
  // Philip's axis and is filtered separately; dismissed rows are excluded here
  // and are reachable only through Trash.
  const baseQuery: LeadQuery = useMemo(
    () => ({
      module: LIVE_PIPELINE_STORAGE_KEY,
      stream: activeStream,
      lifecycle: view === 'active' ? 'active' : ['expired', 'dead'],
      ...statusFilterFor(triageView),
      development_category: categoryFilter === 'all' ? undefined : categoryFilter,
      venue_type: venueFilter === 'all' ? undefined : venueFilter,
      search: locationQuery.trim() || undefined,
      country: geo.country,
      region_state: geo.region_state,
      market: geo.market,
      firstSeenFrom: firstSeenFloor(dateWindow, customFrom),
    }),
    [
      activeStream,
      view,
      categoryFilter,
      venueFilter,
      locationQuery,
      triageView,
      geo.country,
      geo.region_state,
      geo.market,
      dateWindow,
      customFrom,
    ]
  );

  // Applying a focus preset sets the saved filter combination in one click.
  function applyPreset(key: string) {
    const p = GLI_PRESETS.find((x) => x.key === key) ?? GLI_PRESETS[0];
    setPresetKey(p.key);
    setFocusLabel(p.focusLabel);
    setCategoryFilter(p.category ?? 'all');
    setVenueFilter(p.venue ?? 'all');
    setLocationQuery(p.location ?? '');
    if (p.stream) setActiveStream(p.stream);
    setPage(1);
  }

  // Manual filter changes clear the active focus so the report title never
  // misrepresents a hand-tuned view, and reset to page one so the visible page
  // always belongs to the filter that produced it.
  const clearFocus = () => {
    setPresetKey('all');
    setFocusLabel(undefined);
  };
  const handleCategory = (c: string) => {
    setCategoryFilter(c);
    setPage(1);
    clearFocus();
  };
  const handleVenue = (v: string) => {
    setVenueFilter(v);
    setPage(1);
    clearFocus();
  };
  const handleLocation = (q: string) => {
    setLocationQuery(q);
    setPage(1);
    clearFocus();
  };

  const active = STREAMS.find((s) => s.key === activeStream) ?? STREAMS[0];
  // The stream's default sort, unchanged: opportunities by soonest deadline,
  // everything else by newest document date. `sortOverride` is set when a header
  // is clicked and re-sorts the WHOLE result set in the database.
  const defaultSort = {
    key: activeStream === 'opportunity' ? 'deadline' : 'published',
    dir: (activeStream === 'opportunity' ? 'asc' : 'desc') as 'asc' | 'desc',
  };
  const sort = sortOverride ?? defaultSort;
  const sortField = SORT_COLUMN[sort.key] ?? 'published_date';
  const sortDir = sort.dir;

  // A header click sorts server-side: same column flips direction, new column
  // starts ascending. Paging resets, because page 3 of the old order is
  // meaningless in the new one.
  const handleSort = useCallback(
    (key: string) => {
      if (!SORT_COLUMN[key]) return;
      setSortOverride((prev) => {
        const current = prev ?? defaultSort;
        return current.key === key
          ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
          : { key, dir: 'asc' };
      });
      setPage(1);
    },
    [defaultSort.key, defaultSort.dir]
  );

  // ---- Reads. Each is a keyed query; a filter change is a key change.
  const pageQuery = useLeadPage({ ...baseQuery, sortField, sortDir, page, pageSize });
  const pageData = pageQuery.data ?? null;

  const streamCountQueries = {
    opportunity: useLeadCount({ ...baseQuery, stream: 'opportunity' }),
    intelligence: useLeadCount({ ...baseQuery, stream: 'intelligence' }),
    government: useLeadCount({ ...baseQuery, stream: 'government' }),
  };
  const tabCounts: Record<string, number> = {
    opportunity: streamCountQueries.opportunity.data ?? 0,
    intelligence: streamCountQueries.intelligence.data ?? 0,
    government: streamCountQueries.government.data ?? 0,
  };

  const activeViewCount = useLeadCount({ ...baseQuery, lifecycle: 'active' });
  const archiveViewCount = useLeadCount({ ...baseQuery, lifecycle: ['expired', 'dead'] });
  const viewCounts: Record<GLIView, number> = {
    active: activeViewCount.data ?? 0,
    archive: archiveViewCount.data ?? 0,
  };

  // Triage view counts share the filters minus the status axis, so a view's
  // count equals the rows it renders.
  const withoutStatus: LeadQuery = { ...baseQuery, status: undefined, excludeStatus: undefined };
  const statusCounts: Record<TriageView, number> = {
    all: useLeadCount({ ...withoutStatus, excludeStatus: 'dismissed' }).data ?? 0,
    new: useLeadCount({ ...withoutStatus, status: 'new' }).data ?? 0,
    watchlist: useLeadCount({ ...withoutStatus, status: 'watchlist' }).data ?? 0,
    client_ready: useLeadCount({ ...withoutStatus, status: 'client_ready' }).data ?? 0,
    trash: useLeadCount({ ...withoutStatus, status: 'dismissed' }).data ?? 0,
  };
  const backlog = useBacklog().data ?? 0;

  // Counts for each date window, so a window that legitimately returns
  // everything is visibly doing its job. The whole corpus was captured inside
  // one week, so All time, New this week and Last 30 days genuinely hold the
  // same rows; without a count on each button that is indistinguishable from a
  // dead control, which is exactly how this was reported as broken.
  const dateWindowCounts: Record<DateWindow, number | undefined> = {
    all: useLeadCount({ ...baseQuery, firstSeenFrom: undefined }).data,
    '7d': useLeadCount({ ...baseQuery, firstSeenFrom: daysAgoIso(7) }).data,
    '30d': useLeadCount({ ...baseQuery, firstSeenFrom: daysAgoIso(30) }).data,
    custom: useLeadCount(
      { ...baseQuery, firstSeenFrom: firstSeenFloor('custom', customFrom) },
      dateWindow === 'custom' && !!customFrom
    ).data,
  };

  // Faceted: each dimension's counts exclude its own filter, so a chip's count
  // equals the rows shown when it is clicked.
  const categoryFacet = useFacet({ ...baseQuery, development_category: undefined }, 'development_category');
  const venueFacet = useFacet({ ...baseQuery, venue_type: undefined }, 'venue_type');
  const facetVia: 'rpc' | 'fallback' = categoryFacet.data?.viaRpc ? 'rpc' : 'fallback';

  const geoBase: LeadQuery = { ...baseQuery, country: undefined, region_state: undefined, market: undefined };
  const countryFacet = useFacet(geoBase, 'country');
  const regionFacet = useFacet({ ...geoBase, country: geo.country }, 'region_state', !!geo.country);
  const marketFacet = useFacet(
    { ...geoBase, country: geo.country, region_state: geo.region_state },
    'market',
    !!geo.country && !!geo.region_state
  );
  const geoUnresolved = useUnresolvedGeoCount(geoBase).data ?? 0;

  const toChips = (
    counts: { value: string; count: number }[] | undefined,
    order: readonly string[],
    selected: string
  ): GLIChip[] => {
    const list = counts ?? [];
    const m = new Map(list.map((c) => [c.value, c.count]));
    const totalCount = list.reduce((a, c) => a + c.count, 0);
    const known = order.filter((v) => (m.get(v) ?? 0) > 0 || v === selected);
    const extra = list.map((c) => c.value).filter((v) => !order.includes(v));
    return [
      { value: 'all', label: 'All', count: totalCount },
      ...[...known, ...extra].map((v) => ({ value: v, label: v, count: m.get(v) ?? 0 })),
    ];
  };
  const categoryChips = toChips(categoryFacet.data?.counts, DEVELOPMENT_CATEGORIES, categoryFilter);
  const venueChips = toChips(venueFacet.data?.counts, VENUE_TYPES, venueFilter);

  // ---- Writes. Optimistic: the row moves on the click, the request follows,
  // and a failure rolls the row back and surfaces the reason.
  const { applyStatus: mutateStatus, busy: triageBusy } = useLeadMutations({
    onError: (message) => setMutationError(message),
  });

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

  async function signOut() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  // Selection is cleared on the click, not after the request, because the
  // optimistic update has already moved the rows out of the view.
  const applyStatus = useCallback(
    (ids: string[], status: LeadStatus) => {
      if (ids.length === 0) return;
      setMutationError(null);
      mutateStatus(ids, status);
      setSelectedIds(new Set());
    },
    [mutateStatus]
  );

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback((ids: string[], select: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (select) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const rows = pageData?.rows ?? [];
  const total = pageData?.total ?? 0;
  const pageCount = pageData?.pageCount ?? 1;

  // Exports cover the whole filtered set, not the visible page, so a report is
  // never silently one page of its own scope. Paged server-side and capped, with
  // the cap reported rather than silently truncating.
  const EXPORT_CAP = 2000;
  async function fetchFilteredForExport(): Promise<GLILead[]> {
    const out: GLILead[] = [];
    for (let p = 1; out.length < EXPORT_CAP; p++) {
      const chunk = await fetchLeadPage<GLILead>({
        ...baseQuery,
        sortField,
        sortDir,
        page: p,
        pageSize: 200,
      });
      out.push(...chunk.rows);
      if (p >= chunk.pageCount || chunk.rows.length === 0) break;
    }
    return out.slice(0, EXPORT_CAP);
  }

  // Export exactly the visible, filtered rows (Active/Archive + filters respected)
  // as a branded XLSX workbook.
  async function exportXlsx() {
    const date = new Date().toISOString().slice(0, 10);
    const exportRows = await fetchFilteredForExport();
    const dates = exportRows
      .map((l) => (l.stream === 'opportunity' ? l.deadline : l.published_date))
      .filter((d): d is string => !!d)
      .map((d) => d.slice(0, 10))
      .sort();
    const dateRange = dates.length
      ? dates[0] === dates[dates.length - 1]
        ? dates[0]
        : `${dates[0]} to ${dates[dates.length - 1]}`
      : 'no dates';
    const blob = await buildGliWorkbook(exportRows, {
      streamKey: activeStream,
      streamLabel: active.label,
      view: view === 'archive' ? 'Archive' : 'Active',
      category: categoryFilter,
      market: locationQuery || 'Global',
      dateRange,
      generatedDate: date,
      focusLabel,
    });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = gliXlsxFilename(activeStream, categoryFilter, date);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  }

  // Generate a branded PDF of the visible, filtered set via the server route.
  async function generateReport() {
    if (reporting || total === 0) return;
    setReporting(true);
    try {
      const date = new Date().toISOString().slice(0, 10);
      const scope: ReportScope = {
        streamLabel: active.label,
        streamKey: activeStream,
        category: categoryFilter,
        venue: venueFilter,
        location: locationQuery,
        includesStale: view === 'archive',
        view,
        generatedDate: date,
        focusLabel,
      };
      const res = await authedFetch('/api/gli-report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildReportPayload(await fetchFilteredForExport(), scope)),
      });
      if (!res.ok) throw new Error(`Report failed: ${res.status}`);
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = gliReportFilename(activeStream, categoryFilter, date);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (err) {
      console.error(err);
      alert('Report generation failed. Please try again.');
    } finally {
      setReporting(false);
    }
  }

  return (
    <main style={{ maxWidth: 1360, margin: '0 auto', padding: '40px 24px' }}>
      <GLINav onSignOut={signOut} />

      {loading ? (
        <p className={styles.loading}>Loading...</p>
      ) : (
        <>
          <div className={styles.viewToggle} role="tablist" aria-label="Active or Archive">
            {(['active', 'archive'] as GLIView[]).map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                className={`${styles.viewBtn} ${view === v ? styles.viewBtnActive : ''}`}
                onClick={() => {
                  setView(v);
                  setPage(1);
                }}
              >
                {v === 'active' ? 'Active' : 'Archive'}
                <span className={styles.viewCount}>{viewCounts[v]}</span>
              </button>
            ))}
          </div>
          <GLIStats leads={rows} streamLabel={active.label} total={total} />
          <GLIFilters
            categoryChips={categoryChips}
            venueChips={venueChips}
            categoryFilter={categoryFilter}
            venueFilter={venueFilter}
            locationQuery={locationQuery}
            onCategory={handleCategory}
            onVenue={handleVenue}
            onLocation={handleLocation}
          />
          <div className={styles.actions}>
            <label className={styles.focusControl}>
              <span>Focus</span>
              <select value={presetKey} onChange={(e) => applyPreset(e.target.value)}>
                {GLI_PRESETS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className={styles.actionBtn}
              onClick={exportXlsx}
              disabled={total === 0}
            >
              Export XLSX
            </button>
            <button
              className={styles.actionBtn}
              onClick={generateReport}
              disabled={reporting || total === 0}
            >
              {reporting ? 'Generating...' : 'Generate Report'}
            </button>
          </div>
          <GeoNav
            countries={countryFacet.data?.counts ?? []}
            regions={regionFacet.data?.counts ?? []}
            markets={marketFacet.data?.counts ?? []}
            country={geo.country}
            regionState={geo.region_state}
            market={geo.market}
            unresolved={geoUnresolved}
            viaRpc={countryFacet.data?.viaRpc ?? false}
            onSelect={(next) => {
              setGeo(next);
              setPage(1);
              setSelectedIds(new Set());
            }}
          />
          <div className={styles.deltaBar}>
            <span className={styles.deltaLabel}>Captured</span>
            {DATE_WINDOWS.map((w) => (
              <button
                key={w.key}
                className={`${styles.deltaBtn} ${dateWindow === w.key ? styles.deltaBtnActive : ''}`}
                onClick={() => {
                  setDateWindow(w.key);
                  setPage(1);
                }}
              >
                {w.label}
                {dateWindowCounts[w.key] !== undefined && (
                  <span className={styles.deltaCount}>{dateWindowCounts[w.key]}</span>
                )}
              </button>
            ))}
            {dateWindow === 'custom' && !customFrom && (
              <span className={styles.deltaHint}>pick a date to filter from</span>
            )}
            {dateWindow === 'custom' && (
              <input
                className={styles.deltaDate}
                type="date"
                value={customFrom}
                onChange={(e) => {
                  setCustomFrom(e.target.value);
                  setPage(1);
                }}
              />
            )}
          </div>
          {mutationError && (
            <div className={styles.mutationError} role="alert">
              {mutationError} The change was rolled back.
              <button className={styles.mutationErrorClose} onClick={() => setMutationError(null)}>
                Dismiss
              </button>
            </div>
          )}
          <div className={styles.triageBar}>
            <div className={styles.triageViews} role="tablist" aria-label="Triage view">
              {TRIAGE_VIEWS.map((v) => (
                <button
                  key={v.key}
                  role="tab"
                  aria-selected={triageView === v.key}
                  className={`${styles.triageView} ${triageView === v.key ? styles.triageViewActive : ''}`}
                  onClick={() => {
                    setTriageView(v.key);
                    setPage(1);
                    setSelectedIds(new Set());
                  }}
                >
                  {v.label}
                  <span className={styles.triageCount}>{statusCounts[v.key]}</span>
                </button>
              ))}
            </div>
            <span className={styles.backlog} title="Records still at status new, across every stream">
              Triage backlog <strong>{backlog}</strong>
            </span>
          </div>
          {selectedIds.size > 0 && (
            <div className={styles.bulkBar}>
              <span className={styles.bulkCount}>{selectedIds.size} selected</span>
              <div className={styles.bulkActions}>
                {(['watchlist', 'client_ready', 'new', 'dismissed'] as LeadStatus[]).map((st) => (
                  <button
                    key={st}
                    className={styles.bulkBtn}
                    disabled={triageBusy}
                    onClick={() => applyStatus([...selectedIds], st)}
                  >
                    {st === 'new' ? 'Reset to New' : STATUS_LABELS[st]}
                  </button>
                ))}
                <button className={styles.bulkBtn} onClick={() => setSelectedIds(new Set())}>
                  Clear
                </button>
              </div>
            </div>
          )}
          <div className={styles.tabs} role="tablist">
            {STREAMS.map((s) => (
              <button
                key={s.key}
                role="tab"
                aria-selected={activeStream === s.key}
                className={`${styles.tab} ${activeStream === s.key ? styles.tabActive : ''}`}
                onClick={() => {
                  setActiveStream(s.key);
                  setPage(1);
                  setSortOverride(null);
                }}
              >
                {s.label}
                <span className={styles.tabCount}>{tabCounts[s.key] ?? 0}</span>
              </button>
            ))}
          </div>
          <GLITable
            leads={rows}
            columns={active.columns}
            sectionLabel={active.label}
            groupBySignal={active.group}
            defaultSortKey={active.sortKey}
            defaultSortDir={active.sortDir}
            onSelect={setSelectedLead}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={toggleSelectAll}
            onRowStatus={(lead, status) => applyStatus([lead.id], status)}
            serverSort={sort}
            onServerSort={handleSort}
          />
          <div className={styles.pager}>
            <span className={styles.pagerInfo}>
              {total === 0
                ? 'No records'
                : `${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, total)} of ${total}`}
              {pageData ? ` | page ${pageData.rowsMs} ms, count ${pageData.countMs} ms` : ''}
              {facetVia === 'fallback' ? ' | facet counts: interim path (apply migration 015)' : ''}
            </span>
            <div className={styles.pagerBtns}>
              <button
                className={styles.pagerBtn}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                Previous
              </button>
              <span className={styles.pagerPage}>
                {page} / {pageCount}
              </span>
              <button
                className={styles.pagerBtn}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                disabled={page >= pageCount}
              >
                Next
              </button>
            </div>
          </div>
          <GLIDetail
            lead={selectedLead}
            onClose={() => setSelectedLead(null)}
            onChanged={() => {
              // Mutations invalidate the affected queries themselves; this only
              // clears any error banner left from a previous failure.
              setMutationError(null);
            }}
          />
        </>
      )}
    </main>
  );
}
