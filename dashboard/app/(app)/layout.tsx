// Every authenticated screen lives in this route group, so every one of them
// gets the same shell and the same auth gate. A route group changes no URLs:
// (app)/register is still /register.
//
// /login stays outside deliberately. It is the one screen that must render
// without a session, and wrapping it in a shell that redirects to /login would
// be a loop.

import AppShell from '@/components/shell/AppShell';

export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
