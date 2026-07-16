'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import type { GLILead } from '@/lib/types';
import { developmentCategory } from '@/lib/gli-category';
import GLINav from '@/components/GLINav';
import GLIStats from '@/components/GLIStats';
import GLIFilters from '@/components/GLIFilters';
import GLITable, { type GLIColumn } from '@/components/GLITable';
import GLIDetail from '@/components/GLIDetail';
import SourceLink from '@/components/SourceLink';
import styles from './page.module.css';

const GLI_COLUMNS =
  'id, title, venue_type, signal_type, location, company, contact_name, contact_email, contact_phone, url, raw_content, date_found, score, source_tier, stream, deadline, published_date, source';

const DASH = '--';

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
const linkCol: GLIColumn = { key: 'link', label: 'Link', render: (l) => <SourceLink url={l.url} /> };

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

export default function GLIPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<GLILead[]>([]);
  const [activeStream, setActiveStream] = useState('opportunity');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [venueFilter, setVenueFilter] = useState('all');
  const [locationQuery, setLocationQuery] = useState('');
  const [selectedLead, setSelectedLead] = useState<GLILead | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('leads')
      .select(GLI_COLUMNS)
      .eq('module', 'gli')
      .order('date_found', { ascending: false });
    const rows = ((data as unknown as GLILead[]) ?? []).map((l) => ({
      ...l,
      development_category: developmentCategory(l),
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

  // Cross-stream filters: development category (primary), venue, location. Applied
  // before the stream split so the stats strip and every tab respect them.
  const filteredAll = useMemo(() => {
    const q = locationQuery.trim().toLowerCase();
    return leads.filter((l) => {
      if (
        categoryFilter !== 'all' &&
        (l.development_category ?? 'Other/Uncategorized') !== categoryFilter
      ) {
        return false;
      }
      if (venueFilter !== 'all' && l.venue_type !== venueFilter) return false;
      if (q && !(l.location ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [leads, categoryFilter, venueFilter, locationQuery]);

  const active = STREAMS.find((s) => s.key === activeStream) ?? STREAMS[0];
  const streamLeads = filteredAll.filter((l) => l.stream === active.key);

  return (
    <main style={{ maxWidth: 1360, margin: '0 auto', padding: '40px 24px' }}>
      <GLINav onSignOut={signOut} />

      {loading ? (
        <p className={styles.loading}>Loading...</p>
      ) : (
        <>
          <GLIStats leads={filteredAll} />
          <GLIFilters
            categoryFilter={categoryFilter}
            venueFilter={venueFilter}
            locationQuery={locationQuery}
            onCategory={setCategoryFilter}
            onVenue={setVenueFilter}
            onLocation={setLocationQuery}
          />
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
              </button>
            ))}
          </div>
          <GLITable
            leads={streamLeads}
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
