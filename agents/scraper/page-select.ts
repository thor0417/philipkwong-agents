// PAGED READS. PostgREST caps an unbounded select at 1000 rows and says nothing
// about it.
//
// This is not theoretical and it is not future work: an unbounded select('id')
// on `leads` returns exactly 1000 rows while the table holds 1295. The cap is
// already active. Every read that walks a whole table has to page, or it
// silently operates on an arbitrary first slice and reports success.
//
// purgeStoredJunk was the closest to breaking: it selected every module 'gli'
// row with no range, and there were 808. Three more government runs would have
// crossed 1000, after which the junk sweep would have stopped covering the
// newest records without a word - the exact failure class this brief exists to
// remove.

import { supabaseAdmin } from '../../lib/supabase-admin';

export const PAGE_SIZE = 1000;

export interface PagedResult<T> {
  rows: T[];
  pages: number;
  // True when the read completed. False means a page errored and `rows` is a
  // partial answer, which the caller must not treat as the whole table.
  complete: boolean;
}

// Read every row a filtered select matches, one page at a time.
//
// `build` receives the base query so the caller can apply its own filters; it is
// called once per page because a PostgREST builder cannot be reused after
// .range().
export async function selectAllPaged<T>(
  table: string,
  columns: string,
  // Loosely typed on purpose: PostgREST's builder generics vary with the column
  // string, and pinning them here buys nothing a caller cares about. The result
  // rows are typed by the caller through T.
  build: (q: unknown) => unknown,
  label: string
): Promise<PagedResult<T>> {
  const rows: T[] = [];
  let from = 0;
  let pages = 0;
  for (;;) {
    const base = supabaseAdmin.from(table).select(columns);
    const q = build(base) as {
      range: (a: number, b: number) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
    const { data, error } = await q.range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error(`${label}: page at offset ${from} failed (${error.message}); result is partial.`);
      return { rows, pages, complete: false };
    }
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    pages++;
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
    // A table this large means something else is wrong; stop rather than loop
    // forever on a mis-specified filter.
    if (pages > 200) {
      console.error(`${label}: stopped after ${pages} pages (${rows.length} rows); refusing to loop further.`);
      return { rows, pages, complete: false };
    }
  }
  return { rows, pages, complete: true };
}
