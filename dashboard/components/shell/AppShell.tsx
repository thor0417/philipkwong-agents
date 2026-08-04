'use client';

// THE SHELL. One of these, wrapping every screen.
//
// It owns four things and no more: the top bar, the rail, the command palette,
// and the auth gate. Screens own their own content and nothing else, which is
// what makes the chrome learnable: it is identical everywhere because it is
// literally the same component instance across navigations.
//
// THE AUTH GATE LIVES HERE. Every screen used to run its own getSession /
// redirect dance in its own useEffect, which meant a new screen was
// unauthenticated until someone remembered to add it. Same inversion as
// middleware.ts did for the API routes: the default is now closed.

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import TopBar from './TopBar';
import Rail from './Rail';
import CommandPalette from './CommandPalette';
import styles from './AppShell.module.css';

const RAIL_STORAGE_KEY = 'pk-rail-collapsed';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Starts expanded and is corrected from storage before paint by the effect
  // below. The rail animates on width, so a wrong first value would visibly
  // slide; the shell suppresses that transition until the stored value lands.
  const [collapsed, setCollapsed] = useState(false);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(RAIL_STORAGE_KEY) === '1');
    } catch {
      /* storage unavailable; the default stands */
    }
    setRestored(true);
  }, []);

  const toggleRail = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(RAIL_STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* the rail still collapses; it just will not be remembered */
      }
      return next;
    });
  }, []);

  // Auth, once, for every screen inside the shell.
  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      if (!data.session) router.replace('/login');
      else setReady(true);
    });
    // A session that expires mid-session should not leave a signed-out operator
    // looking at stale data.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace('/login');
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  // Command-K anywhere. Bound on the shell rather than per screen so it cannot
  // be missing from one of them.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    router.replace('/login');
  }, [router]);

  return (
    <div className={styles.shell}>
      <TopBar onOpenPalette={() => setPaletteOpen(true)} />
      <div className={styles.body}>
        <Rail collapsed={collapsed} onToggle={toggleRail} animate={restored} onSignOut={signOut} />
        <main className={styles.main}>
          {ready ? children : <p className={styles.gate}>Checking session...</p>}
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
