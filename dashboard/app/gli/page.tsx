'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import type { GLILead } from '@/lib/types';
import { GLI_SIGNAL_ORDER } from '@/lib/types';
import GLINav from '@/components/GLINav';
import GLIStats from '@/components/GLIStats';
import GLIFilters from '@/components/GLIFilters';
import GLICard from '@/components/GLICard';
import GLIDetail from '@/components/GLIDetail';
import styles from './page.module.css';

const GLI_COLUMNS =
  'id, title, venue_type, signal_type, location, company, contact_name, contact_email, contact_phone, url, raw_content, date_found, score';

// signal_type ordering: known types in GLI_SIGNAL_ORDER first, anything else last.
const SIGNAL_RANK: Record<string, number> = Object.fromEntries(
  GLI_SIGNAL_ORDER.map((s, i) => [s, i])
);
function signalRank(signal: string): number {
  return SIGNAL_RANK[signal] ?? GLI_SIGNAL_ORDER.length;
}

function dateValue(iso: string | null): number {
  return iso ? new Date(iso).getTime() : -Infinity;
}

export default function GLIPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<GLILead[]>([]);
  const [venueFilter, setVenueFilter] = useState('all');
  const [locationQuery, setLocationQuery] = useState('');
  const [selectedLead, setSelectedLead] = useState<GLILead | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('leads')
      .select(GLI_COLUMNS)
      .eq('module', 'gli')
      .order('date_found', { ascending: false });
    setLeads((data as unknown as GLILead[]) ?? []);
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

  // Client-side filters: venue exact-match, location case-insensitive contains.
  const filtered = useMemo(() => {
    const q = locationQuery.trim().toLowerCase();
    return leads.filter((l) => {
      if (venueFilter !== 'all' && l.venue_type !== venueFilter) return false;
      if (q && !(l.location ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [leads, venueFilter, locationQuery]);

  // Group filtered leads by signal_type, ordered by GLI_SIGNAL_ORDER (unknown
  // last), each group sorted by date_found descending.
  const groups = useMemo(() => {
    const map = new Map<string, GLILead[]>();
    for (const l of filtered) {
      const key = l.signal_type ?? 'Unclassified';
      const bucket = map.get(key);
      if (bucket) bucket.push(l);
      else map.set(key, [l]);
    }
    return [...map.entries()]
      .sort((a, b) => {
        const r = signalRank(a[0]) - signalRank(b[0]);
        return r !== 0 ? r : a[0].localeCompare(b[0]);
      })
      .map(([signal, items]) => ({
        signal,
        items: [...items].sort(
          (a, b) => dateValue(b.date_found) - dateValue(a.date_found)
        ),
      }));
  }, [filtered]);

  return (
    <main style={{ maxWidth: 1360, margin: '0 auto', padding: '40px 24px' }}>
      <GLINav onSignOut={signOut} />

      {loading ? (
        <p className={styles.loading}>Loading...</p>
      ) : (
        <>
          <GLIStats leads={filtered} />
          <GLIFilters
            venueFilter={venueFilter}
            locationQuery={locationQuery}
            onVenue={setVenueFilter}
            onLocation={setLocationQuery}
          />

          {groups.length === 0 ? (
            <p className={styles.empty}>No GLI leads match the current filters.</p>
          ) : (
            groups.map((g) => (
              <section className={styles.group} key={g.signal}>
                <div className={styles.groupHead}>
                  <span>{g.signal}</span>
                  <span className={styles.groupCount}>{g.items.length}</span>
                </div>
                <div className={styles.grid}>
                  {g.items.map((lead) => (
                    <GLICard
                      key={lead.id}
                      lead={lead}
                      onSelect={setSelectedLead}
                    />
                  ))}
                </div>
              </section>
            ))
          )}

          <GLIDetail lead={selectedLead} onClose={() => setSelectedLead(null)} />
        </>
      )}
    </main>
  );
}
