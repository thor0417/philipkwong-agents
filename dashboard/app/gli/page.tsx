'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import type { GLILead } from '@/lib/types';
import GLINav from '@/components/GLINav';
import GLIStats from '@/components/GLIStats';
import GLIFilters from '@/components/GLIFilters';
import GLITable from '@/components/GLITable';
import GLIDetail from '@/components/GLIDetail';
import styles from './page.module.css';

const GLI_COLUMNS =
  'id, title, venue_type, signal_type, location, company, contact_name, contact_email, contact_phone, url, raw_content, date_found, score, source_tier';

export default function GLIPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<GLILead[]>([]);
  const [venueFilter, setVenueFilter] = useState('all');
  const [locationQuery, setLocationQuery] = useState('');
  const [tierFilter, setTierFilter] = useState('all');
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

  // Client-side filters: venue exact-match, source-tier exact-match, location
  // case-insensitive contains.
  const filtered = useMemo(() => {
    const q = locationQuery.trim().toLowerCase();
    return leads.filter((l) => {
      if (venueFilter !== 'all' && l.venue_type !== venueFilter) return false;
      if (tierFilter !== 'all' && l.source_tier !== tierFilter) return false;
      if (q && !(l.location ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [leads, venueFilter, tierFilter, locationQuery]);

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
            tierFilter={tierFilter}
            onVenue={setVenueFilter}
            onLocation={setLocationQuery}
            onTier={setTierFilter}
          />
          <GLITable leads={filtered} onSelect={setSelectedLead} />
          <GLIDetail lead={selectedLead} onClose={() => setSelectedLead(null)} />
        </>
      )}
    </main>
  );
}
