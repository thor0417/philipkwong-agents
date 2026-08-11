'use client';

// THE PERIOD, AS A HOOK. Resolution, and the one query the moved axis needs.
//
// lib/period.ts is deliberately pure - no clock, no storage, no network - so it
// can be reasoned about and tested. This file is where it meets the browser:
// it supplies `now`, supplies the last-visit timestamp, and turns the moved
// axis into a set of project ids.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useQueryState, parseAsString } from 'nuqs';
import { supabase } from './supabase';
import { LIVE_PIPELINE_STORAGE_KEY } from './pipelines';
import { useLastVisit } from './use-today';
import {
  DEFAULT_PERIOD,
  resolvePeriod,
  type PeriodAxis,
  type ResolvedPeriod,
} from './period';

/**
 * The period and axis from the URL, resolved.
 *
 * `now` is captured ONCE per mount, for the same reason the last-visit stamp is:
 * a rolling window whose upper bound is re-read on every render is a window that
 * moves while it is being read, and two queries issued a second apart would
 * disagree about "the last 7 days".
 */
export function usePeriodState(defaultPeriod = DEFAULT_PERIOD): {
  period: ResolvedPeriod;
  token: string;
  setToken: (t: string | null) => void;
  axis: PeriodAxis;
  setAxis: (a: PeriodAxis) => void;
} {
  const [token, setTokenRaw] = useQueryState('period', parseAsString.withDefault(defaultPeriod));
  const [axisRaw, setAxisRaw] = useQueryState('axis', parseAsString.withDefault('arrived'));
  const { since: visitSince } = useLastVisit();

  const now = useMemo(() => new Date(), []);
  const axis: PeriodAxis = axisRaw === 'moved' ? 'moved' : 'arrived';
  const period = useMemo(
    () => resolvePeriod(token, now, visitSince),
    [token, now, visitSince]
  );

  return {
    period,
    token,
    setToken: (t) => void setTokenRaw(t),
    axis,
    setAxis: (a) => void setAxisRaw(a),
  };
}

/**
 * The projects that MOVED in a period: every project carrying an event whose
 * occurred_at falls inside it.
 *
 * WHY A SEPARATE QUERY RATHER THAN A JOIN. project_events and projects are two
 * tables, and PostgREST cannot filter the parent by a child's column in the same
 * request without an inner-join hint that would also multiply the parent rows by
 * their events - which breaks the exact count the pager prints.
 *
 * THE BOUND IS STATED, NOT HIDDEN. This reads the id column only, for events in
 * the period, up to EVENT_ID_CAP. The corpus holds 715 events in total, so the
 * cap is nowhere near active; if it ever is, `capped` comes back true and the
 * caller shows it rather than quietly under-reporting a month.
 */
export const EVENT_ID_CAP = 5000;

export interface MovedProjects {
  ids: string[];
  events: number;
  capped: boolean;
}

export async function fetchMovedProjectIds(
  period: ResolvedPeriod,
  pipeline = LIVE_PIPELINE_STORAGE_KEY
): Promise<MovedProjects> {
  let q = supabase
    .from('project_events')
    .select('project_id')
    .eq('module', pipeline)
    .limit(EVENT_ID_CAP);
  if (period.since) q = q.gte('occurred_at', period.since);
  // Exclusive, matching lib/period.ts. See project-event-queries for what an
  // inclusive upper bound did to the last day of a month.
  if (period.until) q = q.lt('occurred_at', period.until);

  const { data, error } = await q;
  if (error) throw new Error(`moved-projects query failed: ${error.message}`);
  const rows = (data ?? []) as { project_id: string | null }[];
  const ids = new Set<string>();
  for (const r of rows) if (r.project_id) ids.add(r.project_id);
  return { ids: [...ids], events: rows.length, capped: rows.length >= EVENT_ID_CAP };
}

export function useMovedProjectIds(period: ResolvedPeriod, enabled: boolean) {
  return useQuery({
    queryKey: ['projects', 'moved', period.since ?? '', period.until ?? ''],
    queryFn: () => fetchMovedProjectIds(period),
    enabled,
    staleTime: 30_000,
  });
}

// A record row carries no module, so the lane is not filterable here the way it
// is on project_events. The join back to projects does that: an id that is not
// in the register's own query drops out when the two are ANDed.
export const RECORD_ID_CAP = 20_000;

export interface ArrivedProjects {
  ids: string[];
  records: number;
  capped: boolean;
}

/**
 * THE PROJECTS THAT GAINED A RECORD IN THIS PERIOD.
 *
 * ARRIVED USED TO MEAN projects.first_seen, AND THAT IS NOT WHAT ANYONE READS
 * IT AS. The column is written once, on insert, as the OLDEST capture date
 * among the project's records - so "arrived in August" was really "this
 * project's oldest record was captured in August". A project first seen in July
 * that gained eleven August filings did not arrive in August by that reading and
 * vanished from the month.
 *
 * Measured over the August 2026 capture: 167 projects gained a record captured
 * in August; 143 had their own first_seen inside it; the filter hid 24. The
 * totals understate it badly, because New York City is almost entirely new
 * projects (117 of its 120 are both) and it dominates the sum. Everywhere with
 * an established register was wrong by most of its activity:
 *
 *   Nevada      7 projects gained an August record, the register showed 1
 *   California  7 gained, showed 2
 *   Tennessee   2 gained, showed 0
 *
 * which is how a month in which Clark County captured 81 records, Anaheim 79 and
 * Las Vegas 75 displayed as a nearly empty register.
 *
 * So Arrived resolves through the records, the same shape the Moved axis uses
 * for events: ask which projects hold a record captured inside the period, and
 * filter on those ids. The alternative - a stored "last_record_added" column -
 * is a second denormalised date to keep true, and this corpus already has one
 * date column that quietly meant something other than its name.
 */
export async function fetchArrivedProjectIds(period: ResolvedPeriod): Promise<ArrivedProjects> {
  let q = supabase
    .from('leads')
    .select('project_id')
    .not('project_id', 'is', null)
    // A dismissed record is not activity. It is the same rule the register's
    // own counts use, and without it a month of dismissals reads as a busy one.
    .neq('status', 'dismissed')
    .limit(RECORD_ID_CAP);
  if (period.since) q = q.gte('first_seen', period.since);
  // Exclusive, matching lib/period.ts.
  if (period.until) q = q.lt('first_seen', period.until);

  const { data, error } = await q;
  if (error) throw new Error(`arrived-projects query failed: ${error.message}`);
  const rows = (data ?? []) as { project_id: string | null }[];
  const ids = new Set<string>();
  for (const r of rows) if (r.project_id) ids.add(r.project_id);
  return { ids: [...ids], records: rows.length, capped: rows.length >= RECORD_ID_CAP };
}

export function useArrivedProjectIds(period: ResolvedPeriod, enabled: boolean) {
  return useQuery({
    queryKey: ['projects', 'arrived', period.since ?? '', period.until ?? ''],
    queryFn: () => fetchArrivedProjectIds(period),
    enabled,
    staleTime: 30_000,
  });
}
