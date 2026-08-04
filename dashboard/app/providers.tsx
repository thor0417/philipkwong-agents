'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NuqsAdapter } from 'nuqs/adapters/next/app';

// TanStack Query is the dashboard's data layer. No devtools, no styling: the
// package is logic only, and nothing here renders anything of its own.
//
// The defaults are chosen for a triage session. Philip sweeps hundreds of rows
// in one sitting, moving back and forth between the same filters, so a filter he
// has already visited should come back from cache instantly rather than issuing
// another round trip. staleTime keeps a page warm for a minute; refetchOnMount
// and refetchOnWindowFocus stay off so returning to a view does not blank it.
export default function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            refetchOnMount: false,
            retry: 1,
          },
          mutations: {
            retry: 0,
          },
        },
      })
  );
  // nuqs makes the URL the source of truth for filters, selection and view, so
  // the back button works and any view is a shareable link. It is logic only:
  // the adapter renders nothing and ships no styling. It wraps the query client
  // because data reads are keyed off state that now lives in the URL.
  return (
    <NuqsAdapter>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </NuqsAdapter>
  );
}
