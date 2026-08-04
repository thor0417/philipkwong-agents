// Every authenticated screen lives in this route group, so every one of them
// gets the same shell and the same auth gate. A route group changes no URLs:
// (app)/register is still /register.
//
// /login stays outside deliberately. It is the one screen that must render
// without a session, and wrapping it in a shell that redirects to /login would
// be a loop.
//
// THE SUSPENSE BOUNDARY IS LOAD-BEARING. Reading state from the URL means
// useSearchParams(), which Next cannot resolve while prerendering: a static
// render has no request and therefore no query string. Without a boundary the
// production build fails on every route in this group with
// "useSearchParams() should be wrapped in a suspense boundary" — and it fails
// only in `next build`, never in `next dev`, which does not prerender. It was
// caught by a Vercel build, not by tsc, because tsc does not compile pages at
// all.
//
// One boundary here rather than one per screen: the top bar itself reads the
// pipeline from the URL, so every screen in the group needs it and no screen
// can opt out.

import { Suspense } from 'react';
import AppShell from '@/components/shell/AppShell';
import styles from '@/components/shell/AppShell.module.css';

// The prerendered frame. Deliberately the shell's real geometry (48px bar,
// 200px rail) and nothing else: it is replaced the instant the client takes
// over, so anything more detailed would only be a shape that flashes and
// changes. A blank fallback would make the whole page jump instead.
function ShellFrame() {
  return (
    <div className={styles.shell}>
      <div className={styles.barSkeleton} />
      <div className={styles.body}>
        <div className={styles.railSkeleton} />
        <main className={styles.main} />
      </div>
    </div>
  );
}

export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<ShellFrame />}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
