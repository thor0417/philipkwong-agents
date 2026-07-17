'use client';

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
import styles from './page.module.css';

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
const isFutureIso = (iso: string | null | undefined, now: number): boolean => {
  const t = timeOf(iso ?? null, NaN);
  return !Number.isNaN(t) && t > now;
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
    return Number.isNaN(dl) ? true : dl >= now;
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

function host(url: string | null): string {
  if (!url) return DASH;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return DASH;
  }
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
const signalCol: GLIColumn = {
  key: 'signal',
  label: 'Signal',
  variant: 'meta',
  render: (l) => l.signal_type ?? DASH,
  sortValue: (l) => (l.signal_type ?? '').toLowerCase(),
};
const venueCol: GLIColumn = {
  key: 'venue',
  label: 'Venue',
  variant: 'meta',
  render: (l) => l.venue_type ?? DASH,
  sortValue: (l) => (l.venue_type ?? '').toLowerCase(),
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
const sourceCol: GLIColumn = {
  key: 'source',
  label: 'Source',
  variant: 'meta',
  render: (l) => host(l.url),
  sortValue: (l) => host(l.url),
};
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
const linkCol: GLIColumn = { key: 'link', label: 'Link', render: (l) => <GLISourceLink url={l.url} /> };
// Government (Pass 4) columns.
const sourceTypeCol: GLIColumn = {
  key: 'source_type',
  label: 'Doc Type',
  variant: 'meta',
  render: (l) => l.source_type ?? DASH,
  sortValue: (l) => (l.source_type ?? '').toLowerCase(),
};
const applicantCol: GLIColumn = {
  key: 'applicant',
  label: 'Applicant / Presenter',
  variant: 'meta',
  render: (l) => l.applicant ?? l.presented_by ?? DASH,
  sortValue: (l) => (l.applicant ?? l.presented_by ?? '').toLowerCase(),
};
const primaryDocCol: GLIColumn = {
  key: 'primary_doc',
  label: 'Primary Doc',
  render: (l) => (l.primary_document_url ? <GLISourceLink url={l.primary_document_url} label="DOC" /> : DASH),
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
  {
    key: 'opportunity',
    label: 'Opportunities',
    columns: [categoryCol, signalCol, venueCol, titleCol, locationCol, deadlineCol, sourceCol, linkCol],
    group: true,
    sortKey: 'deadline',
    sortDir: 'asc',
  },
  {
    key: 'intelligence',
    label: 'Intelligence',
    columns: [categoryCol, venueCol, titleCol, locationCol, publishedCol, sourceCol, linkCol],
    group: false,
    sortKey: 'published',
    sortDir: 'desc',
  },
  {
    key: 'government',
    label: 'Government',
    columns: [
      categoryCol,
      sourceTypeCol,
      signalCol,
      venueCol,
      titleCol,
      jurisdictionCol,
      applicantCol,
      sourceCol,
      primaryDocCol,
      linkCol,
    ],
    group: false,
    sortDir: 'desc',
  },
];

const STREAM_KEYS = STREAMS.map((s) => s.key);

export default function GLIPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<GLILead[]>([]);
  const [activeStream, setActiveStream] = useState('opportunity');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [venueFilter, setVenueFilter] = useState('all');
  const [locationQuery, setLocationQuery] = useState('');
  const [view, setView] = useState<GLIView>('active');
  const [reporting, setReporting] = useState(false);
  const [presetKey, setPresetKey] = useState('all');
  const [focusLabel, setFocusLabel] = useState<string | undefined>(undefined);
  const [selectedLead, setSelectedLead] = useState<GLILead | null>(null);

  // Applying a focus preset sets the saved filter combination in one click.
  function applyPreset(key: string) {
    const p = GLI_PRESETS.find((x) => x.key === key) ?? GLI_PRESETS[0];
    setPresetKey(p.key);
    setFocusLabel(p.focusLabel);
    setCategoryFilter(p.category ?? 'all');
    setVenueFilter(p.venue ?? 'all');
    setLocationQuery(p.location ?? '');
    if (p.stream) setActiveStream(p.stream);
  }

  // Manual filter changes clear the active focus so the report title never
  // misrepresents a hand-tuned view.
  const clearFocus = () => {
    setPresetKey('all');
    setFocusLabel(undefined);
  };
  const handleCategory = (c: string) => {
    setCategoryFilter(c);
    clearFocus();
  };
  const handleVenue = (v: string) => {
    setVenueFilter(v);
    clearFocus();
  };
  const handleLocation = (q: string) => {
    setLocationQuery(q);
    clearFocus();
  };

  const load = useCallback(async () => {
    // Only the three real streams are shown. Legacy GLI rows with a null stream
    // (pre-stream-tagging news) belong to no tab, so they are excluded at the DB
    // rather than loaded and counted; counting them made stats disagree with the
    // per-stream tables (a venue could count 1 with zero visible rows in any tab).
    // Try the full column set (Pass 4 fields); fall back to base if not migrated.
    const query = (cols: string) =>
      supabase
        .from('leads')
        .select(cols)
        .eq('module', 'gli')
        .in('stream', STREAM_KEYS)
        .order('date_found', { ascending: false });
    let { data, error } = await query(GLI_COLUMNS_FULL);
    if (error) ({ data } = await query(GLI_COLUMNS_BASE));
    const rows = ((data as unknown as GLILead[]) ?? []).map((l) => ({
      ...l,
      development_category: categoryForVenue(l.venue_type),
    }));
    setLeads(rows);
  }, []);

  useEffect(() => {
    let active = true;
    async function init() {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) {
        router.replace('/login');
        return;
      }
      await load();
      if (active) setLoading(false);
    }
    init();
    return () => {
      active = false;
    };
  }, [router, load]);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  const active = STREAMS.find((s) => s.key === activeStream) ?? STREAMS[0];

  // Everything below is scoped to the ACTIVE stream so counts and rows never
  // disagree. visibleLeads is the exact set the table renders. Chip counts are
  // faceted: each dimension's counts exclude that dimension's own filter, so a
  // chip's count equals the rows shown when it is clicked (given the other active
  // filters). Tab counts apply all filters per stream, so a tab's count equals
  // the rows it renders when selected.
  const derived = useMemo(() => {
    const now = Date.now();
    const q = locationQuery.trim().toLowerCase();
    const mCat = (l: GLILead) => categoryFilter === 'all' || catOf(l) === categoryFilter;
    const mVen = (l: GLILead) => venueFilter === 'all' || venueOf(l) === venueFilter;
    const mLoc = (l: GLILead) => !q || (l.location ?? '').toLowerCase().includes(q);

    // Active/Archive is a base filter (Active = fresh/open, Archive = stale/closed;
    // mutually exclusive, together every lead). It scopes streamLeads so every
    // downstream count and the table derive from the same set, preserving
    // count == rows and keeping the two views identical except for which leads show.
    const streamLeads = leads.filter(
      (l) => l.stream === activeStream && passesView(l, activeStream, view, now)
    );
    const visibleLeads = streamLeads.filter((l) => mCat(l) && mVen(l) && mLoc(l));

    // Active/Archive counts for the current stream + filters, so the toggle shows
    // at a glance how many are in each view (Active count = visible rows here).
    const streamFiltered = leads.filter(
      (l) => l.stream === activeStream && mCat(l) && mVen(l) && mLoc(l)
    );
    const activeCount = streamFiltered.filter((l) => isFresh(l, activeStream, now)).length;
    const viewCounts = { active: activeCount, archive: streamFiltered.length - activeCount };

    const catBase = streamLeads.filter((l) => mVen(l) && mLoc(l));
    const venBase = streamLeads.filter((l) => mCat(l) && mLoc(l));
    const countBy = (rows: GLILead[], key: (l: GLILead) => string): Map<string, number> => {
      const m = new Map<string, number>();
      for (const r of rows) {
        const k = key(r);
        m.set(k, (m.get(k) ?? 0) + 1);
      }
      return m;
    };
    const catCounts = countBy(catBase, catOf);
    const venCounts = countBy(venBase, venueOf);

    // 'All' plus every canonical value with a nonzero count (or the selected one,
    // so a selected value stays visible even if another filter zeroes it).
    const buildChips = (
      allCount: number,
      values: readonly string[],
      counts: Map<string, number>,
      selected: string
    ): GLIChip[] => {
      const out: GLIChip[] = [{ value: 'all', label: 'All', count: allCount }];
      for (const v of values) {
        const c = counts.get(v) ?? 0;
        if (c > 0 || v === selected) out.push({ value: v, label: v, count: c });
      }
      return out;
    };
    const venueList = VENUE_TYPES as readonly string[];
    const extraVenues = [...venCounts.keys()].filter((k) => !venueList.includes(k));

    const categoryChips = buildChips(catBase.length, DEVELOPMENT_CATEGORIES, catCounts, categoryFilter);
    const venueChips = buildChips(venBase.length, [...venueList, ...extraVenues], venCounts, venueFilter);

    const tabCounts: Record<string, number> = {};
    for (const s of STREAMS) {
      tabCounts[s.key] = leads.filter(
        (l) =>
          l.stream === s.key &&
          passesView(l, s.key, view, now) &&
          mCat(l) &&
          mVen(l) &&
          mLoc(l)
      ).length;
    }

    return { visibleLeads, categoryChips, venueChips, tabCounts, viewCounts };
  }, [leads, activeStream, categoryFilter, venueFilter, locationQuery, view]);

  // Export exactly the visible, filtered rows (Active/Archive + filters respected)
  // as a branded XLSX workbook.
  async function exportXlsx() {
    const date = new Date().toISOString().slice(0, 10);
    const dates = derived.visibleLeads
      .map((l) => (l.stream === 'opportunity' ? l.deadline : l.published_date))
      .filter((d): d is string => !!d)
      .map((d) => d.slice(0, 10))
      .sort();
    const dateRange = dates.length
      ? dates[0] === dates[dates.length - 1]
        ? dates[0]
        : `${dates[0]} to ${dates[dates.length - 1]}`
      : 'no dates';
    const blob = await buildGliWorkbook(derived.visibleLeads, {
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
    if (reporting || derived.visibleLeads.length === 0) return;
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
      const res = await fetch('/api/gli-report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildReportPayload(derived.visibleLeads, scope)),
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
                onClick={() => setView(v)}
              >
                {v === 'active' ? 'Active' : 'Archive'}
                <span className={styles.viewCount}>{derived.viewCounts[v]}</span>
              </button>
            ))}
          </div>
          <GLIStats leads={derived.visibleLeads} streamLabel={active.label} />
          <GLIFilters
            categoryChips={derived.categoryChips}
            venueChips={derived.venueChips}
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
              disabled={derived.visibleLeads.length === 0}
            >
              Export XLSX
            </button>
            <button
              className={styles.actionBtn}
              onClick={generateReport}
              disabled={reporting || derived.visibleLeads.length === 0}
            >
              {reporting ? 'Generating...' : 'Generate Report'}
            </button>
          </div>
          <div className={styles.tabs} role="tablist">
            {STREAMS.map((s) => (
              <button
                key={s.key}
                role="tab"
                aria-selected={activeStream === s.key}
                className={`${styles.tab} ${activeStream === s.key ? styles.tabActive : ''}`}
                onClick={() => setActiveStream(s.key)}
              >
                {s.label}
                <span className={styles.tabCount}>{derived.tabCounts[s.key]}</span>
              </button>
            ))}
          </div>
          <GLITable
            leads={derived.visibleLeads}
            columns={active.columns}
            sectionLabel={active.label}
            groupBySignal={active.group}
            defaultSortKey={active.sortKey}
            defaultSortDir={active.sortDir}
            onSelect={setSelectedLead}
          />
          <GLIDetail lead={selectedLead} onClose={() => setSelectedLead(null)} />
        </>
      )}
    </main>
  );
}
