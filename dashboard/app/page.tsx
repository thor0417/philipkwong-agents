'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      router.replace(data.session ? '/pipeline' : '/login');
    });
  }, [router]);

  return (
    <main style={{ padding: 40 }}>
      <span className="mono" style={{ color: 'var(--muted)' }}>
        <span className="bracket">[</span> loading <span className="bracket">]</span>
      </span>
    </main>
  );
}
