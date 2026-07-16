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
import { buildGliCsv, gliExportFilename } from '@/lib/gli-export';
import { buildReportPayload, gliReportFilename, type ReportScope } from '@/lib/gli-report';
import { GLI_PRESETS } from '@/lib/gli-presets';
import styles from './page.module.css';

const GLI_COLUMNS =
  'id, title, venue_type, signal_type, location, company, contact_name, contact_email, contact_phone, url, raw_content, date_found, score, source_tier, stream, deadline, published_date, source';

const DASH = '--';

// Canonical accessors (single source of truth). Trimmed so trailing/leading
// whitespace can never split a value between the count and the filter logic.
// Category derives from the canonical venue_type (single mapping in the taxonomy),
// so venue and category can never disagree.
const catOf = (l: GLILead): string => categoryForVenue(l.venue_type);
const venueOf = (l: GLILead): string => (l.venue_type ?? '').trim() || 'Other';

const MS_DAY = 24 * 60 * 60 * 1000;

// Read-time freshness per stream, keyed to each lead's OWN date (not scrape time)
// so a lead goes stale/closed on its own schedule. Undated leads are kept (never
// silently dropped). Opportunity: OPEN = future deadline or undated live
// solicitation. Government: document (published) date within 18 months.
// Intelligence: publish date within 90 days.
function isFresh(l: GLILead, stream: string, now: number): boolean {
  if (stream === 'opportunity') {
    if (!l.deadline) return true;
    const t = new Date(l.deadline).getTime();
    return Number.isNaN(t) || t >= now;
  }
  const windowDays = stream === 'government' ? 548 : 90; // ~18 months vs 90 days
  if (!l.published_date) return true;
  const t = new Date(l.published_date).getTime();
  return Number.isNaN(t) || t >= now - windowDays * MS_DAY;
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
  render: (l) => <DeadlineCell deadline={l.deadline} />,
  sortValue: (l) => timeOf(l.deadline, Infinity),
};
const publishedCol: GLIColumn = {
  key: 'published',
  label: 'Published',
  variant: 'meta',
  render: (l) => ymd(l.published_date),
  sortValue: (l) => timeOf(l.published_date, -Infinity),
};
const linkCol: GLIColumn = { key: 'link', label: 'Link', render: (l) => <GLISourceLink url={l.url} /> };

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
    columns: [categoryCol, signalCol, venueCol, titleCol, jurisdictionCol, sourceCol, linkCol],
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
    const { data } = await supabase
      .from('leads')
      .select(GLI_COLUMNS)
      .eq('module', 'gli')
      .in('stream', STREAM_KEYS)
      .order('date_found', { ascending: false });
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

  // Export exactly the visible, filtered rows to CSV (what you see is what you get).
  function exportCsv() {
    const csv = buildGliCsv(derived.visibleLeads);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = gliExportFilename(activeStream, categoryFilter, new Date().toISOString().slice(0, 10));
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
              onClick={exportCsv}
              disabled={derived.visibleLeads.length === 0}
            >
              Export CSV
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
