// THE SCOPE PREVIEW. What does this client's scope actually match, right now?
//
// THIS IS THE ACCEPTANCE TEST FOR CLIENTS, and it is worth saying why a count is
// the acceptance test for a CRM feature. A scope that matches nothing is not a
// rare pathology - it is what a scope becomes when a market is spelled
// differently from the register's spelling, when a venue type was renamed, or
// when a client asks for something the sources do not cover. Every one of those
// produces a beautifully filled-in intake form and an empty report.
//
// Discovered before generating, it is a five-second fix. Discovered after
// sending, it is the client asking why they received four pages of nothing.
//
// THREE NUMBERS, NOT ONE:
//
//   PROJECTS         what the register holds inside this scope
//   RECORDS          the filings behind them, because a scope matching 3
//                    projects and 400 records is a different proposition from
//                    one matching 3 projects and 3 records
//   NEW THIS PERIOD  whether anything has happened lately. A scope matching 40
//                    projects and nothing new in a month has no report in it.

import { supabase } from './supabase';
import { applyPostFilters, resolveScope, type ClientScope } from './clients';
import { applyProjectFilters, PROJECT_COLUMNS, type Project } from './projects';
import type { ResolvedPeriod } from './period';

export interface ScopePreview {
  projects: number;
  records: number;
  newProjects: number;
  newRecords: number;
  // A scope with a multi-value axis is counted over fetched rows rather than by
  // the server, and the preview says which axes forced that. Silence here would
  // be a count whose provenance nobody could check.
  postFiltered: string[];
  // True when the row cap was reached, so a count that might be short says so.
  capped: boolean;
  sample: Project[];
  ms: number;
}

// A preview reads rows, because multi-value axes cannot be pushed to the server
// through ProjectQuery. 2000 is far above the 184 this register holds and far
// below anything that would hurt; passing it means the preview is a bounded read
// with a stated limit rather than an unbounded one that works until it does not.
export const PREVIEW_ROW_CAP = 2000;

export async function fetchScopePreview(
  scope: ClientScope,
  period: ResolvedPeriod
): Promise<ScopePreview> {
  const t0 = Date.now();
  const { query, postFilters } = resolveScope(scope);

  const { data, error } = await applyProjectFilters(
    supabase.from('projects').select(PROJECT_COLUMNS),
    query
  )
    .order('last_activity', { ascending: false, nullsFirst: false })
    .limit(PREVIEW_ROW_CAP);
  if (error) throw new Error(`scope preview failed: ${error.message}`);

  const all = (data ?? []) as unknown as Project[];
  const matched = applyPostFilters(all as unknown as Record<string, unknown>[], postFilters) as unknown as Project[];

  // NEW IN THE PERIOD is computed on the SAME matched set rather than by a
  // second query, so the two numbers cannot disagree about what the scope is.
  const since = period.since ? Date.parse(period.since) : Number.NEGATIVE_INFINITY;
  const until = period.until ? Date.parse(period.until) : Number.POSITIVE_INFINITY;
  const inPeriod = matched.filter((p) => {
    if (!p.first_seen) return false;
    const at = Date.parse(p.first_seen);
    return at >= since && at < until;
  });

  const records = matched.reduce((n, p) => n + (p.record_count ?? 0), 0);
  const newRecords = inPeriod.reduce((n, p) => n + (p.record_count ?? 0), 0);

  return {
    projects: matched.length,
    records,
    newProjects: inPeriod.length,
    newRecords,
    postFiltered: postFilters.map((f) => f.field),
    capped: all.length >= PREVIEW_ROW_CAP,
    sample: matched.slice(0, 8),
    ms: Date.now() - t0,
  };
}
