'use client';

// TODAY'S DATA. Four questions, asked once each.
//
// The event queries themselves are Brief D's (lib/project-event-queries.ts) and
// are NOT reimplemented here: that module is the one place that knows how to ask
// what moved and what came in, and a second slightly-different version is how
// two screens end up disagreeing about last week. This file supplies the
// authenticated client, the period, and the two things Today needs that the
// event layer does not cover: source health and run health.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { LIVE_PIPELINE_STORAGE_KEY } from './pipelines';
import {
  whatMoved,
  whatCameIn,
  watchlistActivity,
  projectHistory,
  type EventClient,
  type EventRow,
  type WhatCameIn,
} from './project-event-queries';

// ---------------------------------------------------------------- the period

export type PeriodKey = 'visit' | '24h' | '7d' | '30d';

export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'visit', label: 'Since last visit' },
  { key: '24h', label: '24 hours' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
];

const LAST_VISIT_KEY = 'pk-last-visit';
// First run has no stored visit. Seven days is the honest default: it is a
// working week, and claiming "since the beginning of time" would put a year of
// history under a heading that says "what happened while you were away".
const FIRST_RUN_WINDOW_DAYS = 7;

/**
 * The last-visit timestamp, captured ONCE at mount.
 *
 * Deliberately not re-read: the stored value is updated when the screen is left,
 * so if this read live, the window would collapse to nothing the moment it was
 * written and a refresh would show an empty page. Capturing on mount means the
 * window stays still while it is being read, which is what "since last visit"
 * has to mean to be useful.
 */
export function useLastVisit(): { since: string; isFirstRun: boolean } {
  const [captured] = useState(() => {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage.getItem(LAST_VISIT_KEY);
    } catch {
      return null;
    }
  });

  // Stamp the visit on the way OUT, not on the way in.
  useEffect(() => {
    const stamp = () => {
      try {
        window.localStorage.setItem(LAST_VISIT_KEY, new Date().toISOString());
      } catch {
        /* the screen still works; the window just will not narrow */
      }
    };
    // pagehide as well as unmount: closing the tab never unmounts.
    window.addEventListener('pagehide', stamp);
    return () => {
      window.removeEventListener('pagehide', stamp);
      stamp();
    };
  }, []);

  return useMemo(() => {
    if (captured && !Number.isNaN(Date.parse(captured))) {
      return { since: captured, isFirstRun: false };
    }
    return {
      since: new Date(Date.now() - FIRST_RUN_WINDOW_DAYS * 86_400_000).toISOString(),
      isFirstRun: true,
    };
  }, [captured]);
}

export function sinceFor(period: PeriodKey, lastVisit: string): string {
  const days = period === '24h' ? 1 : period === '7d' ? 7 : period === '30d' ? 30 : 0;
  if (period === 'visit') return lastVisit;
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

// ------------------------------------------------------------- event queries

const scopeFor = (since: string) => ({ pipeline: LIVE_PIPELINE_STORAGE_KEY, since, limit: 200 });

// The event queries type their client structurally so they depend on neither
// supabase-js nor the service-role client. Supabase's builder satisfies that
// shape at runtime but not nominally, because its generics do not line up, so
// the cast is required at the boundary. Same line as
// agents/scraper/verify-event-queries.ts, which is the other caller.
const eventClient = supabase as unknown as EventClient;

export const todayKeys = {
  moved: (since: string) => ['today', 'moved', since] as const,
  cameIn: (since: string) => ['today', 'came-in', since] as const,
  watch: (since: string) => ['today', 'watchlist', since] as const,
  sources: () => ['today', 'sources'] as const,
  agents: () => ['today', 'agents'] as const,
};

export function useWhatMoved(since: string) {
  return useQuery<EventRow[]>({
    queryKey: todayKeys.moved(since),
    queryFn: () => whatMoved(eventClient, scopeFor(since)),
  });
}

export function useWhatCameIn(since: string) {
  return useQuery<WhatCameIn>({
    queryKey: todayKeys.cameIn(since),
    queryFn: () => whatCameIn(eventClient, scopeFor(since)),
  });
}

// One project's whole story, oldest first. No period bound: the point of a
// history is that it is the whole history.
export function useProjectHistory(projectId: string | null) {
  return useQuery<EventRow[]>({
    queryKey: ['today', 'history', projectId ?? ''],
    queryFn: () => projectHistory(eventClient, projectId as string),
    enabled: !!projectId,
  });
}

export function useWatchlistActivity(since: string) {
  return useQuery<EventRow[]>({
    queryKey: todayKeys.watch(since),
    queryFn: () => watchlistActivity(eventClient, scopeFor(since)),
  });
}

// -------------------------------------------------------------- source health

export interface SourceHealth {
  source: string;
  lastSeen: string;
  daysSilent: number;
  records: number;
}

/**
 * How long since each source last delivered anything.
 *
 * WHY THIS IS A BOUNDED SCAN. The honest query is "newest first_seen per
 * source", which is a GROUP BY, and PostgREST cannot express one. The
 * alternatives were an RPC (this project cannot run DDL from code) or one query
 * per source (which needs the source list, and getting THAT is the same
 * problem). So it reads the most recent SCAN_CAP rows newest-first and reduces
 * them, which is exact as long as every live source appears within that window.
 * At today's volume the whole corpus is ~900 rows. The cap is reported to the
 * caller so the screen can say when it has been hit rather than quietly
 * reporting a source as silent because it fell off the end.
 */
const SCAN_CAP = 6000;

export function useSourceHealth() {
  return useQuery({
    queryKey: todayKeys.sources(),
    queryFn: async (): Promise<{ sources: SourceHealth[]; capped: boolean }> => {
      const { data, error } = await supabase
        .from('leads')
        .select('source,first_seen')
        .eq('module', LIVE_PIPELINE_STORAGE_KEY)
        .order('first_seen', { ascending: false })
        .limit(SCAN_CAP);
      if (error) throw new Error(`source health failed: ${error.message}`);

      const rows = (data ?? []) as { source: string | null; first_seen: string | null }[];
      const bySource = new Map<string, { last: number; records: number }>();
      for (const r of rows) {
        if (!r.source) continue;
        const t = r.first_seen ? Date.parse(r.first_seen) : NaN;
        const cur = bySource.get(r.source);
        if (!cur) bySource.set(r.source, { last: Number.isNaN(t) ? 0 : t, records: 1 });
        else {
          cur.records += 1;
          if (!Number.isNaN(t) && t > cur.last) cur.last = t;
        }
      }

      const now = Date.now();
      const sources = [...bySource.entries()]
        .map(([source, v]) => ({
          source,
          lastSeen: new Date(v.last).toISOString(),
          daysSilent: Math.floor((now - v.last) / 86_400_000),
          records: v.records,
        }))
        .sort((a, b) => b.daysSilent - a.daysSilent);

      return { sources, capped: rows.length >= SCAN_CAP };
    },
    staleTime: 5 * 60_000,
  });
}

// A source is DEGRADED at 7 days and dead at 14. Both thresholds are about the
// slowest real cadence in the set: the multilateral tender feeds publish weekly,
// so anything under a week of silence is normal operation and flagging it would
// train the operator to ignore this section.
export const DEGRADED_DAYS = 7;
export const DEAD_DAYS = 14;

// ----------------------------------------------------------------- run health

export interface AgentRow {
  name: string;
  status: string | null;
  last_run: string | null;
  error: string | null;
  leads_found: number | null;
}

export function useAgentHealth() {
  return useQuery({
    queryKey: todayKeys.agents(),
    queryFn: async (): Promise<AgentRow[]> => {
      const { data, error } = await supabase
        .from('agents')
        .select('name,status,last_run,error,leads_found')
        .order('name');
      if (error) throw new Error(`agent health failed: ${error.message}`);
      return (data ?? []) as AgentRow[];
    },
    staleTime: 60_000,
  });
}

// ------------------------------------------------------------------- helpers

/** "3 days ago", "today". Mono-rendered, so it stays short. */
export function agoLabel(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'unknown';
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

export function useStableCallback<T extends (...args: never[]) => unknown>(fn: T): T {
  return useCallback(fn, [fn]);
}
